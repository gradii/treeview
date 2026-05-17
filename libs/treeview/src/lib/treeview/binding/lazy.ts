import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  BlockNode,
  DEFAULT_BLOCK_SIZE,
  DEFAULT_ROW_SIZE,
  RowNode,
} from '../tree-model';
import { groupBlocks } from './chunking';

export interface LazyBlockOptions<T> {
  /** Stable id for the placeholder block. Must be unique within its tree. */
  readonly id: string;
  /** Visual / logical depth — only used by Block.depth (no indent contribution). */
  readonly depth?: number;
  /**
   * Total number of rows the block represents. The block sizes itself for
   * this many `defaultRowSize`-tall skeleton placeholders **before any data
   * arrives**, so virtualization, scrollbar, and sticky-stack maths are all
   * correct from t=0.
   */
  readonly totalCount: number;
  /**
   * Height assumed for each not-yet-loaded skeleton row. Matches the height
   * the eventual real rows will take — keeps scroll position stable across
   * the load.
   */
  readonly rowSize?: number;
  /**
   * Subscribed the first time the block enters the viewport (or when a caller
   * invokes `block.ensureLoaded()`). Concurrent triggers share the in-flight
   * subscription. Each emission is mapped through `toRow` and replaces the
   * block's rows — a loader that keeps emitting drives realtime updates.
   */
  readonly loader: () => Observable<readonly T[]>;
  /**
   * Per-item mapper to a `RowNode`. Index is the position within the loaded
   * batch — useful for synthesizing IDs when items don't carry their own.
   */
  readonly toRow: (item: T, index: number) => RowNode;
  /** Optional payload threaded through to the block for downstream consumers. */
  readonly meta?: unknown;
}

/**
 * Construct a placeholder `BlockNode` whose rows arrive on demand.
 *
 * Composes the `loadRows` + `totalRowCount` + `defaultRowSize` knobs that
 * `BlockNode` already exposes into a single, easy-to-pass-around helper. Use
 * this as a child of a `CollapseNode` when the parent declares
 * `hasChildren: true` + `totalChildrenCount: N` but the actual rows must be
 * fetched from a remote source.
 *
 * The block stays at `totalCount * rowSize` tall while loading — virtualization
 * and the scroll-into-view machinery see a stable height before any data has
 * arrived. When the loader resolves, `totalRowCount` reconciles to the actual
 * count returned (which may be less than `totalCount` if the source was
 * shorter than declared).
 */
export function lazyBlock<T>(opts: LazyBlockOptions<T>): BlockNode {
  const {
    id,
    depth,
    totalCount,
    rowSize,
    loader,
    toRow,
    meta,
  } = opts;
  return new BlockNode({
    id,
    depth,
    totalRowCount: totalCount,
    defaultRowSize: rowSize ?? DEFAULT_ROW_SIZE,
    meta,
    loadRows: () =>
      loader().pipe(map((items) => items.map((item, index) => toRow(item, index)))),
  });
}

export interface LazyBlocksOptions<T> {
  /**
   * Prefix used to construct each block's id. Block N becomes
   * `${idPrefix}:${N}` — keep this stable to keep DOM identity stable across
   * re-builds.
   */
  readonly idPrefix: string;
  /** Logical depth — passed through to each constructed BlockNode. */
  readonly depth?: number;
  /** Total rows the region eventually exposes, across all blocks. */
  readonly totalCount: number;
  /** Block size (rows per chunk). Default 20. */
  readonly blockSize?: number;
  /** Skeleton placeholder height. Default `DEFAULT_ROW_SIZE`. */
  readonly rowSize?: number;
  /**
   * Paginated loader. Subscribed once per block when that block first becomes
   * stably visible in the viewport. Emits the rows for the requested page.
   * If the loader emits fewer rows than `take`, `BlockNode.totalRowCount`
   * reconciles to the actual count (the block shrinks). The subscription
   * stays open — later emissions replace the block's rows.
   */
  readonly loader: (skip: number, take: number) => Observable<readonly T[]>;
  /**
   * Map a loaded item to a `RowNode`. The mapper receives the per-batch index
   * (0..take-1) and the global index (`skip + indexInBatch`) for cases where
   * IDs must encode position.
   */
  readonly toRow: (item: T, indexInBatch: number, globalIndex: number) => RowNode;
}

/**
 * Split a lazy data source into N chunked `BlockNode`s, each owning its own
 * `blockSize`-sized window of the total set. When the leaf-block count exceeds
 * `blockSize`, the helper wraps them in group blocks (recursively) so the
 * caller's parent CollapseNode receives at most `blockSize` direct children.
 * Each leaf independently:
 *
 * - Sizes itself with `blockSize * rowSize` skeleton placeholders up front.
 * - Fires its own `loader(skip, take)` call the first time it becomes stably
 *   visible (Block component applies a ~200ms debounce so fast scrolls don't
 *   trigger a flurry of parallel requests).
 *
 * Use this for "tree of remote pages" patterns — a region with 10k rows
 * becomes 500 lazy 20-row leaf blocks grouped into ≤ 20-wide super-blocks;
 * opening the region renders only the visible band's blocks, scrolling to row
 * 6_000 only loads block #300 (and its ancestor groups never load anything).
 */
export function lazyBlocks<T>(opts: LazyBlocksOptions<T>): BlockNode[] {
  const blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE;
  const rowSize = opts.rowSize ?? DEFAULT_ROW_SIZE;
  const depth = opts.depth ?? 0;

  let level: BlockNode[] = [];
  for (let skip = 0; skip < opts.totalCount; skip += blockSize) {
    const take = Math.min(blockSize, opts.totalCount - skip);
    const baseIndex = skip;
    level.push(
      new BlockNode({
        id: `${opts.idPrefix}:L0:${level.length}`,
        depth,
        blockSize,
        totalRowCount: take,
        defaultRowSize: rowSize,
        loadRows: () =>
          opts.loader(baseIndex, take).pipe(
            map((items) => items.map((item, i) => opts.toRow(item, i, baseIndex + i))),
          ),
      }),
    );
  }

  let levelIdx = 1;
  while (level.length > blockSize) {
    level = groupBlocks(level, blockSize, `${opts.idPrefix}:L${levelIdx}`, depth);
    levelIdx++;
  }
  return level;
}
