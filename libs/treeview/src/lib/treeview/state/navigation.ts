import { computed, Injectable, signal, Signal } from '@angular/core';
import { BlockNode, CollapseNode, LoadMoreNode, RowNode, TreeNode, } from '../tree-model';
import { CheckController } from './check';
import { ExpandController } from './expand';
import { defaultKeyFn, Key, KeyFn } from './keys';
import { SelectionController } from './selection';

/** Navigable kinds — Block is virtualization-only and transparent to the user. */
export type NavigableNode = CollapseNode | RowNode | LoadMoreNode;

export interface NavigationControllerConfig {
  readonly keyFn: () => KeyFn | undefined;
  readonly root: () => CollapseNode;
}

/**
 * Tree-walking keyboard navigation. Holds the active `NavigableNode` directly
 * and resolves moves (next/prev/parent/first-child/home/end) by descending the
 * tree from the current node — O(depth × siblings) per keypress, immune to
 * LoadMore / Block.ensureLoaded mutations.
 *
 * `activeNode` is the source of truth; `activeKey` is a derived view for
 * serialization and two-way bindings. External callers that only have a key
 * (URL state, restored session) use `setActiveByKey`.
 *
 * BlockNode is transparent: its row children appear as if they were direct
 * siblings of the Block under the enclosing Collapse. The root CollapseNode
 * is navigable like any other — Home / End land on it when appropriate, and
 * ↑ from its first child / ← from its descendants walks up to it.
 *
 * Delegates side effects (selection, check, expand, load) to the other
 * controllers via `bind()`; works standalone if those bindings are omitted.
 */
@Injectable()
export class NavigationController {
  private cfg: NavigationControllerConfig | null = null;
  private expand: ExpandController | null = null;
  private selection: SelectionController | null = null;
  private check: CheckController | null = null;

  private readonly _active = signal<NavigableNode | null>(null);

  readonly activeNode: Signal<NavigableNode | null> = this._active.asReadonly();

  readonly activeKey: Signal<Key | null> = computed(() => {
    const node = this._active();
    if (node === null) return null;
    const cfg = this.cfg;
    if (cfg === null) return null;
    return (cfg.keyFn() ?? defaultKeyFn)(node);
  });

  configure(cfg: NavigationControllerConfig): void {
    this.cfg = cfg;
  }

  bind(controllers: {
    expand?: ExpandController;
    selection?: SelectionController;
    check?: CheckController;
  }): void {
    this.expand = controllers.expand ?? null;
    this.selection = controllers.selection ?? null;
    this.check = controllers.check ?? null;
  }

  isActive(node: TreeNode): boolean {
    return this._active() === node;
  }

  /** Convenience wrapper so templates don't need root themselves. */
  ariaLevel(node: TreeNode): number {
    const cfg = this.cfg;
    if (cfg === null) return 1;
    return ariaLevel(node, cfg.root());
  }

  /** Same convenience — `null` if the node isn't navigable. */
  ariaPosition(node: NavigableNode): AriaPosition | null {
    return ariaPosition(node);
  }

  setActive(node: NavigableNode | null): void {
    this._active.set(node);
  }

  /**
   * Restore active state from a serialized key (URL, session, `[(activeKey)]`).
   * Pays an O(N) DFS once at the boundary; internal navigation stays O(1).
   * Resolves to `null` if no navigable node matches.
   */
  setActiveByKey(key: Key | null): void {
    if (key === null) {
      this._active.set(null);
      return;
    }
    const cfg = this.cfg;
    if (cfg === null) return;
    this._active.set(
      findByKey(cfg.root(), cfg.keyFn() ?? defaultKeyFn, key),
    );
  }

  /**
   * Initialize the active node to the root when no active node has been set
   * yet. Called once by the host on first interaction.
   */
  ensureActive(): void {
    if (this._active() !== null) return;
    const cfg = this.cfg;
    if (cfg === null) return;
    this.setActive(cfg.root());
  }

  /** Route a keyboard event to the relevant action. Returns true if handled. */
  handleKey(event: KeyboardEvent): boolean {
    switch (event.key) {
      case 'ArrowDown':
        this.moveNext();
        return true;
      case 'ArrowUp':
        this.movePrev();
        return true;
      case 'ArrowLeft':
        this.collapseOrParent();
        return true;
      case 'ArrowRight':
        this.expandOrFirstChild();
        return true;
      case 'Home':
        this.moveHome();
        return true;
      case 'End':
        this.moveEnd();
        return true;
      case 'Enter':
        this.activateEnter(event);
        return true;
      case ' ':
      case 'Spacebar':
        this.activateSpace();
        return true;
      default:
        return false;
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────

  moveNext(): void {
    const cur = this.activeNode();
    if (cur === null) {
      this.ensureActive();
      return;
    }
    const next = nextVisible(cur);
    if (next !== null) this.setActive(next);
  }

  movePrev(): void {
    const cur = this.activeNode();
    if (cur === null) {
      this.ensureActive();
      return;
    }
    const prev = prevVisible(cur);
    if (prev !== null) this.setActive(prev);
  }

  moveHome(): void {
    const cfg = this.cfg;
    if (cfg === null) return;
    this.setActive(cfg.root());
  }

  moveEnd(): void {
    const cfg = this.cfg;
    if (cfg === null) return;
    const last = lastVisibleDescendant(cfg.root());
    if (last !== null) this.setActive(last);
  }

  // ← / → ──────────────────────────────────────────────────────────────────

  /**
   * Expanded Collapse → collapse it.
   * Otherwise → jump to the nearest navigable ancestor (root included).
   */
  collapseOrParent(): void {
    const cur = this.activeNode();
    if (cur === null) return;
    if (cur.kind === 'collapse' && !cur.collapsed()) {
      this.expand?.collapse(cur) ?? cur.collapse();
      return;
    }
    const parent = navigableParent(cur);
    if (parent === null) return;
    this.setActive(parent);
  }

  /**
   * Collapsed Collapse → expand it.
   * Expanded Collapse → move to the first navigable child.
   * Otherwise → no-op (rows/load-more have nothing to expand).
   */
  expandOrFirstChild(): void {
    const cur = this.activeNode();
    if (cur === null) return;
    if (cur.kind !== 'collapse') return;
    if (cur.collapsed()) {
      this.expand?.expand(cur) ?? cur.expand();
      return;
    }
    const first = firstNavigableChild(cur);
    if (first !== null) this.setActive(first);
  }

  // ── Activation ─────────────────────────────────────────────────────────

  /**
   * Enter on LoadMore triggers `load()`. Enter on Collapse toggles its
   * expanded state. Enter on Row replaces single-mode selection.
   * Ctrl/Cmd+Enter adds to the selection in multi-mode.
   */
  activateEnter(event: KeyboardEvent): void {
    const cur = this.activeNode();
    if (cur === null) return;
    if (cur.kind === 'loadmore') {
      cur.load();
      return;
    }
    if (cur.kind === 'collapse') {
      this.expand?.toggle(cur) ?? cur.toggle();
      return;
    }
    this.selection?.handleClick(cur, {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
  }

  /** Space toggles the check state for rows/collapses; on LoadMore acts like Enter. */
  activateSpace(): void {
    const cur = this.activeNode();
    if (cur === null) return;
    if (cur.kind === 'loadmore') {
      cur.load();
      return;
    }
    this.check?.toggle(cur);
  }
}

// ── Tree-walking primitives ──────────────────────────────────────────────

/**
 * Yield a CollapseNode's direct navigable children in display order. Block
 * nodes are transparent — rows nested in arbitrarily deep block trees surface
 * as direct entries. LoadMoreNode trails at the end.
 *
 * Generator-based so hot callers (`firstNavigableChild`, `nextVisible`,
 * `prevVisible`) can short-circuit without materializing the full list.
 */
export function* navigableChildren(
  node: CollapseNode,
): Generator<NavigableNode> {
  for (const c of node.children()) {
    if (c.kind === 'block') yield* walkBlock(c);
    else yield c;
  }
  const lm = node.loadMore();
  if (lm !== null) yield lm;
}

function* walkBlock(block: BlockNode): Generator<NavigableNode> {
  for (const c of block.children()) {
    if (c.kind === 'block') yield* walkBlock(c);
    else yield c; // c.kind === 'row' || c.kind === 'collapse'
  }
}

function lastNavigableChild(node: CollapseNode): NavigableNode | null {
  let last: NavigableNode | null = null;
  for (const c of navigableChildren(node)) last = c;
  return last;
}

function siblingAfter(
  parent: CollapseNode,
  target: NavigableNode,
): NavigableNode | null {
  let found = false;
  for (const c of navigableChildren(parent)) {
    if (found) return c;
    if (c === target) found = true;
  }
  return null;
}

function siblingBefore(
  parent: CollapseNode,
  target: NavigableNode,
): NavigableNode | null {
  let prev: NavigableNode | null = null;
  for (const c of navigableChildren(parent)) {
    if (c === target) return prev;
    prev = c;
  }
  return null;
}

/** Closest CollapseNode ancestor, skipping the Block layer that may sit between. */
export function navigableParent(node: TreeNode): CollapseNode | null {
  let cur: TreeNode | null = node.parent;
  while (cur !== null && cur.kind !== 'collapse') {
    cur = (cur as BlockNode).parent;
  }
  return cur as CollapseNode | null;
}

export function firstNavigableChild(node: CollapseNode): NavigableNode | null {
  if (node.collapsed()) return null;
  const first = navigableChildren(node).next();
  return first.done ? null : first.value;
}

export function lastVisibleDescendant(node: CollapseNode): NavigableNode | null {
  let cur: NavigableNode = node;
  while (cur.kind === 'collapse' && !cur.collapsed()) {
    const last = lastNavigableChild(cur);
    if (last === null) break;
    cur = last;
  }
  return cur;
}

/**
 * Next visible item in display order. If `cur` is an expanded Collapse with
 * children, descends; otherwise looks for the next sibling, walking up
 * ancestors until one provides a successor.
 */
export function nextVisible(cur: NavigableNode): NavigableNode | null {
  if (cur.kind === 'collapse' && !cur.collapsed()) {
    const first = firstNavigableChild(cur);
    if (first !== null) return first;
  }
  let node: NavigableNode = cur;
  while (true) {
    const parent = navigableParent(node);
    if (parent === null) return null;
    const next = siblingAfter(parent, node);
    if (next !== null) return next;
    node = parent;
  }
}

/**
 * Previous visible item in display order. If `cur` has a previous sibling,
 * descends into that sibling's deepest visible descendant; otherwise returns
 * the parent.
 */
export function prevVisible(cur: NavigableNode): NavigableNode | null {
  const parent = navigableParent(cur);
  if (parent === null) return null;
  const prev = siblingBefore(parent, cur);
  if (prev === null) return parent;
  let node: NavigableNode = prev;
  while (node.kind === 'collapse' && !node.collapsed()) {
    const last = lastNavigableChild(node);
    if (last === null) break;
    node = last;
  }
  return node;
}

/**
 * DFS the tree to find the navigable node whose key matches. Used to resolve
 * `activeKey` back to a node — only triggers when the key actually changes,
 * so the cost is amortized over user input, not scroll.
 */
function findByKey(
  root: CollapseNode,
  keyFn: KeyFn,
  target: Key,
): NavigableNode | null {
  const stack: TreeNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.kind === 'row' || cur.kind === 'collapse' || cur.kind === 'loadmore') {
      if (keyFn(cur) === target) return cur as NavigableNode;
    }
    if (cur.kind === 'row' || cur.kind === 'loadmore') continue;
    for (const child of cur.children()) stack.push(child);
    if (cur.kind === 'collapse') {
      const lm = cur.loadMore();
      if (lm !== null) stack.push(lm);
    }
  }
  return null;
}

/**
 * Compute the absolute Y of `node` relative to `root`'s canvas. Walks the
 * parent chain summing header sizes and prior-sibling heights — O(depth +
 * branching) per call. Used for scroll-into-view; not memoized, called on
 * active-key changes only.
 */
export function absoluteTopOf(node: TreeNode, root: CollapseNode): number {
  let top = 0;
  let cur: TreeNode = node;
  while (cur !== root) {
    const parent: BlockNode | CollapseNode | null = cur.parent;
    if (parent === null) break;
    if (parent.kind === 'collapse') top += parent.headerSize();
    if (cur.kind === 'loadmore') {
      // LoadMore sits after every child of its CollapseNode parent.
      for (const sibling of parent.children()) top += siblingHeight(sibling);
    } else {
      for (const sibling of parent.children()) {
        if (sibling === cur) break;
        top += siblingHeight(sibling);
      }
    }
    cur = parent;
  }
  return top;
}

function siblingHeight(sibling: TreeNode): number {
  if (sibling.kind === 'row') return sibling.renderSize();
  if (sibling.kind === 'loadmore') return sibling.renderSize();
  // block or collapse
  return sibling.height();
}

/**
 * Compute the depth used for ARIA `aria-level` (1-based). Root is level 1;
 * its direct children are level 2.
 */
export function ariaLevel(node: TreeNode, root: CollapseNode): number {
  let level = 1;
  let cur: TreeNode | null = node;
  while (cur !== null && cur !== root) {
    if (cur.kind !== 'block') level++;
    cur = cur.parent;
  }
  return level;
}

export interface AriaPosition {
  readonly posInSet: number;
  readonly setSize: number;
}

export function ariaPosition(node: NavigableNode): AriaPosition | null {
  const parent = navigableParent(node);
  if (parent === null) return null;
  let posInSet = 0;
  let setSize = 0;
  let found = false;
  for (const c of navigableChildren(parent)) {
    setSize++;
    if (!found) {
      posInSet++;
      if (c === node) found = true;
    }
  }
  if (!found) return null;
  return {posInSet, setSize};
}
