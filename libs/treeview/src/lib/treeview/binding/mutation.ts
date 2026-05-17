import {
  BlockChild,
  BlockNode,
  CollapseNode,
  DEFAULT_BLOCK_SIZE,
  RowNode,
} from '../tree-model';

/**
 * Module-level counter for IDs handed out to Blocks created by split
 * operations. Per-tree uniqueness is what matters — Block ids never feed into
 * keyed state, so process-wide monotonicity is more than enough.
 */
let splitCounter = 0;

export interface LeafInsertPoint {
  /** Block that should receive the row. */
  readonly block: BlockNode;
  /** Index within `block.children()` where the row goes. */
  readonly index: number;
}

/**
 * Resolve a leaf index (0-based, counting only rows) under `parent` to the
 * concrete Block + intra-block position where a new row should be inserted.
 * Walks the Block tree under `parent`, descending into group-blocks when the
 * cumulative row count of preceding children covers the target index.
 *
 * Returns `null` when `parent` has no Block children — caller should
 * synthesize a starter block in that case.
 *
 * Inserting at `leafIndex === totalRows` appends to the last leaf-block;
 * inserting at `0` prepends to the first leaf-block.
 */
export function locateLeafInsertPoint(
  parent: CollapseNode,
  leafIndex: number,
): LeafInsertPoint | null {
  const children = parent.children();
  // Find the first Block whose row range contains leafIndex.
  let consumed = 0;
  for (const child of children) {
    if (child.kind !== 'block') continue;
    const blockRows = countRowsInBlock(child);
    if (leafIndex <= consumed + blockRows) {
      return locateInBlock(child, leafIndex - consumed);
    }
    consumed += blockRows;
  }
  // Out of range: try the trailing block (append). If no Block at all, null.
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.kind === 'block') return locateAppendInBlock(child);
  }
  return null;
}

function locateInBlock(block: BlockNode, leafIndex: number): LeafInsertPoint {
  const children = block.children();
  let consumed = 0;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    if (c.kind === 'row') {
      if (leafIndex === consumed) return { block, index: i };
      consumed++;
    } else if (c.kind === 'block') {
      // Sub-block: descend if our index falls within its range, else skip.
      const sub = countRowsInBlock(c);
      if (leafIndex <= consumed + sub) {
        return locateInBlock(c, leafIndex - consumed);
      }
      consumed += sub;
    }
    // Collapse children embedded in a row block don't consume row indices —
    // they sit between rows like a separator/folder marker.
  }
  // leafIndex === consumed → append at end. If the last child is a sub-block,
  // append inside it so we keep new rows packed against existing data.
  if (children.length > 0) {
    const last = children[children.length - 1];
    if (last.kind === 'block') return locateAppendInBlock(last);
  }
  return { block, index: children.length };
}

function locateAppendInBlock(block: BlockNode): LeafInsertPoint {
  const children = block.children();
  if (children.length === 0) return { block, index: 0 };
  const last = children[children.length - 1];
  if (last.kind === 'block') return locateAppendInBlock(last);
  return { block, index: children.length };
}

/**
 * Insert a row into the leaf position identified by `leafIndex`. When the
 * receiving leaf block crosses the `2 * blockSize` threshold, it splits in
 * half; the split cascades up through any group blocks that themselves now
 * exceed `2 * blockSize`. Cascading stops at the CollapseNode boundary — a
 * collapse with many sibling blocks is fine because the Collapse renderer
 * only iterates direct children per scroll tick (no recursion).
 */
export function insertLeafAt(
  parent: CollapseNode,
  leafIndex: number,
  row: RowNode,
): void {
  const point = locateLeafInsertPoint(parent, leafIndex);
  if (point === null) {
    // No Block under parent yet — create a starter leaf block holding the row.
    parent.insertChildAt(
      0,
      new BlockNode({
        id: `__tv:block:${parent.id}:m${splitCounter++}`,
        depth: 0,
        blockSize: DEFAULT_BLOCK_SIZE,
        children: [row],
      }),
    );
    return;
  }
  point.block.insertChildAt(point.index, row);
  bumpTotalRowCount(point.block, +1);
  maybeSplitBlock(point.block);
}

/** Remove `row` from wherever it lives. Returns true if the row was attached. */
export function removeLeaf(row: RowNode): boolean {
  const parent = row.parent;
  if (parent === null) return false;
  const idx = parent.children().indexOf(row);
  if (idx === -1) return false;
  parent.removeChildAt(idx);
  bumpTotalRowCount(parent, -1);
  return true;
}

/**
 * If `block.children.length >= 2 * blockSize`, split it in half and insert
 * the new half right after `block` in its parent. Recurses upward — a split
 * that pushes the parent over its threshold splits the parent too.
 */
export function maybeSplitBlock(block: BlockNode): BlockNode | null {
  if (block.children().length < 2 * block.blockSize) return null;
  return splitBlock(block);
}

/**
 * Force a split of `block` regardless of size. Returns the freshly-minted
 * sibling block, or `null` if `block` has no parent (orphan).
 */
export function splitBlock(block: BlockNode): BlockNode | null {
  const parent = block.parent;
  if (parent === null) return null;
  const all = block.children().slice();
  if (all.length < 2) return null;

  const mid = Math.ceil(all.length / 2);
  const keep = all.slice(0, mid);
  const overflow = all.slice(mid);

  block.setChildren(keep);
  block.totalRowCount.set(countRowsIn(keep));

  const newBlock = new BlockNode({
    id: `${block.id}:s${splitCounter++}`,
    depth: block.depth,
    blockSize: block.blockSize,
    children: overflow,
    totalRowCount: countRowsIn(overflow),
    defaultRowSize: block.defaultRowSize(),
  });

  const siblings = parent.children();
  const idx = siblings.indexOf(block);
  if (idx === -1) return null;

  if (parent.kind === 'collapse') {
    parent.insertChildAt(idx + 1, newBlock);
  } else {
    // parent is a BlockNode
    parent.insertChildAt(idx + 1, newBlock);
    maybeSplitBlock(parent);
  }
  return newBlock;
}

function countRowsInBlock(block: BlockNode): number {
  return countRowsIn(block.children());
}

function countRowsIn(children: readonly BlockChild[]): number {
  let n = 0;
  for (const c of children) {
    if (c.kind === 'row') n++;
    else if (c.kind === 'block') n += countRowsInBlock(c);
    // Collapse children of a Block don't count — they're separate
    // subtrees co-located in the row run for placement reasons.
  }
  return n;
}

/**
 * Walk up the parent chain bumping `totalRowCount` on each Block ancestor by
 * `delta` (typically ±1 for a single insert/remove). Used to keep group
 * blocks' counts consistent so future locate / split decisions see the right
 * totals. Stops at the first non-Block parent.
 */
function bumpTotalRowCount(block: BlockNode, delta: number): void {
  let cur: BlockNode | CollapseNode | null = block;
  while (cur !== null && cur.kind === 'block') {
    cur.totalRowCount.update((v) => Math.max(0, v + delta));
    cur = cur.parent;
  }
}
