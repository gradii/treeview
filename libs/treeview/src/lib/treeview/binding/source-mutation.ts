import { insertLeafAt, removeLeaf } from './mutation';
import { read } from './from-hierarchy';
import type { FieldOrFn } from './from-hierarchy';
import {
  BlockNode,
  CollapseNode,
  RowNode,
} from '../tree-model';

/**
 * Minimum knowledge needed to walk an arbitrary source `TParent` and locate
 * its children of type `TChild`. The two-generic shape matches the common
 * "Bucket has Item[]" pattern: `SourceAccessors<Bucket, Item>`. When parent
 * and child are the same shape (recursive hierarchy), pass one generic and
 * `TChild` defaults to it.
 */
export interface SourceAccessors<TParent, TChild = TParent> {
  /** How to reach an item's children array (function or dot-path field name). */
  readonly childrenField: FieldOrFn<TParent, readonly TChild[] | null | undefined>;
}

export interface InsertRowOptions<TParent, TChild> {
  /** Maps the new data item into a RowNode (id / label / size / meta). */
  readonly toRow: (item: TChild) => RowNode;
  /** Source accessors — must match what was used to build the tree. */
  readonly accessors: SourceAccessors<TParent, TChild>;
}

/**
 * Mutate `source` and the tree together. The reference row's parent
 * `CollapseNode` is consulted for its `meta` payload (the source item that
 * backs it) — its children array is then spliced and the tree gets a fresh
 * row in lockstep via `insertLeafAt`. Returns the newly created row, or
 * `null` if the parent chain or `meta` payload can't be resolved.
 *
 * Assumes the parent's children are homogeneous **leaves** (i.e. every
 * source-children entry maps to a row, not a nested folder). Mixed parents
 * — where folders and files alternate — drift between source order and tree
 * leaf order; for those, fall back to a manual `splice + parent.setChildren`
 * rebuild.
 *
 * `position`:
 * - `'after'`  — inserts immediately after `referenceRow`
 * - `'before'` — inserts immediately before
 */
export function insertRowSibling<TParent, TChild>(
  referenceRow: RowNode,
  newItem: TChild,
  position: 'before' | 'after',
  opts: InsertRowOptions<TParent, TChild>,
): RowNode | null {
  const parent = collapseAncestor(referenceRow);
  if (parent === null) return null;
  const sourceChildren = mutableSourceChildren<TParent, TChild>(parent, opts.accessors);
  if (sourceChildren === null) return null;

  const refItem = referenceRow.meta as TChild | undefined;
  if (refItem === undefined) return null;
  const sourceIdx = sourceChildren.indexOf(refItem);
  if (sourceIdx === -1) return null;

  const insertAt = position === 'after' ? sourceIdx + 1 : sourceIdx;
  sourceChildren.splice(insertAt, 0, newItem);

  const row = opts.toRow(newItem);
  // Homogeneous-leaf assumption: source index === leaf index in tree.
  insertLeafAt(parent, insertAt, row);
  return row;
}

/**
 * Insert a new item as the **first** or **last** leaf of `parent`. Mutates
 * the parent's source `children` array (via `meta`) and the tree in one go.
 * Returns the new row, or `null` if the parent has no `meta` or no source
 * children array.
 */
export function insertRowAtEdge<TParent, TChild>(
  parent: CollapseNode,
  newItem: TChild,
  edge: 'first' | 'last',
  opts: InsertRowOptions<TParent, TChild>,
): RowNode | null {
  const sourceChildren = mutableSourceChildren<TParent, TChild>(parent, opts.accessors);
  if (sourceChildren === null) return null;

  const insertAt = edge === 'first' ? 0 : sourceChildren.length;
  sourceChildren.splice(insertAt, 0, newItem);

  const row = opts.toRow(newItem);
  insertLeafAt(parent, insertAt, row);
  return row;
}

/**
 * Remove `row` from both the tree and its backing source array. Returns
 * `true` if the row was attached to a parent and a matching source entry was
 * found; `false` if either lookup failed (the tree still gets cleaned up
 * when possible — only the source mutation is skipped on lookup miss).
 */
export function removeRowFromSource<TParent, TChild>(
  row: RowNode,
  accessors: SourceAccessors<TParent, TChild>,
): boolean {
  const parent = collapseAncestor(row);
  if (parent !== null) {
    const sourceChildren = mutableSourceChildren<TParent, TChild>(parent, accessors);
    const item = row.meta as TChild | undefined;
    if (sourceChildren !== null && item !== undefined) {
      const idx = sourceChildren.indexOf(item);
      if (idx !== -1) {
        sourceChildren.splice(idx, 1);
      }
    }
  }
  return removeLeaf(row);
}

/**
 * Move `source` row to a new position relative to `anchor` (a row in the same
 * tree). Reuses the same `RowNode` instance and the same source data item —
 * just splices both the source array and the tree to relocate them in
 * lockstep. Returns `true` on success, `false` if any lookup failed (e.g.
 * either row is detached, or the source item isn't present in the resolved
 * parent's source children array).
 *
 * `position`:
 * - `'before'` — drop above the anchor row (becomes earlier sibling)
 * - `'after'`  — drop below the anchor row (becomes later sibling)
 *
 * No-op when `source === anchor`. Cross-parent moves are supported: source
 * leaves its original parent, anchor's parent receives it.
 */
export function moveRow<TParent, TChild>(
  source: RowNode,
  anchor: RowNode,
  position: 'before' | 'after',
  accessors: SourceAccessors<TParent, TChild>,
): boolean {
  if (source === anchor) return false;

  const sourceItem = source.meta as TChild | undefined;
  if (sourceItem === undefined) return false;

  const anchorParent = collapseAncestor(anchor);
  if (anchorParent === null) return false;
  const anchorItem = anchor.meta as TChild | undefined;
  if (anchorItem === undefined) return false;

  // Step 1: detach source from its current source array + tree.
  if (!removeRowFromSource(source, accessors)) return false;

  // Step 2: locate the anchor in its parent's source array. Done **after**
  // step 1 so a same-parent move sees the array already missing the source —
  // the index we splice into is the post-removal target index.
  const targetSource = mutableSourceChildren<TParent, TChild>(anchorParent, accessors);
  if (targetSource === null) return false;
  const anchorIdx = targetSource.indexOf(anchorItem);
  if (anchorIdx === -1) return false;

  const insertAt = position === 'after' ? anchorIdx + 1 : anchorIdx;
  targetSource.splice(insertAt, 0, sourceItem);
  // Re-attach the same RowNode (keeps selection / check / nav state intact).
  insertLeafAt(anchorParent, insertAt, source);
  return true;
}

/**
 * Move `source` row to become a child of `targetParent`. Splices the source
 * out of its current parent's source array, then splices into
 * `targetParent`'s source array at `edge` ('first' or 'last'). Reuses the
 * same RowNode instance so keyed state (selection / check / nav) survives.
 *
 * Use case: drop-on-collapse — when a row is dragged over a Collapse header
 * with `position: 'over'`, the row becomes the first or last child of that
 * collapse.
 */
export function moveRowAsChild<TParent, TChild>(
  source: RowNode,
  targetParent: CollapseNode,
  edge: 'first' | 'last',
  accessors: SourceAccessors<TParent, TChild>,
): boolean {
  const sourceItem = source.meta as TChild | undefined;
  if (sourceItem === undefined) return false;

  // Detach from the current parent. `removeRowFromSource` handles the source
  // array splice + tree-side removeLeaf in one step.
  if (!removeRowFromSource(source, accessors)) return false;

  // Attach to the new parent.
  const targetChildren = mutableSourceChildren<TParent, TChild>(
    targetParent,
    accessors,
  );
  if (targetChildren === null) return false;
  const insertAt = edge === 'first' ? 0 : targetChildren.length;
  targetChildren.splice(insertAt, 0, sourceItem);
  insertLeafAt(targetParent, insertAt, source);
  return true;
}

/**
 * Move a `CollapseNode` (with its entire subtree) to a new position relative
 * to an `anchor` collapse. Only works for **homogeneous** hierarchies — i.e.
 * the accessor's `childrenField` on a parent yields a `TChild[]` that's the
 * same shape as the source's `meta`. (Mixed `Bucket | Item` trees where Items
 * are leaves can't host nested Buckets, so collapse drag fails silently.)
 *
 * `position`:
 * - `'before'` / `'after'` — sibling of `anchor` in `anchor.parent`
 * - `'over'` — last child of `anchor`
 *
 * Refuses to move:
 * - source onto itself
 * - source onto a descendant of itself (would create a cycle)
 * - source from the synthetic root (no parent)
 *
 * On failure, mutates nothing. On success, both the source data array(s) and
 * the tree are spliced in lockstep.
 */
export function moveCollapse<TParent, TChild>(
  source: CollapseNode,
  anchor: CollapseNode,
  position: 'before' | 'over' | 'after',
  accessors: SourceAccessors<TParent, TChild>,
): boolean {
  if (source === anchor) return false;
  if (isAncestorOf(source, anchor)) return false;

  const sourceTreeParent = source.parent;
  if (sourceTreeParent === null) return false;
  // Source-data resolution always lives on a CollapseNode (Blocks are
  // virtualization-only — they don't carry `meta`). If source has been
  // dropped into a row block previously, walk up to the enclosing
  // collapse to find the array its data item belongs to.
  const sourceDataParent = enclosingCollapse(sourceTreeParent);
  if (sourceDataParent === null) return false;
  const sourceItem = source.meta as TChild | undefined;
  if (sourceItem === undefined) return false;
  const sourceArray = mutableSourceChildren<TParent, TChild>(
    sourceDataParent,
    accessors,
  );
  if (sourceArray === null) return false;
  const sourceIdx = sourceArray.indexOf(sourceItem);
  if (sourceIdx === -1) return false;

  const targetTreeParent =
    position === 'over' ? anchor : anchor.parent;
  if (targetTreeParent === null) return false;

  // Source-data side resolves to a CollapseNode. When the anchor sits
  // inside a row block (its parent is a BlockNode), walk up to that
  // block's enclosing collapse — that's where the anchor's data lives.
  const targetDataParent =
    position === 'over' ? anchor : enclosingCollapse(anchor.parent);
  if (targetDataParent === null) return false;

  // Splice source out of its current source array.
  sourceArray.splice(sourceIdx, 1);
  const targetArray = mutableSourceChildren<TParent, TChild>(
    targetDataParent,
    accessors,
  );
  if (targetArray === null) {
    sourceArray.splice(sourceIdx, 0, sourceItem); // rollback
    return false;
  }
  let insertAtArr: number;
  if (position === 'over') {
    insertAtArr = targetArray.length;
  } else {
    const anchorItem = anchor.meta as TChild | undefined;
    if (anchorItem === undefined) {
      sourceArray.splice(sourceIdx, 0, sourceItem);
      return false;
    }
    const anchorArrIdx = targetArray.indexOf(anchorItem);
    if (anchorArrIdx === -1) {
      sourceArray.splice(sourceIdx, 0, sourceItem);
      return false;
    }
    insertAtArr = position === 'after' ? anchorArrIdx + 1 : anchorArrIdx;
  }
  targetArray.splice(insertAtArr, 0, sourceItem);

  // Mutate tree: detach, then attach at the corresponding tree-side position.
  const sourceTreeIdx = sourceTreeParent.children().indexOf(source);
  if (sourceTreeIdx !== -1) sourceTreeParent.removeChildAt(sourceTreeIdx);

  let treeInsertAt: number;
  if (position === 'over') {
    treeInsertAt = targetTreeParent.children().length;
  } else {
    const anchorTreeIdx = targetTreeParent.children().indexOf(anchor);
    if (anchorTreeIdx === -1) return false;
    treeInsertAt = position === 'after' ? anchorTreeIdx + 1 : anchorTreeIdx;
  }
  // Re-base the moved subtree's depth so descendant indents follow the new
  // parent. The shift is uniform: everything moves by the same delta
  // regardless of how deep into the subtree it sits. Done *before*
  // `insertChildAt` so that when the children-signal change propagates and
  // the templates re-evaluate `[style.--tv-depth]`, they read fresh depths.
  const newRootDepth =
    position === 'over' ? anchor.depth() + 1 : anchor.depth();
  shiftCollapseSubtreeDepth(source, newRootDepth - source.depth());
  targetTreeParent.insertChildAt(treeInsertAt, source);
  return true;
}

/**
 * Walk `node` and every CollapseNode descendant, adding `delta` to each
 * `depth` signal. Blocks aren't touched — their visual contribution to
 * indentation comes from `Collapse.childDepth` (read reactively), not from
 * `BlockNode.depth` (which is purely logical metadata).
 */
function shiftCollapseSubtreeDepth(node: CollapseNode, delta: number): void {
  if (delta === 0) return;
  node.depth.update((d) => d + delta);
  for (const child of node.children()) {
    if (child.kind === 'collapse') {
      shiftCollapseSubtreeDepth(child, delta);
    }
  }
}

/**
 * Move a CollapseNode adjacent to a RowNode anchor. The anchor row's
 * immediate parent is its host BlockNode; the source collapse is spliced
 * directly into that block at the position next to the anchor — a
 * `BlockChild` now accepts `CollapseNode`, so no splitting is needed.
 *
 * On the source-data side, the anchor row's data item is the
 * positioning reference inside its enclosing collapse's children array
 * — find its index there, splice the source's data item before / after.
 *
 * Rejects: source ⊇ anchorRow (cycle), source detached, anchor not
 * actually nested under a BlockNode.
 */
export function moveCollapseBesideRow<TParent, TChild>(
  source: CollapseNode,
  anchorRow: RowNode,
  position: 'before' | 'after',
  accessors: SourceAccessors<TParent, TChild>,
): boolean {
  if (isInSubtree(source, anchorRow)) return false;
  const targetCollapse = collapseAncestor(anchorRow);
  if (targetCollapse === null) return false;
  if (isAncestorOf(source, targetCollapse)) return false;

  const hostBlock = anchorRow.parent;
  if (hostBlock === null || hostBlock.kind !== 'block') return false;

  const sourceTreeParent = source.parent;
  if (sourceTreeParent === null) return false;
  const sourceDataParent = enclosingCollapse(sourceTreeParent);
  if (sourceDataParent === null) return false;
  const sourceItem = source.meta as TChild | undefined;
  if (sourceItem === undefined) return false;
  const sourceArray = mutableSourceChildren<TParent, TChild>(
    sourceDataParent,
    accessors,
  );
  if (sourceArray === null) return false;
  const sourceIdx = sourceArray.indexOf(sourceItem);
  if (sourceIdx === -1) return false;

  const anchorItem = anchorRow.meta as TChild | undefined;
  if (anchorItem === undefined) return false;
  const targetArray = mutableSourceChildren<TParent, TChild>(
    targetCollapse,
    accessors,
  );
  if (targetArray === null) return false;

  sourceArray.splice(sourceIdx, 1);
  const anchorArrIdx = targetArray.indexOf(anchorItem);
  if (anchorArrIdx === -1) {
    sourceArray.splice(sourceIdx, 0, sourceItem); // rollback
    return false;
  }
  const insertAtArr = position === 'after' ? anchorArrIdx + 1 : anchorArrIdx;
  targetArray.splice(insertAtArr, 0, sourceItem);

  // Tree side: splice source into the host block at the anchor row's
  // position. Use `removeChild` (not removeChildAt by index) because
  // sourceTreeParent might be either a CollapseNode or a BlockNode, and
  // the indices can shift if source and host share a parent.
  const sourceTreeIdx = sourceTreeParent.children().indexOf(source);
  if (sourceTreeIdx !== -1) sourceTreeParent.removeChildAt(sourceTreeIdx);

  const rowIdx = hostBlock.children().indexOf(anchorRow);
  if (rowIdx === -1) return false;
  const treeInsertAt = position === 'after' ? rowIdx + 1 : rowIdx;

  // Depth follows the enclosing collapse, same as if source had been
  // dropped directly under it.
  const newRootDepth = targetCollapse.depth() + 1;
  shiftCollapseSubtreeDepth(source, newRootDepth - source.depth());

  hostBlock.insertChildAt(treeInsertAt, source);
  return true;
}

/** True iff `row` lives anywhere inside `ancestor`'s subtree. */
function isInSubtree(ancestor: CollapseNode, row: RowNode): boolean {
  let cur: BlockNode | CollapseNode | null = row.parent;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

/** True iff `descendant` (or any of its collapse ancestors) is `ancestor`. */
function isAncestorOf(ancestor: CollapseNode, descendant: CollapseNode): boolean {
  let cur: CollapseNode | null = descendant;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = enclosingCollapse(cur.parent);
  }
  return false;
}

/**
 * Walk up the parent chain (through any depth of nested BlockNodes) to find
 * the enclosing CollapseNode. Returns `null` if the row is detached.
 */
function collapseAncestor(node: RowNode): CollapseNode | null {
  let cur: BlockNode | CollapseNode | null = node.parent;
  while (cur !== null && cur.kind !== 'collapse') {
    cur = cur.parent;
  }
  return cur;
}

/** Walk up the parent chain (Block or Collapse) to find the nearest
 *  enclosing CollapseNode. Blocks don't carry `meta`/source data, so any
 *  source-side lookup ultimately has to resolve up to a Collapse. */
function enclosingCollapse(
  node: BlockNode | CollapseNode | null,
): CollapseNode | null {
  let cur = node;
  while (cur !== null && cur.kind !== 'collapse') {
    cur = cur.parent;
  }
  return cur;
}

function mutableSourceChildren<TParent, TChild>(
  parent: CollapseNode,
  accessors: SourceAccessors<TParent, TChild>,
): TChild[] | null {
  const item = parent.meta as TParent | undefined;
  if (item === undefined) return null;
  const children = read(item, accessors.childrenField);
  if (children === null || children === undefined) return null;
  return children as TChild[];
}
