import {
  BlockNode,
  CollapseChild,
  CollapseNode,
  DEFAULT_BLOCK_SIZE,
  DEFAULT_ROW_SIZE,
  RowNode,
} from './tree-model';

export interface GenerateOptions {
  /** Number of nested Collapse levels. */
  depth: number;
  /** Children per Collapse / rows per Block. */
  blockSize?: number;
  /** Vary row heights to exercise renderSize clamping. */
  variableRowHeight?: boolean;
  /** Seed for deterministic generation. */
  seed?: number;
}

interface Counter {
  blocks: number;
  collapses: number;
  rows: number;
}

export function generateTree(opts: GenerateOptions): CollapseNode {
  const blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE;
  const variable = opts.variableRowHeight ?? false;
  const rng = mulberry32(opts.seed ?? 0xc0ffee);
  const counter: Counter = { blocks: 0, collapses: 0, rows: 0 };
  return buildCollapse(0, opts.depth, blockSize, variable, rng, counter);
}

function buildCollapse(
  depth: number,
  maxDepth: number,
  blockSize: number,
  variable: boolean,
  rng: () => number,
  counter: Counter,
): CollapseNode {
  const id = `c${counter.collapses++}`;
  const children: CollapseChild[] = [];
  const isLeaf = depth >= maxDepth;

  for (let i = 0; i < blockSize; i++) {
    // Leaf collapses hold only data Blocks. Non-leaf collapses mix sub-Collapses
    // with Block chunks (every third slot) so every level carries leaf data
    // alongside its sub-skeleton.
    const slotIsBlock = isLeaf || i % 3 === 0;
    if (slotIsBlock) {
      children.push(buildBlock(depth + 1, blockSize, variable, rng, counter));
    } else {
      children.push(buildCollapse(depth + 1, maxDepth, blockSize, variable, rng, counter));
    }
  }

  return new CollapseNode({
    id,
    label: `Collapse ${id} · L${depth}`,
    depth,
    children,
  });
}

function buildBlock(
  logicalDepth: number,
  blockSize: number,
  variable: boolean,
  rng: () => number,
  counter: Counter,
): BlockNode {
  const id = `b${counter.blocks++}`;
  const rows: RowNode[] = [];
  for (let i = 0; i < blockSize; i++) {
    rows.push(makeRow(counter, logicalDepth, variable, rng));
  }
  return new BlockNode({ id, depth: logicalDepth, children: rows });
}

function makeRow(
  counter: Counter,
  parentDepth: number,
  variable: boolean,
  rng: () => number,
): RowNode {
  const idx = counter.rows++;
  const sizeVal = variable
    ? DEFAULT_ROW_SIZE + Math.floor(rng() * 64)
    : DEFAULT_ROW_SIZE;
  return new RowNode({
    id: `r${idx}`,
    label: `Row #r${idx} · L${parentDepth}`,
    size: sizeVal,
    minSize: 18,
    maxSize: 240,
  });
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
