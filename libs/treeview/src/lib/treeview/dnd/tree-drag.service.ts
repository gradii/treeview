import { computed, inject, Injectable, signal, Signal } from '@angular/core';
import type { CdkDrag } from '@angular/cdk/drag-drop';
import { ScrollDispatcher } from '@angular/cdk/scrolling';
import { Subscription } from 'rxjs';
import { CollapseNode, RowNode } from '../tree-model';
import { DropPosition, DropTargetNode } from './hit-test';

export interface TreeDropTarget {
  /** Which tree the target belongs to — used to route the drop. */
  readonly ownerPrefix: string;
  /** Target node — row or collapse. */
  readonly node: DropTargetNode;
  readonly position: DropPosition;
  readonly element: HTMLElement;
}

export interface TreeDragConfig {
  /** Unique prefix this tree uses for its `tv-item` DOM ids. */
  readonly prefix: string;
  /** Reactive: is drag-and-drop turned on for this tree? */
  readonly enabled: () => boolean;
  /**
   * Reactive: should rows in this tree restrict drag initiation to a
   * dedicated handle (rendered via `*cdkDragHandle`)?
   */
  readonly dragHandle: () => boolean;
  /**
   * Reactive accessor for the tree's scroller element (the `overflow: auto`
   * host that owns `scrollTop`). Used by the auto-scroll loop to pan the
   * viewport while the user drags into the top/bottom hot zone. May return
   * `null` while the view is still bootstrapping — the loop ignores it.
   */
  readonly scrollerElement: () => HTMLElement | null;
  /**
   * Run this tree's hit-test against the pointer. Returns a target when the
   * cursor sits over one of this tree's rows; `null` otherwise. The
   * coordinator calls each registered tree in turn and takes the first
   * non-null result, enabling cross-tree drops.
   */
  readonly resolveTarget: (
    clientX: number,
    clientY: number,
    source: RowNode | CollapseNode,
  ) => TreeDropTarget | null;
  /** Called when a drop lands inside this tree, on cdkDragEnded. */
  readonly onDrop: (
    source: RowNode | CollapseNode,
    target: TreeDropTarget,
  ) => void;
}

/**
 * Root-singleton coordinator for tree drag-and-drop. Multiple LargeTreeView
 * instances all share this one service: each registers its config (prefix +
 * resolveTarget + onDrop) on init, unregisters on destroy. The pointer event
 * stream — driven by CDK's `cdkDragMoved` on the source row — flows through
 * `trackPointer`, which dispatches to whichever registered tree currently
 * sits under the cursor. On drop, the **target tree's** `onDrop` runs —
 * source removal walks `source.parent` (still pointing into the source
 * tree's structure), and the target tree's `moveRow` handles insertion.
 *
 * Cancellation: Escape (or any caller) marks the drag as cancelled; the
 * subsequent `commitAndEnd` then skips `onDrop` and resets state.
 *
 * Snap-back: CDK's built-in snap-back animation only kicks in inside a
 * `cdkDropList`, which doesn't compose with virtualized rendering. So we
 * roll our own — `beginDrag` records the source element + last pointer,
 * and `commitAndEnd` spawns a transient "ghost" element on rejected drops
 * that transitions from the release point back to the source's centre.
 *
 * Auto-scroll: also rolled by hand for the same reason. While dragging,
 * an rAF loop watches `lastPointer` against each registered tree's
 * scroller rect; if the pointer sits in the top/bottom hot zone, the
 * scroller pans by a velocity proportional to edge proximity, and the
 * hit-test re-runs so the drop hint follows the new content under the
 * (stationary) cursor.
 */
@Injectable({ providedIn: 'root' })
export class TreeDragService {
  /** Distance from a scroller edge (px) at which auto-scroll engages. */
  private static readonly AUTO_SCROLL_HOT_ZONE = 48;
  /** Max scroll delta per frame (px). Edge proximity ramps to this. */
  private static readonly AUTO_SCROLL_MAX_SPEED = 14;

  private readonly scrollDispatcher = inject(ScrollDispatcher);
  private readonly trees = new Map<string, TreeDragConfig>();
  private cancelled = false;
  private lastPointer: { x: number; y: number } | null = null;
  private autoScrollRaf = 0;
  /**
   * RxJS subscription on `ScrollDispatcher.scrolled()` held for the lifetime
   * of an in-flight drag. Any scroll anywhere in the document — most
   * importantly `<html>` / `<body>` — re-runs the hit-test so the drop
   * indicator follows the element that's *currently* under the cursor,
   * not the one that happened to be there when the cursor last moved.
   */
  private scrollSubscription: Subscription | null = null;

  /**
   * A clone of the source row appended directly to `<body>` (and lifted into
   * the browser top-layer via the popover API), mirroring how CDK's
   * `PreviewRef` works inside a `cdkDropList`. We build it ourselves because
   * standalone `cdkDrag` (no drop list) doesn't generate a preview — without
   * this, the only visible drag artefact is the original row being
   * transformed in place inside the scroller, where it's clipped by
   * `overflow: hidden`.
   */
  private preview: HTMLElement | null = null;
  /** Source rect captured at drag start — used for snap-back transform. */
  private previewInitialRect: DOMRect | null = null;
  /** Pointer offset within the source element — the location *inside* the
   *  source where the user grabbed. Captured eagerly from CDK's
   *  `_pickupPositionInElement`, which CDK fills in on `mousedown` (before
   *  any cursor movement or drag-threshold delta). Used to keep the grab
   *  point stable under the cursor as the user drags. */
  private previewPickupOffset: { x: number; y: number } | null = null;

  readonly source = signal<RowNode | CollapseNode | null>(null);
  readonly target = signal<TreeDropTarget | null>(null);

  readonly isDragging: Signal<boolean> = computed(
    () => this.source() !== null,
  );

  registerTree(cfg: TreeDragConfig): void {
    this.trees.set(cfg.prefix, cfg);
  }

  unregisterTree(prefix: string): void {
    this.trees.delete(prefix);
  }

  /** Reactive: is drag-and-drop turned on for the tree owning `prefix`? */
  isEnabledFor(prefix: string): boolean {
    const cfg = this.trees.get(prefix);
    return cfg ? cfg.enabled() : false;
  }

  /** Reactive: should rows in `prefix` only drag from a dedicated handle? */
  isHandleRequiredFor(prefix: string): boolean {
    const cfg = this.trees.get(prefix);
    return cfg ? cfg.dragHandle() : false;
  }

  /**
   * Begin tracking a drag. `sourceElement` (when supplied) is the DOM node
   * the user grabbed — cloned into a body-attached preview that follows the
   * cursor. Pass it from `cdkDragStarted` via
   * `event.source.element.nativeElement`.
   *
   * `cdkDrag` (when supplied) is the CDK directive instance — used to
   * register our virtualized scroller(s) with CDK's parent-position tracker
   * so the drag preview stays under the cursor while auto-scroll pans the
   * canvas. CDK normally only tracks scrollable parents inside a
   * `cdkDropList`, which we don't use; this opt-in plug-in mimics that
   * registration so CDK's `_updateOnScroll` path fires for our scroller too.
   */
  beginDrag(
    node: RowNode | CollapseNode,
    sourceElement: HTMLElement | null = null,
    cdkDrag: CdkDrag | null = null,
  ): void {
    this.cancelled = false;
    this.source.set(node);
    this.target.set(null);
    this.lastPointer = null;
    if (cdkDrag !== null) this.registerScrollersWithDragRef(cdkDrag);
    if (sourceElement !== null) this.createPreview(sourceElement, cdkDrag);
    this.attachScrollSubscription();
    this.startAutoScrollLoop();
  }

  /**
   * Push every tree's scroller — *and every scrollable ancestor on the path
   * up to the document* — into CDK's `_parentPositions.positions` map on
   * the dragRef. CDK's drag-drop registry already listens to scroll events
   * in the capture phase on `document`, so a scroll anywhere in the tree
   * will reach the dragRef; only elements that are present in `positions`
   * actually get adjusted by `_parentPositions.handleScroll` (line 138-142
   * in CDK's drag-drop.mjs — unknown targets short-circuit to `null`).
   *
   * Discovery walks two paths:
   *
   * 1. `ScrollDispatcher.getAncestorScrollContainers(scroller)` —
   *    everything an embedder explicitly opted in with `cdkScrollable`.
   *    This matches CDK's own convention for `cdkDropList` and lets host
   *    apps stay in control over which ancestors participate.
   * 2. Auto DOM walk checking `overflow` style on each ancestor — catches
   *    `overflow: auto` containers that the embedder forgot (or chose
   *    not) to mark. False positives just sit in the Map unused; CDK's
   *    `handleScroll` lookup is keyed on the actual scroll target.
   *
   * The two sets are merged and de-duped. Registering only the inner
   * scroller (the previous behaviour) was enough when the tree sat at
   * page level, but broke as soon as the demo wrapped it in an outer
   * `overflow: auto` container — that container scrolling during drag
   * wouldn't update CDK's cached `_pickupPositionOnPage`, and downstream
   * cursor-based hit-tests drifted.
   *
   * The `_dragRef`/`_parentPositions` fields are CDK-internal — we cast to
   * `any` because there is no public API for this. The shape is stable
   * across recent CDK majors (v17+), but verify on bumps.
   */
  private registerScrollersWithDragRef(cdkDrag: CdkDrag): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dragRef = (cdkDrag as any)._dragRef;
    const positions = dragRef?._parentPositions?.positions as
      | Map<HTMLElement | Document, { scrollPosition: { top: number; left: number }; clientRect?: DOMRect }>
      | undefined;
    if (!positions) return;
    for (const cfg of this.trees.values()) {
      const el = cfg.scrollerElement();
      if (el === null) continue;
      for (const target of this.collectScrollables(el)) {
        if (positions.has(target)) continue;
        positions.set(target, {
          scrollPosition: { top: target.scrollTop, left: target.scrollLeft },
          clientRect: target.getBoundingClientRect(),
        });
      }
    }
  }

  /**
   * Union of:
   * - the scroller itself
   * - `cdkScrollable` ancestors picked up via `ScrollDispatcher`
   * - any other ancestor whose computed overflow makes it a scroll container
   * - `<html>` (and `<body>`) always — the viewport scroll target reported
   *   by capture-phase scroll listeners is usually `documentElement`, not
   *   the `Document` object that CDK auto-tracks. Without registering them
   *   explicitly, `handleScroll` looks up the event target, misses, and
   *   returns `null` — so the cached `clientRect`s of inner registered
   *   scrollers don't get adjusted when the page itself scrolls.
   *
   * Walks `parentElement` once; the `cdkScrollable` set is intersected by
   * element identity, so an ancestor that's both registered *and* visibly
   * scrollable only gets reported once.
   */
  private collectScrollables(scroller: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [scroller];
    const seen = new Set<HTMLElement>([scroller]);

    const markedAncestors = new Set<HTMLElement>();
    for (const sc of this.scrollDispatcher.getAncestorScrollContainers(scroller)) {
      const el = sc.getElementRef().nativeElement as HTMLElement;
      markedAncestors.add(el);
    }

    let cur: HTMLElement | null = scroller.parentElement;
    while (cur !== null) {
      if (
        !seen.has(cur) &&
        (markedAncestors.has(cur) || isScrollableElement(cur))
      ) {
        seen.add(cur);
        out.push(cur);
      }
      cur = cur.parentElement;
    }

    // Always register `<html>` and `<body>`. The viewport is what scrolls
    // when the page itself scrolls, and the scroll event's `target` (used
    // by CDK's `handleScroll` as a Map key) is `documentElement` —
    // *not* the `Document` object that CDK auto-tracks. Skipping these
    // makes page scrolls during drag silently no-op all `clientRect`
    // compensations.
    const doc = scroller.ownerDocument;
    for (const root of [doc.documentElement, doc.body]) {
      if (root !== null && !seen.has(root)) {
        seen.add(root);
        out.push(root);
      }
    }
    return out;
  }

  trackPointer(clientX: number, clientY: number): void {
    if (this.source() === null) return;
    this.lastPointer = { x: clientX, y: clientY };
    this.updatePreviewPosition(clientX, clientY);
    this.runHitTest();
  }

  /**
   * Read the cursor's viewport coords directly from the underlying pointer
   * event and feed them into `trackPointer`. We bypass
   * `CdkDragMove.pointerPosition` because CDK derives that via
   * `pageX - cachedDocumentScroll`; the cached document scroll goes stale
   * whenever `<html>` is the scrolling element (the scroll event fires with
   * `target = documentElement`, so CDK's `handleScroll` updates `<html>`'s
   * Map entry but never refreshes the `Document` key that the viewport
   * getter reads). Raw `clientX`/`clientY` are pure viewport coords and
   * don't depend on any scroll bookkeeping.
   */
  trackPointerFromEvent(event: MouseEvent | TouchEvent): void {
    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
      const t = event.touches[0] ?? event.changedTouches[0];
      if (t === undefined) return;
      this.trackPointer(t.clientX, t.clientY);
      return;
    }
    const m = event as MouseEvent;
    this.trackPointer(m.clientX, m.clientY);
  }

  /** Mark the in-flight drag as cancelled — `commitAndEnd` will skip `onDrop`. */
  cancel(): void {
    if (this.source() === null) return;
    this.cancelled = true;
  }

  /**
   * Called on `cdkDragEnded`. If a target was set and the drag wasn't
   * cancelled, fires the target tree's `onDrop` callback. Otherwise — empty
   * space, source-on-self, cancelled — runs the snap-back animation so the
   * user sees the drop visually return to its origin. Always clears state.
   */
  commitAndEnd(): void {
    const src = this.source();
    const tgt = this.target();
    const wasCancelled = this.cancelled;
    this.detachScrollSubscription();
    this.stopAutoScrollLoop();
    if (!wasCancelled && src !== null && tgt !== null) {
      const cfg = this.trees.get(tgt.ownerPrefix);
      cfg?.onDrop(src, tgt);
      this.disposePreview();
    } else if (src !== null) {
      this.runSnapBack();
    } else {
      this.disposePreview();
    }
    this.source.set(null);
    this.target.set(null);
    this.cancelled = false;
    this.lastPointer = null;
  }

  /**
   * Resolve the current `lastPointer` against every registered tree's
   * `resolveTarget`, taking the first non-null hit. Factored out of
   * `trackPointer` so the auto-scroll loop can re-run it after each pan
   * (the canvas just shifted under a stationary cursor).
   */
  private runHitTest(): void {
    const src = this.source();
    const p = this.lastPointer;
    if (src === null || p === null) return;
    for (const cfg of this.trees.values()) {
      const t = cfg.resolveTarget(p.x, p.y, src);
      if (t !== null) {
        this.target.set(t);
        return;
      }
    }
    this.target.set(null);
  }

  private startAutoScrollLoop(): void {
    if (this.autoScrollRaf !== 0) return;
    const tick = () => {
      this.autoScrollRaf = 0;
      if (this.source() === null) return;
      this.tickAutoScroll();
      this.autoScrollRaf = requestAnimationFrame(tick);
    };
    this.autoScrollRaf = requestAnimationFrame(tick);
  }

  private stopAutoScrollLoop(): void {
    if (this.autoScrollRaf !== 0) {
      cancelAnimationFrame(this.autoScrollRaf);
      this.autoScrollRaf = 0;
    }
  }

  /**
   * Per-frame work while dragging. Walks every viable scroll container —
   * each registered tree's scroller, then its scrollable DOM ancestors, then
   * the window viewport — and pans the **first one** whose hot-zone the
   * pointer is sitting in *and* which can still scroll in that direction.
   *
   * Why try multiple containers instead of just the tree scroller: when the
   * tree lives inside a page that itself scrolls (the common case), the user
   * dragging toward the bottom of the window expects the page to scroll once
   * the tree has hit its own scroll clamp. Matches CDK
   * `DropListRef._startScrollingIfNecessary`: parents first, viewport last.
   */
  private tickAutoScroll(): void {
    const p = this.lastPointer;
    if (p === null) return;
    const HOT = TreeDragService.AUTO_SCROLL_HOT_ZONE;
    const MAX = TreeDragService.AUTO_SCROLL_MAX_SPEED;

    for (const c of this.collectScrollCandidates()) {
      const rect = c.rect;
      if (p.x < rect.left || p.x > rect.right) continue;
      if (p.y < rect.top || p.y > rect.bottom) continue;
      const distTop = p.y - rect.top;
      const distBot = rect.bottom - p.y;
      let delta = 0;
      if (distTop < HOT) {
        delta = -MAX * (1 - distTop / HOT);
      } else if (distBot < HOT) {
        delta = MAX * (1 - distBot / HOT);
      }
      if (delta === 0) continue;

      const before = c.getScrollTop();
      c.setScrollTop(before + delta);
      const after = c.getScrollTop();
      // Hit a clamp (top:0 or bottom:max) — content didn't actually move,
      // so try the next outer container.
      if (after === before) continue;
      this.runHitTest();
      return;
    }
  }

  /**
   * Inner-first list of scroll containers to consider this frame: every
   * registered tree's scroller, then each scroller's scrollable DOM
   * ancestors (overflow-y: auto/scroll && scrollHeight > clientHeight), then
   * the window viewport as a final fallback. De-duplicates ancestors when
   * multiple trees share them.
   */
  private collectScrollCandidates(): ScrollCandidate[] {
    const out: ScrollCandidate[] = [];
    const seen = new Set<Element>();
    for (const cfg of this.trees.values()) {
      const el = cfg.scrollerElement();
      if (el === null) continue;
      if (!seen.has(el)) {
        seen.add(el);
        out.push(toElementCandidate(el));
      }
      let cur: HTMLElement | null = el.parentElement;
      while (cur !== null) {
        if (!seen.has(cur) && isScrollableY(cur)) {
          seen.add(cur);
          out.push(toElementCandidate(cur));
        }
        cur = cur.parentElement;
      }
    }
    out.push(toWindowCandidate());
    return out;
  }

  /**
   * Create the body-attached preview that follows the cursor. Mirrors
   * CDK's `PreviewRef` for the no-drop-list case: clone the source, strip
   * drag-active classes, force position/top/left as `!important` (so
   * page styles can't dislodge it), then call the popover API to lift it
   * into the browser top-layer above stacking contexts and `overflow`
   * clipping. The popover call is wrapped in a feature check + try/catch
   * because some embedded WebViews and older browsers still no-op it.
   *
   * Pickup offset is read directly from CDK's `_pickupPositionInElement`,
   * which CDK fills in at `mousedown` — *before* the drag-threshold delta
   * has accumulated. Capturing it lazily on first `cdkDragMoved` (the
   * previous approach) was off by however far the cursor had travelled
   * during the threshold, producing visibly misaligned previews on fast
   * grabs. The field is CDK-internal; the shape has been stable across
   * recent CDK majors (v17+) but verify on bumps.
   */
  private createPreview(source: HTMLElement, cdkDrag: CdkDrag | null): void {
    const rect = source.getBoundingClientRect();
    // Source may already be detached / culled — bail rather than emit a
    // zero-sized preview that the user can't see.
    if (rect.width === 0 && rect.height === 0) return;
    this.previewInitialRect = rect;
    this.previewPickupOffset = readCdkPickupOffset(cdkDrag) ?? {
      x: rect.width / 2,
      y: rect.height / 2,
    };

    const preview = source.cloneNode(true) as HTMLElement;
    preview.removeAttribute('id');
    preview.classList.remove(
      'cdk-drag',
      'cdk-drag-dragging',
      'cdk-drag-disabled',
      'is-drag-source',
    );
    preview.classList.add('cdk-drag-preview');

    // `position: fixed !important` is what stops a sticky/transformed
    // ancestor from re-anchoring the preview — same as CDK's
    // `importantProperties` set in `preview-ref.ts`.
    preview.style.setProperty('position', 'fixed', 'important');
    preview.style.setProperty('top', '0', 'important');
    preview.style.setProperty('left', '0', 'important');
    Object.assign(preview.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '1000',
      transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
    } satisfies Partial<CSSStyleDeclaration>);
    preview.setAttribute('popover', 'manual');

    document.body.appendChild(preview);
    if (supportsPopover(preview)) {
      try {
        preview.showPopover();
      } catch {
        // Already showing, or the element isn't connected — both safe to ignore.
      }
    }
    this.preview = preview;
  }

  private updatePreviewPosition(clientX: number, clientY: number): void {
    if (this.preview === null || this.previewPickupOffset === null) return;
    const x = clientX - this.previewPickupOffset.x;
    const y = clientY - this.previewPickupOffset.y;
    this.preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  /**
   * Animate the existing preview from its current cursor-anchored position
   * back to the source's origin rect, then dispose. Matches Angular CDK's
   * `.cdk-drag-animating` timing (`transform 250ms cubic-bezier(0, 0, 0.2, 1)`).
   * When the preview is missing (drag start was suppressed due to a culled
   * source), falls back to a simple dispose so callers don't wedge.
   */
  private runSnapBack(): void {
    const preview = this.preview;
    const initialRect = this.previewInitialRect;
    if (preview === null || initialRect === null) {
      this.disposePreview();
      return;
    }
    preview.style.transition =
      'transform 250ms cubic-bezier(0, 0, 0.2, 1), opacity 250ms ease';
    preview.style.transform = `translate3d(${initialRect.left}px, ${initialRect.top}px, 0)`;
    preview.style.opacity = '0';

    // Detach refs immediately so a follow-up drag doesn't reuse this
    // about-to-be-removed preview.
    this.preview = null;
    this.previewInitialRect = null;
    this.previewPickupOffset = null;

    setTimeout(() => {
      if (supportsPopover(preview)) {
        try {
          preview.hidePopover();
        } catch {
          // Already hidden or unmounted — ignore.
        }
      }
      preview.remove();
    }, 280);
  }

  private disposePreview(): void {
    const preview = this.preview;
    if (preview === null) return;
    if (supportsPopover(preview)) {
      try {
        preview.hidePopover();
      } catch {
        // Already hidden or unmounted — ignore.
      }
    }
    preview.remove();
    this.preview = null;
    this.previewInitialRect = null;
    this.previewPickupOffset = null;
  }

  /**
   * Subscribe to `ScrollDispatcher.scrolled()` for the duration of the
   * drag. CDK's dispatcher already attaches one capture-phase scroll
   * listener on `document` (and is reference-counted across all
   * subscribers), so this is the idiomatic way to observe *every* scroll
   * in the page — `<html>` / `<body>` viewport scrolls included, since
   * `scroll` events don't bubble and capture is the only path to see them.
   *
   * We re-run the hit-test on each tick: the cursor stayed put, but the
   * world under it moved, so the drop indicator needs to retarget. The
   * `lastPointer` it reads is whatever was last reported by the user's
   * pointer event, which is still the correct viewport coordinate.
   */
  private attachScrollSubscription(): void {
    this.scrollSubscription = this.scrollDispatcher
      .scrolled()
      .subscribe(() => this.runHitTest());
  }

  private detachScrollSubscription(): void {
    this.scrollSubscription?.unsubscribe();
    this.scrollSubscription = null;
  }
}

interface PopoverElement extends HTMLElement {
  showPopover(): void;
  hidePopover(): void;
}

/**
 * Reach into CDK's `_dragRef._pickupPositionInElement` to get the cursor's
 * offset within the source element as captured at `mousedown` — i.e. before
 * the user has moved the cursor past the drag-start threshold. Returns
 * `null` if the field isn't where we expect (CDK API drift) so callers can
 * fall back to a center-grab approximation.
 *
 * The fallback (source centre) is preferable to lazy capture at first
 * `cdkDragMoved`: by then the cursor has accumulated the threshold delta,
 * and a centre-anchor at least keeps the preview symmetric under the
 * cursor instead of progressively offset.
 */
function readCdkPickupOffset(
  cdkDrag: CdkDrag | null,
): { x: number; y: number } | null {
  if (cdkDrag === null) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = (cdkDrag as any)._dragRef;
  const p = ref?._pickupPositionInElement;
  if (
    p === undefined ||
    p === null ||
    typeof p.x !== 'number' ||
    typeof p.y !== 'number'
  ) {
    return null;
  }
  return { x: p.x, y: p.y };
}

function supportsPopover(el: HTMLElement): el is PopoverElement {
  return 'showPopover' in el;
}

/**
 * Uniform handle over a scroll container — either an HTMLElement
 * (treeview scroller / page-level wrapper / etc.) or the window viewport.
 * Lets `tickAutoScroll` treat them identically when it pans them.
 */
interface ScrollCandidate {
  readonly rect: { top: number; bottom: number; left: number; right: number };
  getScrollTop(): number;
  setScrollTop(value: number): void;
}

function toElementCandidate(el: HTMLElement): ScrollCandidate {
  return {
    rect: el.getBoundingClientRect(),
    getScrollTop: () => el.scrollTop,
    setScrollTop: (v) => {
      el.scrollTop = v;
    },
  };
}

function toWindowCandidate(): ScrollCandidate {
  return {
    rect: {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth,
    },
    getScrollTop: () => window.scrollY,
    setScrollTop: (v) => window.scrollTo(window.scrollX, v),
  };
}

/**
 * Cheap "is this element a vertical scroll container that could actually
 * pan?" check. Used by `tickAutoScroll` — we need both: a scrollable
 * overflow rule AND content that exceeds the visible area — otherwise
 * scrollTop writes silently no-op and we'd waste a frame trying.
 */
function isScrollableY(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/**
 * Broader "could this element scroll on either axis?" check, used to decide
 * whether to register an ancestor with CDK's `_parentPositions`. Matches
 * CDK's own `_isElementScrollable` heuristic — any overflow that allows
 * scrolling, even without overflowing content right now (the content might
 * grow mid-drag, or scroll position might already be non-zero).
 */
function isScrollableElement(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return (
    isScrollableOverflow(style.overflowY) ||
    isScrollableOverflow(style.overflowX)
  );
}

function isScrollableOverflow(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay';
}
