import { computed, Signal, signal, WritableSignal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { take as takeOne } from 'rxjs/operators';

export const DEFAULT_BLOCK_SIZE = 20;
export const DEFAULT_ROW_SIZE = 28;
export const DEFAULT_ROW_MIN_SIZE = 18;
export const DEFAULT_ROW_MAX_SIZE = 480;

/**
 * `invisible` is a bitmask of "hide reasons". A value of `0` means fully
 * visible; any value `> 0` means the node is hidden by at least one source.
 * Sources can be set/cleared independently with the bit constants below.
 *
 * `HIDE_COLLAPSED` is a special case: it only applies to `CollapseNode` and
 * means the node's *children* are hidden — the header still renders. Every
 * other bit hides the node entirely (header + body).
 *
 * Ancestor collapse state is **not** propagated as a bit. Callers that need
 * "is any ancestor collapsed/hidden?" use `isAncestorHidden()` which walks the
 * `parent` chain — O(depth), and safe to call inside a `computed()` because
 * each ancestor's own `invisible` signal is tracked along the way.
 */
export const HIDE_USER = 1 << 0;
export const HIDE_FILTER = 1 << 1;
export const HIDE_COLLAPSED = 1 << 2;

/** Bits that hide the node entirely (header + body). */
export const HIDE_SELF_MASK = HIDE_USER | HIDE_FILTER;

export type TreeNode = BlockNode | CollapseNode | RowNode | LoadMoreNode;
/**
 * Direct children of a CollapseNode. Rows never appear here directly — leaf
 * rows always sit inside a BlockNode so every level of the tree has uniform,
 * O(blockSize) iteration semantics.
 */
export type CollapseChild = BlockNode | CollapseNode;
/**
 * Children that can live inside a Block. Leaf blocks hold rows directly;
 * group blocks hold further sub-blocks. The chunker keeps each Block at most
 * `blockSize` children, so a 10k-row dataset becomes a balanced tree of
 * Blocks (≤ 20 sub-blocks per group, depth ≈ log₂₀ N) — every level
 * participates in viewport culling, no level renders more than `blockSize`
 * siblings.
 */
/**
 * Direct children of a BlockNode. RowNodes are leaf items; BlockNodes
 * are sub-blocks (group nesting); CollapseNodes are folders that the
 * user may drop into the middle of a row run. Allowing CollapseNode here
 * lets a drop on `row[N]` insert a folder *between* rows without
 * splitting the host block — the block keeps its identity, its children
 * just become mixed kinds.
 */
export type BlockChild = BlockNode | RowNode | CollapseNode;

export interface RowNodeInit {
  id: string;
  label: string;
  size?: number;
  minSize?: number;
  maxSize?: number;
  /** Initial visibility — `false` initializes `invisible` with the `HIDE_USER` bit. Default `true`. */
  visible?: boolean;
  meta?: unknown;
}

export class RowNode {
  readonly kind = 'row' as const;
  readonly id: string;
  readonly label: WritableSignal<string>;
  readonly size: WritableSignal<number>;
  readonly minSize: number;
  readonly maxSize: number;
  /**
   * Bitmask of hide reasons. `0` = fully visible; any value `> 0` means hidden
   * by at least one source. See `HIDE_USER` / `HIDE_FILTER` /
   * `HIDE_PARENT_COLLAPSED` — callers and the filter pipeline set their
   * respective bits independently, so clearing the filter doesn't stomp on
   * user-controlled hides and vice versa.
   */
  readonly invisible: WritableSignal<number>;
  readonly renderSize: Signal<number>;
  readonly meta: unknown;
  parent: BlockNode | null = null;

  constructor(init: RowNodeInit) {
    this.id = init.id;
    this.label = signal(init.label);
    this.size = signal(init.size ?? DEFAULT_ROW_SIZE);
    this.minSize = init.minSize ?? DEFAULT_ROW_MIN_SIZE;
    this.maxSize = init.maxSize ?? DEFAULT_ROW_MAX_SIZE;
    this.invisible = signal(init.visible === false ? HIDE_USER : 0);
    this.meta = init.meta;

    this.renderSize = computed(() => {
      if (this.invisible() > 0) return 0;
      const lo = this.minSize;
      const hi = Math.max(this.maxSize, lo);
      return Math.max(lo, Math.min(hi, this.size()));
    });
  }

  /**
   * True iff any ancestor `CollapseNode` is collapsed or hidden. Walks the
   * `parent` chain — O(depth). Safe inside `computed()`: each ancestor's
   * `invisible` signal is tracked as a dependency.
   */
  isAncestorHidden(): boolean {
    return walkAncestorHidden(this.parent);
  }
}

export interface BlockNodeInit {
  id: string;
  /** Logical depth in the source data — does not contribute to visual indent. */
  depth?: number;
  /**
   * Maximum children per Block. Used by the mutation API to decide when a
   * Block must split (`>= 2 * blockSize` triggers a split into two halves).
   * Immutable for the life of the block. Default `DEFAULT_BLOCK_SIZE`.
   */
  blockSize?: number;
  /** Initially loaded children — rows for leaf blocks, sub-blocks for groups. */
  children?: BlockChild[];
  /**
   * Total rows this Block represents, including not-yet-loaded ones. When
   * omitted, defaults to `children.length` (no lazy slots). Pass an explicit
   * number larger than `children.length` to declare placeholder slots that
   * contribute to the Block's height before data arrives.
   *
   * Only meaningful for leaf blocks (children are RowNodes); group blocks
   * derive their height from their sub-blocks and ignore placeholder slots.
   */
  totalRowCount?: number;
  /** Row size assumed for placeholder rows (default `DEFAULT_ROW_SIZE`). */
  defaultRowSize?: number;
  /**
   * Lazy loader. Subscribed once when the Block first becomes visible (or via
   * an explicit `ensureLoaded()` call). Each emission replaces `children` and
   * reconciles `totalRowCount` — the subscription stays open, so a loader that
   * keeps emitting (e.g. server-sent updates) drives realtime row refreshes.
   * Only valid for leaf blocks. Call `dispose()` to tear the subscription
   * down explicitly.
   */
  loadRows?: () => Observable<RowNode[]>;
  meta?: unknown;
}

export type BlockLoadState = 'idle' | 'loading' | 'loaded' | 'error';

/**
 * Logic-only chunk for handling large data. Holds either a flat list of rows
 * (leaf block) or further BlockNodes (group block) — never mixed. Renders no
 * UI of its own; the `Block` component performs viewport culling on the
 * children. `depth` is kept as a logical value (e.g. for debugging or remote
 * paging), not for visual indentation.
 *
 * Supports lazy loading on leaf blocks: declare `totalRowCount` upfront so
 * virtualization can size the Block correctly, then `loadRows()` is invoked
 * on first visibility to fetch the actual `RowNode`s. While unloaded, the
 * height is the sum of `children.renderSize()` plus
 * `(totalRowCount - children.length) * defaultRowSize`.
 *
 * For balanced trees, callers use the recursive chunker (`chunkRows`) which
 * groups every `blockSize` siblings into a parent Block so no level renders
 * more than `blockSize` children.
 */
export class BlockNode {
  readonly kind = 'block' as const;
  readonly id: string;
  readonly depth: number;
  /** Immutable per-instance chunk-size used by the mutation API's split rule. */
  readonly blockSize: number;
  readonly children: WritableSignal<BlockChild[]>;
  readonly totalRowCount: WritableSignal<number>;
  readonly defaultRowSize: WritableSignal<number>;
  readonly loadState: WritableSignal<BlockLoadState>;
  readonly meta: unknown;
  parent: CollapseNode | BlockNode | null = null;

  readonly height: Signal<number>;
  readonly nodeCount: Signal<number>;

  private readonly loadRowsFn: (() => Observable<RowNode[]>) | null;
  private loadSubscription: Subscription | null = null;

  constructor(init: BlockNodeInit) {
    this.id = init.id;
    this.depth = init.depth ?? 0;
    this.blockSize = init.blockSize ?? DEFAULT_BLOCK_SIZE;
    const initialChildren = init.children ?? [];
    const total = init.totalRowCount ?? initialChildren.length;
    this.children = signal<BlockChild[]>(initialChildren);
    this.totalRowCount = signal(total);
    this.defaultRowSize = signal(init.defaultRowSize ?? DEFAULT_ROW_SIZE);
    this.loadRowsFn = init.loadRows ?? null;
    this.loadState = signal<BlockLoadState>(
      this.loadRowsFn === null && initialChildren.length >= total
        ? 'loaded'
        : 'idle',
    );
    this.meta = init.meta;

    for (const c of initialChildren) c.parent = this;

    this.height = computed(() => {
      const children = this.children();
      let total = 0;
      let isLeaf = true;
      for (const c of children) {
        if (c.kind === 'row') {
          total += c.renderSize();
        } else {
          total += c.height();
          isLeaf = false;
        }
      }
      // Placeholder slots only apply to leaf blocks (children are rows).
      // Group blocks derive their full height from sub-block heights.
      if (isLeaf) {
        const remaining = Math.max(0, this.totalRowCount() - children.length);
        if (remaining > 0) total += remaining * this.defaultRowSize();
      }
      return total;
    });

    this.nodeCount = computed(() => {
      const children = this.children();
      let n = 0;
      for (const c of children) {
        n += c.kind === 'row' ? 1 : c.nodeCount();
      }
      return Math.max(this.totalRowCount(), n);
    });
  }

  /**
   * Subscribe to the lazy loader if one is configured and we haven't already.
   * Idempotent: a second call while a subscription exists is a no-op. The
   * subscription stays open after the first emission — every later emission
   * replaces `children` and reconciles `totalRowCount`, so a loader that
   * keeps streaming (server push, polling) drives realtime updates.
   *
   * State transitions on `loadState`: `'idle' → 'loading' → 'loaded'` on the
   * first emission; subsequent emissions keep it at `'loaded'`. On error,
   * `loadState` flips to `'error'` and the subscription is dropped so a
   * subsequent call retries.
   */
  ensureLoaded(): void {
    if (this.loadSubscription !== null) return;
    if (this.loadState() === 'loaded' || this.loadRowsFn === null) return;
    this.loadState.set('loading');
    this.loadSubscription = this.loadRowsFn().subscribe({
      next: (rows) => {
        this.setChildren(rows);
        this.totalRowCount.set(rows.length);
        this.loadState.set('loaded');
      },
      error: () => {
        this.loadState.set('error');
        this.loadSubscription = null;
      },
    });
  }

  /**
   * Tear down the realtime loader subscription, if any. Safe to call even
   * when not subscribed. After dispose, `ensureLoaded()` can be invoked again
   * to re-subscribe (e.g. after a parent re-attaches the block).
   */
  dispose(): void {
    this.loadSubscription?.unsubscribe();
    this.loadSubscription = null;
  }

  setChildren(children: BlockChild[]): void {
    for (const c of children) c.parent = this;
    this.children.set(children);
  }

  appendChildren(children: BlockChild[]): void {
    for (const c of children) c.parent = this;
    this.children.update((prev) => [...prev, ...children]);
  }

  /**
   * Insert a child at the given index. The mutation API uses this when adding
   * a single row to a leaf block or a sibling block during a split. Updates
   * the child's parent pointer and triggers a fresh children-signal emission.
   */
  insertChildAt(index: number, child: BlockChild): void {
    child.parent = this;
    this.children.update((prev) => {
      const next = prev.slice();
      next.splice(index, 0, child);
      return next;
    });
  }

  /** Remove the child at the given index. Returns the removed child or `null`. */
  removeChildAt(index: number): BlockChild | null {
    const cur = this.children();
    if (index < 0 || index >= cur.length) return null;
    const removed = cur[index];
    this.children.update((prev) => {
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
    removed.parent = null;
    return removed;
  }

  /** Remove the given child by reference. Returns true if it was present. */
  removeChild(child: BlockChild): boolean {
    const idx = this.children().indexOf(child);
    if (idx === -1) return false;
    this.removeChildAt(idx);
    return true;
  }
}

export interface CollapseNodeInit {
  id: string;
  label: string;
  depth?: number;
  headerSize?: number;
  collapsed?: boolean;
  children?: CollapseChild[];
  visible?: boolean;
  /** Optional trailer button used to fetch/reveal additional children. */
  loadMore?: LoadMoreNode | null;
  meta?: unknown;
}

/**
 * UI-level node carrying a header and collapse/expand state. Forms the tree
 * skeleton — its children may be other Collapses, Blocks (leaf row chunks),
 * or Rows directly. `depth` is the visual depth used for indentation.
 *
 * An optional `loadMore` slot may be attached: when expanded, it renders as a
 * trailing "Load more" row after the children. The slot is **not** part of
 * `children()`, so keyed walkers (selection / check / expand) ignore it.
 *
 * `visible` collapses the node entirely (header + body → 0px) — used by the
 * filter pass to hide branches that have no matching descendants. A visible
 * Collapse with all-invisible children still contributes its header height,
 * so an ancestor "keep this open" decision is reflected in layout.
 */
export class CollapseNode {
  readonly kind = 'collapse' as const;
  readonly id: string;
  readonly label: WritableSignal<string>;
  /**
   * Visual depth used for indentation (`--tv-depth` CSS variable). Reactive
   * so that moving a Collapse under a new parent re-renders its host plus
   * all descendants with the corrected indent — `moveCollapse` walks the
   * subtree and calls `.set(...)` after re-parenting.
   */
  readonly depth: WritableSignal<number>;
  readonly headerSize: WritableSignal<number>;
  readonly children: WritableSignal<CollapseChild[]>;
  /**
   * Bitmask of hide reasons. See `RowNode.invisible`. For `CollapseNode`,
   * `HIDE_COLLAPSED` is special — it hides the body only, the header still
   * renders. The other bits (`HIDE_USER`, `HIDE_FILTER`, `HIDE_PARENT_COLLAPSED`)
   * hide the entire node.
   */
  readonly invisible: WritableSignal<number>;
  readonly loadMore: WritableSignal<LoadMoreNode | null>;
  readonly meta: unknown;
  parent: CollapseNode | BlockNode | null = null;

  readonly height: Signal<number>;
  readonly nodeCount: Signal<number>;

  constructor(init: CollapseNodeInit) {
    this.id = init.id;
    this.label = signal(init.label);
    this.depth = signal(init.depth ?? 0);
    this.headerSize = signal(init.headerSize ?? DEFAULT_ROW_SIZE);
    const initialChildren = init.children ?? [];
    this.children = signal<CollapseChild[]>(initialChildren);
    let mask = 0;
    if (init.visible === false) mask |= HIDE_USER;
    if (init.collapsed) mask |= HIDE_COLLAPSED;
    this.invisible = signal(mask);
    const initialLoadMore = init.loadMore ?? null;
    this.loadMore = signal<LoadMoreNode | null>(initialLoadMore);
    this.meta = init.meta;

    for (const c of initialChildren) c.parent = this;
    if (initialLoadMore !== null) initialLoadMore.parent = this;

    this.height = computed(() => {
      const m = this.invisible();
      if ((m & HIDE_SELF_MASK) !== 0) return 0;
      const header = this.headerSize();
      if ((m & HIDE_COLLAPSED) !== 0) return header;
      let total = header;
      // Collapse only ever holds Blocks and other Collapses — both expose
      // `height()`. No row branch needed; rows always sit inside a Block.
      for (const c of this.children()) total += c.height();
      const lm = this.loadMore();
      if (lm !== null) total += lm.renderSize();
      return total;
    });

    this.nodeCount = computed(() => {
      let n = 1;
      for (const c of this.children()) n += c.nodeCount();
      return n;
    });
  }

  /** True iff `HIDE_COLLAPSED` is set on this node (body hidden, header shown). */
  collapsed(): boolean {
    return (this.invisible() & HIDE_COLLAPSED) !== 0;
  }

  /**
   * True iff any ancestor `CollapseNode` is collapsed or hidden. Walks the
   * `parent` chain — O(depth). Each ancestor's `invisible` signal is read, so
   * call sites inside a `computed()` track those signals automatically.
   */
  isAncestorHidden(): boolean {
    return walkAncestorHidden(this.parent);
  }

  toggle(): void {
    this.setCollapsed(!this.collapsed());
  }

  expand(): void {
    if (this.collapsed()) this.setCollapsed(false);
  }

  collapse(): void {
    if (!this.collapsed()) this.setCollapsed(true);
  }

  /** Flip the `HIDE_COLLAPSED` bit on this node. O(1). */
  setCollapsed(value: boolean): void {
    const cur = this.invisible();
    const wasCollapsed = (cur & HIDE_COLLAPSED) !== 0;
    if (wasCollapsed === value) return;
    this.invisible.set(value ? cur | HIDE_COLLAPSED : cur & ~HIDE_COLLAPSED);
  }

  setChildren(children: CollapseChild[]): void {
    for (const c of children) c.parent = this;
    this.children.set(children);
  }

  appendChildren(children: CollapseChild[]): void {
    for (const c of children) c.parent = this;
    this.children.update((prev) => [...prev, ...children]);
  }

  /** Insert a child at the given index, updating its parent pointer. */
  insertChildAt(index: number, child: CollapseChild): void {
    child.parent = this;
    this.children.update((prev) => {
      const next = prev.slice();
      next.splice(index, 0, child);
      return next;
    });
  }

  /** Remove the child at the given index. Returns the removed child or `null`. */
  removeChildAt(index: number): CollapseChild | null {
    const cur = this.children();
    if (index < 0 || index >= cur.length) return null;
    const removed = cur[index];
    this.children.update((prev) => {
      const next = prev.slice();
      next.splice(index, 1);
      return next;
    });
    removed.parent = null;
    return removed;
  }

  /** Remove the given child by reference. Returns true if it was present. */
  removeChild(child: CollapseChild): boolean {
    const idx = this.children().indexOf(child);
    if (idx === -1) return false;
    this.removeChildAt(idx);
    return true;
  }

  setLoadMore(node: LoadMoreNode | null): void {
    if (node !== null) node.parent = this;
    this.loadMore.set(node);
  }
}

export function setCollapsedRecursive(root: CollapseNode, collapsed: boolean): void {
  const stack: CollapseNode[] = [root];
  while (stack.length) {
    const c = stack.pop() as CollapseNode;
    if (c.collapsed() !== collapsed) c.setCollapsed(collapsed);
    for (const child of c.children()) {
      if (child.kind === 'collapse') stack.push(child);
    }
  }
}

/**
 * Walk the `parent` chain from `start` upward and return `true` as soon as a
 * `CollapseNode` ancestor is collapsed or hidden (any bit in
 * `HIDE_COLLAPSED | HIDE_SELF_MASK`). `BlockNode`s have no visibility flags
 * of their own and are walked through transparently. Each ancestor's
 * `invisible` signal is read, so call sites inside a reactive context
 * (`computed`, template binding) track those signals automatically.
 */
function walkAncestorHidden(start: BlockNode | CollapseNode | null): boolean {
  let p: BlockNode | CollapseNode | null = start;
  while (p !== null) {
    if (p.kind === 'collapse') {
      if ((p.invisible() & (HIDE_COLLAPSED | HIDE_SELF_MASK)) !== 0) return true;
    }
    p = p.parent;
  }
  return false;
}

export type LoadMoreState = 'idle' | 'loading' | 'error';

export interface LoadMoreRequestArgs {
  /** The CollapseNode whose children are being extended. */
  readonly parent: CollapseNode;
  /** Number of children already loaded under `parent`. */
  readonly skip: number;
  /**
   * Recommended size of the next page. Callers may return fewer items — the
   * controller treats a short response as "no more pages" and clears the
   * trailer. Returning more than `take` is allowed and accepted as-is.
   */
  readonly take: number;
}

/**
 * Result of a single `loadFn` invocation. Two shapes are accepted:
 *
 * - `readonly CollapseChild[]` (legacy / shorthand) — the returned items
 *   are appended; a *short* response (count < `take`) implicitly signals
 *   "no more pages" and clears the trailer.
 * - `LoadMorePage` (explicit) — the server tells us up-front whether more
 *   pages remain via `hasMore`. Use this form when the API supplies an
 *   explicit "more available" flag and you don't want to rely on
 *   short-response detection (e.g. pages where the last page is exactly
 *   `pageSize` items, or pages where `take` was capped server-side).
 */
export interface LoadMorePage {
  readonly children: readonly CollapseChild[];
  /**
   * Explicit "another page exists" signal. When `false`, the trailer is
   * removed regardless of how many rows came back. When `true`, the
   * trailer stays even if this page returned fewer than `take` rows.
   * Omit to fall back to the short-response heuristic.
   */
  readonly hasMore?: boolean;
}

export type LoadMoreFn = (
  args: LoadMoreRequestArgs,
) => Observable<readonly CollapseChild[] | LoadMorePage>;

export interface LoadMoreNodeInit {
  id: string;
  pageSize: number;
  label?: string;
  size?: number;
  /**
   * Total children available across all pages. Defaults to `Infinity` (unknown
   * — keep showing the button until the loader returns a short page).
   */
  totalCount?: number;
  /** Children already present under the parent at construction time. */
  loadedCount?: number;
  loadFn: LoadMoreFn;
  meta?: unknown;
}

/**
 * Trailer node attached to a CollapseNode. Renders as a "Load more" button row
 * and is **not** part of `CollapseNode.children()` — keyed walkers (selection /
 * check / expand) ignore it. Only the Collapse renderer and height computation
 * read it.
 *
 * `load()` is idempotent during an in-flight request: concurrent callers are
 * no-ops while a load is pending. On a short response (or when
 * `loadedCount >= totalCount`), the node removes itself from its parent.
 */
export class LoadMoreNode {
  readonly kind = 'loadmore' as const;
  readonly id: string;
  readonly label: WritableSignal<string>;
  readonly renderSize: WritableSignal<number>;
  readonly pageSize: WritableSignal<number>;
  readonly loadedCount: WritableSignal<number>;
  readonly totalCount: WritableSignal<number>;
  readonly loadState: WritableSignal<LoadMoreState>;
  readonly meta: unknown;
  parent: CollapseNode | null = null;

  private readonly loadFn: LoadMoreFn;
  private loadSubscription: Subscription | null = null;

  constructor(init: LoadMoreNodeInit) {
    this.id = init.id;
    this.label = signal(init.label ?? 'Load more');
    this.renderSize = signal(init.size ?? DEFAULT_ROW_SIZE);
    this.pageSize = signal(init.pageSize);
    this.loadedCount = signal(init.loadedCount ?? 0);
    this.totalCount = signal(init.totalCount ?? Number.POSITIVE_INFINITY);
    this.loadState = signal<LoadMoreState>('idle');
    this.loadFn = init.loadFn;
    this.meta = init.meta;
  }

  hasMore(): boolean {
    return this.loadedCount() < this.totalCount();
  }

  remaining(): number {
    return Math.max(0, this.totalCount() - this.loadedCount());
  }

  /**
   * Trigger the next page load. No-op while a load is in flight. Track
   * progress via `loadState` / `loadedCount` signals — both are reactive.
   * On error, `loadState` flips to `'error'` and a subsequent call retries.
   */
  load(): void {
    if (this.loadSubscription !== null) return;
    const parent = this.parent;
    if (parent === null) return;
    if (!this.hasMore()) {
      parent.setLoadMore(null);
      return;
    }

    const skip = this.loadedCount();
    const take = Math.min(this.pageSize(), this.remaining());
    this.loadState.set('loading');
    this.loadSubscription = this.loadFn({ parent, skip, take })
      .pipe(takeOne(1))
      .subscribe({
        next: (result) => {
          const isPage = !Array.isArray(result);
          const children = isPage
            ? (result as LoadMorePage).children
            : (result as readonly CollapseChild[]);
          const explicitHasMore = isPage
            ? (result as LoadMorePage).hasMore
            : undefined;
          const added = children.length;
          if (added > 0) parent.appendChildren([...children]);
          this.loadedCount.update((v) => v + added);
          // Resolve "is there more?":
          //  - explicit `hasMore: false` → no more, regardless of count
          //  - explicit `hasMore: true`  → keep trailer, regardless of count
          //  - omitted → fall back to short-response heuristic
          if (explicitHasMore === false) {
            this.totalCount.set(this.loadedCount());
          } else if (explicitHasMore === undefined && added < take) {
            this.totalCount.set(this.loadedCount());
          }
          this.loadState.set('idle');
          if (!this.hasMore()) parent.setLoadMore(null);
        },
        error: () => {
          this.loadState.set('error');
        },
        complete: () => {
          this.loadSubscription = null;
        },
      });
  }
}
