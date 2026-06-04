import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ScrollDispatcher, ScrollingModule } from '@angular/cdk/scrolling';
import { TV_ANIMATION_DURATION_MS } from './animation';
import { Collapse } from './collapse';
import { hitTestRow } from './dnd/hit-test';
import { DropHint } from './dnd/drop-hint';
import { TreeDragService, TreeDropTarget } from './dnd/tree-drag.service';
import type { SourceAccessors } from './binding/source-mutation';
import { moveCollapse, moveCollapseBesideRow, moveRow, moveRowAsChild } from './binding/source-mutation';
import { FilterController } from './filter/filter-controller';
import { FilterSettings } from './filter/filter-engine';
import { SizeVariant } from './size';
import { CheckableSettings, CheckController } from './state/check';
import { DisableController } from './state/disable';
import { ExpandController } from './state/expand';
import { TreeViewInstance } from './state/id.service';
import { Key, KeyFn } from './state/keys';
import { absoluteTopOf, NavigationController, } from './state/navigation';
import { SelectionController, SelectionMode } from './state/selection';
import { NodeTemplateDirective } from './templates/node-template.directive';
import { NodeTemplateRegistry } from './templates/node-template.registry';
import { BlockNode, CollapseNode, RowNode, TreeNode } from './tree-model';
import { collectStickyAncestors } from './virtual-tree-layout';

export type ThemeVariant = 'light' | 'dark';

export interface StickyConfig {
  /** Inset of the sticky stack from the top of the scroller viewport. Default `0`. */
  readonly marginTop?: number;
  /** Inset from the left of the scroller content area. Default `0`. */
  readonly marginLeft?: number;
  /** Inset from the right of the scroller content area. Default `0`. */
  readonly marginRight?: number;
}

interface StickyItem {
  node: CollapseNode;
  top: number;
  index: number;
}

@Component({
  selector: 'app-large-tree-view',
  imports: [Collapse, DropHint, ScrollingModule],
  providers: [
    TreeViewInstance,
    ExpandController,
    SelectionController,
    CheckController,
    NavigationController,
    FilterController,
    DisableController,
    NodeTemplateRegistry,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.tv-size-small]': "size() === 'small'",
    '[class.tv-size-medium]': "size() === 'medium'",
    '[class.tv-size-large]': "size() === 'large'",
    '[class.tv-theme-dark]': "theme() === 'dark'",
    '[class.tv-animate]': 'animate()',
  },
  template: `
    <div class="scroller-host">
      <div
        class="scroller"
        #scroller
        cdkScrollable
        tabindex="0"
        role="tree"
        [attr.aria-multiselectable]="ariaMultiselectable()"
        [attr.aria-activedescendant]="ariaActiveDescendant()"
        (scroll)="onScroll()"
        (keydown)="onKeyDown($event)"
      >
        <div class="sticky-stack">
          @if (stickyItems().length > 0) {
            <div
              class="sticky-backplate"
              [style.top.px]="resolvedStickyConfig().marginTop"
              [style.left.px]="resolvedStickyConfig().marginLeft"
              [style.right.px]="resolvedStickyConfig().marginRight"
              [style.height.px]="
                stickyStackHeight() - resolvedStickyConfig().marginTop
              "
            ></div>
          }
          @for (item of stickyItems(); track item.node.id) {
            <div
              class="tv-header sticky"
              role="treeitem"
              [id]="instance.domIdFor(item.node.id)"
              [class.collapsed]="item.node.collapsed()"
              [class.is-active]="navigationController.isActive(item.node)"
              [class.is-disabled]="disableController.isDisabled(item.node)"
              [class.is-drag-source]="dragService.source() === item.node"
              [class.is-in-drag-subtree]="isStickyInDragSubtree(item.node)"
              [style.top.px]="item.top"
              [style.left.px]="resolvedStickyConfig().marginLeft"
              [style.right.px]="resolvedStickyConfig().marginRight"
              [style.height.px]="item.node.headerSize()"
              [style.--tv-depth]="item.node.depth()"
              (wheel)="onStickyWheel($event)"
              (click)="onStickyClick(item.node, $event)"
              [class.is-selected]="selectionController.isSelected(item.node)"
              [attr.aria-selected]="selectionMode() !== 'none' ? selectionController.isSelected(item.node) : null"
              [attr.aria-disabled]="disableController.isDisabled(item.node) ? true : null"
            >
              <span class="caret" [class.is-expanded]="!item.node.collapsed()">▶</span>
              @if (checkController.isEnabled()) {
                <input
                  type="checkbox"
                  class="tv-check"
                  [checked]="checkController.getState(item.node) === 'checked'"
                  [indeterminate]="checkController.getState(item.node) === 'indeterminate'"
                  (click)="onStickyCheckClick(item.node, $event)"
                />
              }
              <span class="label">{{ item.node.label() }}</span>
              <span class="meta">sticky · L{{ item.node.depth() }}</span>
            </div>
          }
        </div>
        <div
          class="canvas"
          [class.is-animating]="isAnimating()"
          [style.height.px]="totalHeight()"
        >
          <app-collapse
            [node]="root()"
            [offset]="0"
            [absoluteOrigin]="0"
            [viewportTop]="effectiveViewportTop()"
            [viewportBottom]="effectiveViewportBottom()"
            [stickyIds]="stickyIds()"
          />
        </div>
      </div>
      <app-drop-hint [scrollerRect]="scrollerRect()"/>
    </div>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;

      /* Layout / typography tokens (medium variant defaults).
         :host(.tv-size-X) blocks override these per variant. */
      --tv-font: 12.5px;
      --tv-meta-font: 11px;
      --tv-icon-size: 14px;
      --tv-indent-base: 8px;
      --tv-indent-step: 14px;
      --tv-gap: 6px;
      --tv-padding-x: 12px;
      --tv-grip-width: 14px;

      /* Color tokens (light theme defaults).
         :host(.tv-theme-dark) overrides. */
      --tv-bg-canvas: #fff;
      --tv-bg-row: #fff;
      --tv-bg-header: linear-gradient(#fafbfc, #eef1f5);
      --tv-bg-hover: #f6f8fa;
      --tv-bg-active: #f0f6ff;
      --tv-bg-active-header: linear-gradient(#e6f0fc, #d4e3f9);
      --tv-bg-selected: linear-gradient(#dbe9ff, #c4d8ff);
      --tv-bg-selected-active: linear-gradient(#cde0fb, #b4cdf7);
      --tv-bg-error: #fff5f5;
      --tv-text: #1f2328;
      --tv-text-strong: #24292f;
      --tv-text-muted: #6e7781;
      --tv-text-subtle: #57606a;
      --tv-text-disabled: #8c959f;
      --tv-text-error: #cf222e;
      --tv-border: #d0d7de;
      --tv-border-soft: #eef0f3;
      --tv-accent: #0969da;
      --tv-accent-soft: #eaf3ff;
      --tv-shimmer-from: #eef1f5;
      --tv-shimmer-mid: #e2e6ec;
      --tv-shimmer-error: #ffe0e0;

      --tv-anim-duration: 200ms;
      --tv-anim-easing: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    :host(.tv-size-small) {
      --tv-font: 11.5px;
      --tv-meta-font: 10px;
      --tv-icon-size: 12px;
      --tv-indent-base: 6px;
      --tv-indent-step: 10px;
      --tv-gap: 4px;
      --tv-padding-x: 8px;
      --tv-grip-width: 12px;
    }

    :host(.tv-size-large) {
      --tv-font: 14px;
      --tv-meta-font: 12px;
      --tv-icon-size: 16px;
      --tv-indent-base: 10px;
      --tv-indent-step: 18px;
      --tv-gap: 8px;
      --tv-padding-x: 16px;
      --tv-grip-width: 16px;
    }

    :host(.tv-theme-dark) {
      --tv-bg-canvas: #0d1117;
      --tv-bg-row: #161b22;
      --tv-bg-header: linear-gradient(#1c232b, #161b22);
      --tv-bg-hover: #21262d;
      --tv-bg-active: #1f2c3d;
      --tv-bg-active-header: linear-gradient(#1f2c3d, #16243b);
      --tv-bg-selected: linear-gradient(#1f3a5e, #16345a);
      --tv-bg-selected-active: linear-gradient(#1a3d6a, #102f5a);
      --tv-bg-error: #2a1416;
      --tv-text: #c9d1d9;
      --tv-text-strong: #f0f6fc;
      --tv-text-muted: #8b949e;
      --tv-text-subtle: #adbac7;
      --tv-text-disabled: #6e7681;
      --tv-text-error: #f85149;
      --tv-border: #30363d;
      --tv-border-soft: #21262d;
      --tv-accent: #58a6ff;
      --tv-accent-soft: #18243a;
      --tv-shimmer-from: #1c232b;
      --tv-shimmer-mid: #2a3340;
      --tv-shimmer-error: #4d1c20;
    }

    .scroller-host {
      position: relative;
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: var(--tv-bg-canvas);
    }

    .scroller {
      position: relative;
      height: 100%;
      width: 100%;
      overflow: auto;
      contain: strict;
      background: var(--tv-bg-canvas);
      color: var(--tv-text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
      'Segoe UI', Roboto, sans-serif;
    }

    .scroller:focus {
      outline: none;
    }

    .scroller:focus-visible {
      outline: 2px solid var(--tv-accent);
      outline-offset: -2px;
    }

    .canvas {
      position: relative;
      width: 100%;
    }

    /* Pulsed after a drop or expand/collapse — descendant blocks/collapses
       glide to their new top, and the canvas height transitions instead of
       snapping. Scoped to .tv-animate so consumers can opt out. */
    :host(.tv-animate) .canvas.is-animating app-block,
    :host(.tv-animate) .canvas.is-animating app-collapse {
      transition: top var(--tv-anim-duration) var(--tv-anim-easing);
    }

    :host(.tv-animate) .canvas.is-animating {
      transition: height var(--tv-anim-duration) var(--tv-anim-easing);
    }

    /* Smooth transitions for sticky headers when they enter/exit the stack */
    :host(.tv-animate) .sticky-stack .tv-header {
      transition: top var(--tv-anim-duration) var(--tv-anim-easing),
                  box-shadow var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .sticky-stack {
      /* Sticks at top:0 inside the scroller. height:0 + overflow:visible means
         it doesn't take flow space — the canvas below renders from y=0 — but
         absolute children inside still position relative to this host. z-index
         lifts it above .canvas content; the browser's native scrollbar still
         paints above this layer, so it stays visible and clickable on macOS
         overlay + Win/Linux classic. */
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      height: 0;
      overflow: visible;
      pointer-events: none;
      z-index: 1;
    }

    .sticky-stack .tv-header {
      pointer-events: auto;
      position: absolute;
      display: flex;
      align-items: center;
      gap: var(--tv-gap);
      background: var(--tv-bg-row);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      border-bottom: 1px solid var(--tv-border);
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: var(--tv-font);
      color: var(--tv-text-strong);
      padding-left: calc(var(--tv-indent-base) + var(--tv-depth, 0) * var(--tv-indent-step));
      padding-right: var(--tv-padding-x);
      box-sizing: border-box;
    }

    .sticky-stack .sticky-backplate {
      position: absolute;
      pointer-events: none;
      box-sizing: border-box;
      box-shadow: var(--tv-sticky-shadow, none);
      border-radius: var(--tv-sticky-radius, 0);
      background: var(--tv-sticky-bg, transparent);
    }

    .sticky-stack .tv-header .caret {
      width: var(--tv-icon-size);
      color: var(--tv-text-subtle);
      display: inline-block;
      transform-origin: 50% 50%;
      font-size: 0.85em;
    }

    :host(.tv-animate) .sticky-stack .tv-header .caret {
      transition: transform var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .sticky-stack .tv-header .caret.is-expanded {
      transform: rotate(90deg);
    }

    .sticky-stack .tv-header .label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sticky-stack .tv-header .meta {
      font-size: var(--tv-meta-font);
      color: var(--tv-text-muted);
      font-weight: 400;
    }

    .sticky-stack .tv-header.is-selected {
      background: var(--tv-bg-selected);
    }

    .sticky-stack .tv-header.is-active {
      box-shadow: inset 2px 0 0 var(--tv-accent), 0 1px 2px rgba(0, 0, 0, 0.08);
    }

    .sticky-stack .tv-header.is-disabled {
      color: var(--tv-text-disabled);
      cursor: default;
    }

    .sticky-stack .tv-header.is-disabled .tv-check {
      pointer-events: none;
      opacity: 0.5;
    }

    .sticky-stack .tv-header.is-drag-source {
      opacity: 0.35;
    }

    .sticky-stack .tv-header.is-in-drag-subtree {
      opacity: 0.4;
      pointer-events: none;
    }

    .tv-check {
      flex: 0 0 auto;
      margin: 0 4px 0 0;
      cursor: pointer;
      width: var(--tv-icon-size);
      height: var(--tv-icon-size);
    }
  `,
})
export class TreeView {
  readonly root = input.required<CollapseNode>();
  readonly overscan = input<number>(200);
  readonly stickyHeaders = input<boolean>(true);
  /**
   * Visual configuration for the sticky-header stack. Affects rendering only —
   * canvas headers stay at the node's natural `headerSize()`. `itemHeight` is
   * the (potentially larger) height each sticky row takes; the others inset
   * the stack from the scroller edges. The collapsed node's sticky row and
   * its canvas row are vertically center-aligned via a `scrollTop` snap, so
   * `itemHeight` can differ from `headerSize()` without visual jumps.
   */
  readonly stickyConfig = input<StickyConfig>({});
  /**
   * Externally controlled expanded-key set. `null` (default) keeps the
   * built-in `CollapseNode.collapsed` signal as the owner — useful for the
   * standalone demo. Pass a `ReadonlySet<Key>` to drive expansion from the
   * outside; pair with `(expandedKeysChange)` for two-way binding.
   */
  readonly expandedKeys = input<ReadonlySet<Key> | null>(null);
  /** Override the default `node.id` key derivation. */
  readonly keyFn = input<KeyFn | undefined>(undefined);
  /**
   * Selection mode. `'none'` (default) disables click-driven selection
   * entirely. `'single'` replaces selection on any click. `'multiple'` honors
   * ctrl/cmd to toggle and shift to range-select.
   */
  readonly selectionMode = input<SelectionMode>('none');
  /** Externally controlled selected-key set. */
  readonly selectedKeys = input<ReadonlySet<Key>>(new Set());
  /**
   * Checkable settings. Boolean shortcut: `true` enables with multi-mode +
   * checkChildren + checkParents defaults; `false` (default) disables.
   */
  readonly checkable = input<boolean | CheckableSettings>(false);
  /** Externally controlled checked-key set. */
  readonly checkedKeys = input<ReadonlySet<Key>>(new Set());
  /**
   * Search term applied across the tree. Empty string (default) disables
   * filtering. Pair with `filterSettings` to control operator / mode.
   */
  readonly filter = input<string>('');
  readonly filterSettings = input<FilterSettings>({});
  /** When `true` (default), filter matches auto-expand collapsed ancestors. */
  readonly autoExpandFilterMatches = input<boolean>(true);
  /**
   * Keys of nodes that are disabled. Disabled rows/collapses ignore click
   * selection + check toggles. Cascading by default: descendants of a
   * disabled CollapseNode inherit the state (unless `disableParentNodesOnly`).
   */
  readonly disabledKeys = input<ReadonlySet<Key>>(new Set());
  /** When `true`, only explicitly-listed keys are disabled (no cascade). */
  readonly disableParentNodesOnly = input<boolean>(false);
  /** When `true`, disabled Collapses can still expand/collapse. */
  readonly expandDisabledNodes = input<boolean>(false);
  /**
   * Opt into row drag-and-drop. When `true`, every non-disabled row becomes
   * draggable via `@angular/cdk/drag-drop`. Drops fire `(nodeDropped)` and
   * (when `dragSourceAccessors` is provided) also mutate the source array
   * via `moveRow` so source + tree stay in lockstep.
   */
  readonly allowDrag = input<boolean>(false);
  /**
   * Source accessors used by the built-in drop handler to splice the
   * underlying data array. Required when you want automatic source sync.
   * Without it, `(nodeDropped)` still fires so the host can implement the
   * mutation itself.
   */
  readonly dragSourceAccessors = input<SourceAccessors<unknown, unknown> | null>(null);
  /**
   * When `true`, drag initiation is restricted to a dedicated grip rendered
   * inside each row (via `*cdkDragHandle`). Default `false` — the whole row
   * is grabbable. Useful when rows contain interactive inputs that shouldn't
   * trigger drag.
   */
  readonly dragHandle = input<boolean>(false);
  /**
   * Visual density. Drives a `tv-size-{variant}` host class that swaps a
   * curated set of CSS variables (font, padding, gap, icon size). Pair with
   * `applyTreeSize(root, variant)` from `./size` if you also want row /
   * header heights to follow the variant — the variant itself does not
   * rewrite already-bound `RowNode.size` values.
   */
  readonly size = input<SizeVariant>('medium');
  /** Color theme. Toggles a `tv-theme-dark` host class. */
  readonly theme = input<ThemeVariant>('light');
  /**
   * When `true` (default), expand/collapse and post-drop reflows transition
   * smoothly via the existing `is-animating` flash. The caret also rotates
   * with a transition. Set to `false` for instant, snappy feedback (useful
   * during stress testing or when the host wraps the tree in its own
   * animation system).
   */
  readonly animate = input<boolean>(true);
  readonly expandedKeysChange = output<ReadonlySet<Key>>();
  readonly selectedKeysChange = output<ReadonlySet<Key>>();
  readonly checkedKeysChange = output<ReadonlySet<Key>>();
  /**
   * Fires after a successful drag-and-drop move. Receives the source row, the
   * target row, and the relative position. When `dragSourceAccessors` is
   * supplied, the move has already been applied to the source array.
   */
  readonly nodeDropped = output<{
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }>();

  protected readonly expandController = inject(ExpandController);
  protected readonly selectionController = inject(SelectionController);
  protected readonly checkController = inject(CheckController);
  protected readonly navigationController = inject(NavigationController);
  protected readonly filterController = inject(FilterController);
  protected readonly disableController = inject(DisableController);
  protected readonly templateRegistry = inject(NodeTemplateRegistry);
  protected readonly dragService = inject(TreeDragService);
  protected readonly instance = inject(TreeViewInstance);
  private readonly scrollDispatcher = inject(ScrollDispatcher);

  /**
   * Captures `<ng-template appTreeViewNodeTemplate>` content-projected into
   * this LargeTreeView and forwards it to the registry. Row / Collapse pick
   * the template up reactively from the registry signal.
   */
  protected readonly nodeTemplateRef = contentChild(NodeTemplateDirective);

  protected readonly scroller =
    viewChild.required<ElementRef<HTMLDivElement>>('scroller');

  protected readonly scrollTop = signal(0);
  protected readonly viewportHeight = signal(600);

  protected readonly totalHeight = computed(() => this.root().height());

  protected readonly stickies = computed<CollapseNode[]>(() => {
    if (!this.stickyHeaders()) return [];
    const { marginTop } = this.resolvedStickyConfig();
    return collectStickyAncestors(
      this.root(),
      this.scrollTop(),
      marginTop,
    );
  });

  /** Resolved sticky config with defaults filled in. */
  protected readonly resolvedStickyConfig = computed(() => {
    const c = this.stickyConfig();
    return {
      marginTop: c.marginTop ?? 0,
      marginLeft: c.marginLeft ?? 0,
      marginRight: c.marginRight ?? 0,
    };
  });

  /**
   * Sticky overlay items: each gets a viewport-relative `top` so the first
   * sticky sits at `marginTop`, the next stacks below it, etc. Each item's
   * height comes from its node's `headerSize()`, so items can vary in size.
   */
  protected readonly stickyItems = computed<StickyItem[]>(() => {
    const stickies = this.stickies();
    const { marginTop } = this.resolvedStickyConfig();
    const items: StickyItem[] = [];
    let off = marginTop;
    for (let i = 0; i < stickies.length; i++) {
      const node = stickies[i];
      items.push({ node, top: off, index: i });
      off += node.headerSize();
    }
    return items;
  });

  /**
   * Total height the sticky stack occupies in the viewport, including the
   * top margin. Used as the canvas-content top inset for viewport culling.
   */
  protected readonly stickyStackHeight = computed(() => {
    const stickies = this.stickies();
    if (stickies.length === 0) return 0;
    const { marginTop } = this.resolvedStickyConfig();
    let total = marginTop;
    for (const node of stickies) total += node.headerSize();
    return total;
  });

  protected readonly stickyIds = computed<ReadonlySet<string>>(() => {
    const ids = new Set<string>();
    for (const c of this.stickies()) ids.add(c.id);
    return ids;
  });

  protected readonly effectiveViewportTop = computed(() => {
    const ssh = this.stickyStackHeight();
    const overscanTop = ssh > 0 ? 0 : this.overscan();
    return this.scrollTop() + ssh - overscanTop;
  });

  protected readonly effectiveViewportBottom = computed(
    () => this.scrollTop() + this.viewportHeight() + this.overscan(),
  );

  protected readonly ariaMultiselectable = computed(() =>
    this.selectionMode() === 'multiple' ? 'true' : null,
  );

  /**
   * `aria-activedescendant` mirrors the keyboard-focused node so screen readers
   * announce moves without us having to shuffle DOM focus around. We prefix
   * the node id to dodge collisions with whatever the consumer puts in `id`.
   */
  protected readonly ariaActiveDescendant = computed<string | null>(() => {
    const node = this.navigationController.activeNode();
    if (node === null) return null;
    return this.instance.domIdFor(node.id);
  });

  /**
   * Reverse index from node id (the part after the instance prefix) back to
   * either a RowNode or a CollapseNode. Built from a fresh walk on every tree
   * change; used by the drop hit-tester to resolve DOM-side ids.
   */
  protected readonly nodesById = computed<
    ReadonlyMap<string, RowNode | CollapseNode>
  >(() => {
    const map = new Map<string, RowNode | CollapseNode>();
    indexNodesByKey(this.root(), map);
    return map;
  });

  /**
   * Cached scroller `DOMRect` for the DropHint to position relative to. Updated
   * on `scroll` (the hint moves with the canvas) and `resize`.
   */
  protected readonly scrollerRect = signal<DOMRect | null>(null);

  /**
   * Pulsed `true` for ~300ms after a successful drop so rows whose vertical
   * position shifted glide into place instead of snapping. Bound to a class
   * on the canvas; CSS turns on `transition: top` only while the class is
   * present (so normal scrolling — where row tops also change as rows enter
   * the viewport — stays snappy).
   */
  protected readonly isAnimating = signal(false);
  private animTimer: ReturnType<typeof setTimeout> | null = null;

  private rafId = 0;
  private resizeObs: ResizeObserver | undefined;

  constructor() {
    this.expandController.configure({
      keyFn: () => this.keyFn(),
      externalKeys: () => this.expandedKeys(),
      root: () => this.root(),
      emit: (next) => this.expandedKeysChange.emit(next),
      onChange: (node, expanded) => {
        this.flashAnimating();
        if (!expanded) {
          this.keepCollapsedNodeInView(node);
        }
      },
    });
    this.selectionController.configure({
      keyFn: () => this.keyFn(),
      mode: () => this.selectionMode(),
      selectedKeys: () => this.selectedKeys(),
      root: () => this.root(),
      emit: (next) => this.selectedKeysChange.emit(next),
    });
    this.checkController.configure({
      keyFn: () => this.keyFn(),
      settings: () => this.checkable(),
      checkedKeys: () => this.checkedKeys(),
      root: () => this.root(),
      emit: (next) => this.checkedKeysChange.emit(next),
    });
    this.navigationController.configure({
      keyFn: () => this.keyFn(),
      root: () => this.root(),
    });
    this.navigationController.bind({
      expand: this.expandController,
      selection: this.selectionController,
      check: this.checkController,
    });
    this.filterController.configure({
      term: () => this.filter(),
      settings: () => this.filterSettings(),
      root: () => this.root(),
      autoExpandMatches: () => this.autoExpandFilterMatches(),
      onAutoExpand: (nodes) => {
        for (const n of nodes) this.expandController.expand(n);
      },
    });
    this.disableController.configure({
      keyFn: () => this.keyFn(),
      disabledKeys: () => this.disabledKeys(),
      disableParentNodesOnly: () => this.disableParentNodesOnly(),
      expandDisabledNodes: () => this.expandDisabledNodes(),
      root: () => this.root(),
    });
    this.dragService.registerTree({
      prefix: this.instance.prefix,
      enabled: () => this.allowDrag(),
      dragHandle: () => this.dragHandle(),
      scrollerElement: () => this.scroller()?.nativeElement ?? null,
      resolveTarget: (x, y, source) => {
        const hit = hitTestRow({
          clientX: x,
          clientY: y,
          source,
          instancePrefix: this.instance.prefix,
          resolveNode: (id) => this.nodesById().get(id) ?? null,
        });
        if (hit === null) return null;
        // Hide the drop hint for moves the built-in mutator can't carry out
        // (shape mismatch — e.g. dropping a Lane *into* another Lane whose
        // children are Tasks). When the host provides its own mutation
        // (`dragSourceAccessors` is null), skip the check and trust them.
        if (
          this.dragSourceAccessors() !== null &&
          !canDrop(source, hit.node, hit.position)
        ) {
          return null;
        }
        return {
          ownerPrefix: this.instance.prefix,
          node: hit.node,
          position: hit.position,
          element: hit.element,
        };
      },
      onDrop: (source, target) => this.handleDrop(source, target),
    });
    inject(DestroyRef).onDestroy(() =>
      this.dragService.unregisterTree(this.instance.prefix),
    );

    // Escape cancels an in-flight drag — register the listener only while a
    // drag is actually active so we don't burden every keystroke otherwise.
    effect((onCleanup) => {
      if (!this.dragService.isDragging()) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this.dragService.cancel();
          e.preventDefault();
          e.stopPropagation();
        }
      };
      document.addEventListener('keydown', handler, {capture: true});
      onCleanup(() =>
        document.removeEventListener('keydown', handler, {capture: true}),
      );
    });

    // While a drag is active, refresh the cached scroller rect on any scroll
    // anywhere in the document. `<html>` / `<body>` scrolling shifts the
    // scroller's viewport position, so the rect used by `DropHint` to convert
    // viewport-relative element rects to scroller-host-relative offsets has
    // to follow — otherwise the indicator drifts by the scroll delta.
    // `ScrollDispatcher.scrolled()` already attaches one capture-phase
    // listener on `document` and ref-counts subscribers, which is the
    // standard CDK pattern for global scroll observation.
    //
    // An initial sync at drag start is also required: page scrolling that
    // happened *before* the drag won't have refreshed `scrollerRect` (its
    // listeners only fire while we're subscribed), so the very first frame
    // of the drag would otherwise paint the indicator at the cached rect
    // from whenever the scroller last scrolled — typically off by the
    // accumulated page scroll delta.
    effect((onCleanup) => {
      if (!this.dragService.isDragging()) return;
      const el = this.scroller().nativeElement;
      this.scrollerRect.set(el.getBoundingClientRect());
      const sub = this.scrollDispatcher.scrolled().subscribe(() => {
        this.scrollerRect.set(el.getBoundingClientRect());
      });
      onCleanup(() => sub.unsubscribe());
    });

    // Forward content-projected `<ng-template appTreeViewNodeTemplate>` into
    // the shared registry on every change. `contentChild` returns a signal,
    // so the effect re-runs when the directive instance appears/disappears.
    effect(() => {
      const directive = this.nodeTemplateRef();
      this.templateRegistry.set(directive?.templateRef ?? null);
    });

    // When the active node changes, scroll it into view. Skipped while the
    // user is mid-scroll: this effect only fires on `activeNode` changes, not
    // on every scrollTop update.
    effect(() => {
      const node = this.navigationController.activeNode();
      if (node === null) return;
      untracked(() => this.scrollNodeIntoView(node));
    });

    afterNextRender(() => {
      const el = this.scroller().nativeElement;
      this.viewportHeight.set(el.clientHeight);
      this.scrollerRect.set(el.getBoundingClientRect());
      if (typeof ResizeObserver === 'undefined') return;
      this.resizeObs = new ResizeObserver((entries) => {
        for (const e of entries) {
          this.viewportHeight.set(e.contentRect.height);
        }
        this.scrollerRect.set(el.getBoundingClientRect());
      });
      this.resizeObs.observe(el);
    });

    inject(DestroyRef).onDestroy(() => {
      this.resizeObs?.disconnect();
      if (this.rafId) cancelAnimationFrame(this.rafId);
    });
  }

  onScroll(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const el = this.scroller().nativeElement;
      this.scrollTop.set(el.scrollTop);
      // Refresh the cached rect — auto-scroll during drag moves the canvas,
      // but the scroller element's getBoundingClientRect is stable; updating
      // here is cheap and keeps the rect in sync after layout changes too.
      this.scrollerRect.set(el.getBoundingClientRect());
    });
  }

  /**
   * The sticky overlay sits over the scroller; mouse-wheel events on stickies
   * would otherwise be swallowed. Forward them to the scroller so scrolling
   * over a sticky still moves the canvas.
   */
  onStickyWheel(e: WheelEvent): void {
    e.preventDefault();
    this.scroller().nativeElement.scrollBy({
      top: e.deltaY,
      left: e.deltaX,
    });
  }

  /**
   * Plain click on a sticky header toggles + selects (mirrors clicking the
   * underlying Collapse header). Modifier-key clicks (ctrl/cmd/shift) drive
   * selection only — the toggle would be jarring during a range-select.
   */
  onStickyClick(node: CollapseNode, event: MouseEvent): void {
    const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!hasModifier) this.expandController.toggle(node);
    this.navigationController.setActive(node);
    this.selectionController.handleClick(node, event);
    this.checkController.handleRowClick(node);
  }

  onStickyCheckClick(node: CollapseNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigationController.setActive(node);
    this.checkController.toggle(node);
  }

  /**
   * Match `Collapse.isInDragSubtree` for sticky-stack headers — the regular
   * collapse component skips rendering when sticky, so the sticky overlay
   * needs its own dim binding to stay consistent during drag.
   */
  protected isStickyInDragSubtree(node: CollapseNode): boolean {
    const src = this.dragService.source();
    if (src === null || src.kind !== 'collapse') return false;
    let cur: BlockNode | CollapseNode | null = node.parent;
    while (cur !== null) {
      if (cur === src) return true;
      cur = cur.parent;
    }
    return false;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.navigationController.handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Scroll just enough to bring `node` into the visible band, leaving the
   * sticky-header stack as a no-go zone at the top. Cheap: walks the parent
   * chain once via `absoluteTopOf`.
   */
  private scrollNodeIntoView(node: TreeNode): void {
    const el = this.scroller().nativeElement;
    const top = absoluteTopOf(node, this.root());
    const height =
      node.kind === 'row'
        ? node.renderSize()
        : node.kind === 'collapse'
          ? node.headerSize()
          : node.kind === 'loadmore'
            ? node.renderSize()
            : node.height();
    const bottom = top + height;
    // For sticky-eligible nodes (CollapseNode), exclude the node itself from
    // the sticky offset — otherwise we end up subtracting the full sticky
    // stack height that contains this very node, scrolling one header too far
    // up and letting a sibling slot into the stack at the boundary.
    const ssh =
      node.kind === 'collapse'
        ? this.ancestorStickyHeight(node)
        : this.stickyStackHeight();
    const viewTop = el.scrollTop + ssh;
    const viewBottom = el.scrollTop + el.clientHeight;
    if (top < viewTop) {
      // For collapse nodes, place sticky and canvas centers in line; for
      // non-sticky nodes (rows/loadmore) just put their top at the content top.
      el.scrollTop =
        node.kind === 'collapse'
          ? this.alignedScrollTopFor(node)
          : Math.max(0, top - ssh);
    } else if (bottom > viewBottom) {
      el.scrollTop = bottom - el.clientHeight;
    }
  }

  /**
   * Total visual height the ancestor sticky chain occupies in the viewport,
   * including `marginTop`. Each ancestor `CollapseNode` contributes its own
   * `headerSize()`. Used to compute the scrollTop that places `node` flush
   * with the bottom of its ancestor stack.
   */
  private ancestorStickyHeight(node: TreeNode): number {
    const { marginTop } = this.resolvedStickyConfig();
    let total = marginTop;
    let p: BlockNode | CollapseNode | null = node.parent;
    while (p !== null) {
      if (p.kind === 'collapse') total += p.headerSize();
      p = p.parent;
    }
    return total;
  }

  /**
   * scrollTop that places `node`'s sticky row flush with the bottom of its
   * ancestor stack. With the sticky stack using each node's own `headerSize()`,
   * this collapses to `node.canvasTop − ancestorSsh`.
   */
  private alignedScrollTopFor(node: CollapseNode): number {
    const top = absoluteTopOf(node, this.root());
    const ancestorSsh = this.ancestorStickyHeight(node);
    return Math.max(0, top - ancestorSsh);
  }

  /**
   * After a user collapses a `CollapseNode`, snap the scroll so the collapsed
   * header sits flush with the bottom of the sticky stack — but only when it
   * isn't already fully visible in the canvas-content area. If the header is
   * currently in view (between the sticky stack bottom and the viewport
   * bottom), don't jerk the scroll: the user can see what they just collapsed.
   *
   * Uses the **ancestor** sticky height for the new scrollTop (not the current
   * `stickyStackHeight()`): before the collapse, `node` itself (and possibly
   * descendants) sat in the sticky stack — counting them would scroll one
   * header too far, dropping a sibling slot into the stack at the boundary.
   */
  private keepCollapsedNodeInView(node: CollapseNode): void {
    const el = this.scroller().nativeElement;
    const top = absoluteTopOf(node, this.root());
    const headerBottom = top + node.headerSize();
    const contentTop = el.scrollTop + this.stickyStackHeight();
    const viewportBottom = el.scrollTop + el.clientHeight;
    if (top >= contentTop && headerBottom <= viewportBottom) return;
    el.scrollTop = this.alignedScrollTopFor(node);
  }

  /**
   * Drop handler shared by the TreeDragService. If `dragSourceAccessors` is
   * supplied, splices the source array via `moveRow` (keeping source + tree
   * in lockstep); otherwise just emits `nodeDropped` and trusts the host to
   * mutate. Either way, `nodeDropped` fires for callers that want to react
   * (logging, persisting to a server, etc.).
   */
  private handleDrop(
    source: RowNode | CollapseNode,
    target: TreeDropTarget,
  ): void {
    const accessors = this.dragSourceAccessors();
    if (accessors === null) {
      this.flashAnimating();
      this.nodeDropped.emit({
        source,
        target: target.node,
        position: target.position,
      });
      return;
    }
    // `resolveTarget` already filters via `canDrop`, but re-check defensively
    // in case a caller wired `onDrop` from a custom hit-tester.
    if (!canDrop(source, target.node, target.position)) return;

    let mutated = false;
    if (source.kind === 'row') {
      if (target.node.kind === 'row') {
        mutated = moveRow(
          source,
          target.node,
          target.position as 'before' | 'after',
          accessors,
        );
      } else {
        mutated = moveRowAsChild(source, target.node, 'last', accessors);
      }
    } else if (target.node.kind === 'collapse') {
      mutated = moveCollapse(source, target.node, target.position, accessors);
    } else {
      // source = collapse, target = row, position must be 'before' / 'after'
      // (canDrop rejects 'over'). Splice source into the row's enclosing
      // collapse, adjacent to the block that holds the anchor row.
      mutated = moveCollapseBesideRow(
        source,
        target.node,
        target.position as 'before' | 'after',
        accessors,
      );
    }

    if (mutated) {
      this.flashAnimating();
      this.nodeDropped.emit({
        source,
        target: target.node,
        position: target.position,
      });
    }
  }

  private flashAnimating(): void {
    if (!this.animate()) return;
    if (this.animTimer !== null) clearTimeout(this.animTimer);
    this.isAnimating.set(true);
    this.animTimer = setTimeout(() => {
      this.isAnimating.set(false);
      this.animTimer = null;
    }, TV_ANIMATION_DURATION_MS);
  }
}

/**
 * Mirrors the cases `handleDrop` actually mutates. Returns `true` when the
 * built-in mutator can carry out `source → target [position]`; `false` when
 * the move is structurally impossible (self-drop / cycle / no parent). Called
 * from `resolveTarget` to suppress the hint, and re-checked in `handleDrop`
 * as a defensive guard.
 *
 * Like Mac Finder: any folder can host any other folder, regardless of what
 * children it already has. The data layer's accessor decides which array a
 * dropped node lands in based on the node's shape, so mixing kinds in a
 * single parent works as long as the accessor is polymorphic.
 */
function canDrop(
  source: RowNode | CollapseNode,
  target: RowNode | CollapseNode,
  position: 'before' | 'over' | 'after',
): boolean {
  // Self-drop / dragged-collapse-into-its-own-subtree are rejected earlier in
  // `hitTestRow`; no need to re-check here.
  if (source.kind === 'row') {
    if (target.kind === 'row') return position !== 'over';
    // row → collapse is only meaningful as "drop into folder" (position
    // 'over'); before/after on a collapse header has no `moveRow` analogue.
    return position === 'over';
  }
  // source.kind === 'collapse'
  if (target.kind === 'row') {
    // collapse → row only at edge positions: splice the source folder in
    // beside the block that holds the anchor row. Dropping *on* a row is
    // meaningless (rows aren't containers).
    return position !== 'over';
  }
  if (position === 'over') return true;
  return target.parent !== null;
}

/**
 * Recursively index every `RowNode` and `CollapseNode` under `root` (including
 * the root itself) by its key. Used by the DnD hit-tester to map DOM ids back
 * to nodes after the cursor lands on a `[id]`-bearing row or header.
 */
function indexNodesByKey(
  root: CollapseNode,
  out: Map<string, RowNode | CollapseNode>,
): void {
  visitCollapse(root);

  function visitCollapse(node: CollapseNode): void {
    // Include the root so single-top-level trees (where the root *is* the
    // user-visible folder, e.g. a Bucket in demo-11) can receive drops on
    // their header — drop-on-collapse becomes "drop into the bucket".
    out.set(node.id, node);
    for (const c of node.children()) {
      if (c.kind === 'block') visitBlock(c);
      else visitCollapse(c);
    }
  }

  function visitBlock(node: BlockNode): void {
    for (const c of node.children()) {
      if (c.kind === 'row') out.set(c.id, c);
      else if (c.kind === 'block') visitBlock(c);
      else visitCollapse(c);
    }
  }
}
