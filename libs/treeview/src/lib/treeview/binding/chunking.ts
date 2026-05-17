import {
  BlockChild,
  BlockNode,
  DEFAULT_BLOCK_SIZE,
  RowNode,
} from '../tree-model';

/**
 * Slice a flat list of rows into BlockNodes of up to `size` rows each.
 *
 * Block is a virtualization-only container (no header, no collapse state).
 * Use this from the binding adapters to group consecutive leaf runs so a single
 * scroll tick doesn't re-render hundreds of individual row elements.
 *
 * `size` semantics:
 * - `>= 1`: chunk into Blocks of that exact size.
 * - `<= 0`: one Block containing every row (no further splitting). Useful when
 *   the caller wants a uniform `RowNode → BlockNode` wrap without internal
 *   chunking — for small datasets where the extra split level adds no value.
 *
 * Block IDs are `${idPrefix}:${chunkIndex}` — the prefix must be stable for the
 * parent collection so that re-running chunking on the same input yields the
 * same IDs (important for keyed state).
 */
export function chunkRows(
  rows: readonly RowNode[],
  size = DEFAULT_BLOCK_SIZE,
  idPrefix = '__tv:block',
  depth = 0,
): BlockNode[] {
  if (rows.length === 0) return [];
  const effective = size > 0 ? size : rows.length;
  const out: BlockNode[] = [];
  for (let i = 0; i < rows.length; i += effective) {
    const slice = rows.slice(i, i + effective);
    out.push(
      new BlockNode({
        id: `${idPrefix}:${out.length}`,
        depth,
        blockSize: effective,
        children: slice,
      }),
    );
  }
  return out;
}

/**
 * Build a balanced Block tree from a flat list of rows.
 *
 * For `N` rows and chunk size `K`, returns an array of at most `K` top-level
 * `BlockNode`s. Each top-level block contains at most `K` children — either
 * rows directly (when `N <= K²`) or further nested blocks. Wrapping continues
 * until the topmost level fits within the budget, so every level participates
 * in viewport culling and no level renders more than `K` siblings.
 *
 * Example for `N = 10_000`, `K = 20`:
 * - 500 leaf blocks of 20 rows each
 * - 25 group blocks of 20 leaf-blocks each
 * - 2 super-group blocks of ~13 + ~12 group-blocks each
 * - Returns the 2 super-group blocks.
 *
 * Use this in place of `chunkRows` when the parent CollapseNode would
 * otherwise receive an unbounded number of sibling Blocks (`N / K > K`).
 */
export function chunkRowsRecursive(
  rows: readonly RowNode[],
  size = DEFAULT_BLOCK_SIZE,
  idPrefix = '__tv:block',
  depth = 0,
): BlockNode[] {
  if (rows.length === 0) return [];
  const effective = size > 0 ? size : rows.length;
  let level: BlockNode[] = chunkRows(rows, effective, `${idPrefix}:L0`, depth);
  let levelIdx = 1;
  while (level.length > effective) {
    level = groupBlocks(level, effective, `${idPrefix}:L${levelIdx}`, depth);
    levelIdx++;
  }
  return level;
}

/**
 * Pack a flat list of BlockNodes into parent BlockNodes of at most `size`
 * children each. Used by `chunkRowsRecursive` to climb levels and by the
 * mutation API when a parent Block split.
 */
export function groupBlocks(
  blocks: readonly BlockNode[],
  size: number,
  idPrefix: string,
  depth: number,
): BlockNode[] {
  if (blocks.length === 0) return [];
  if (size < 1) size = blocks.length;
  const out: BlockNode[] = [];
  for (let i = 0; i < blocks.length; i += size) {
    const slice = blocks.slice(i, i + size) as BlockChild[];
    // Group blocks track the underlying row count so consumers querying
    // `totalRowCount` see the same number whether the data was chunked flat
    // or recursively. defaultRowSize is irrelevant for group blocks but kept
    // consistent in case a sub-block later becomes lazy.
    let rowsInGroup = 0;
    for (const b of slice) rowsInGroup += (b as BlockNode).totalRowCount();
    out.push(
      new BlockNode({
        id: `${idPrefix}:${out.length}`,
        depth,
        blockSize: size,
        children: slice,
        totalRowCount: rowsInGroup,
      }),
    );
  }
  return out;
}
