import { BlockNode, CollapseNode } from "./tree-model";

/**
 * Visual density variant. Drives:
 * - CSS variables for font/padding/gap/icon size (purely cosmetic — applied by
 *   the host class `tv-size-{variant}` set on LargeTreeView).
 * - Default row/header heights when `applyTreeSize` is called against a tree.
 *
 * The variant does **not** automatically resize already-built tree nodes:
 * row heights come from `RowNode.size` (a per-node signal), which the
 * virtualization layer reads to position children. Callers can either rebuild
 * their tree on variant change, or invoke `applyTreeSize(root, variant)` to
 * stamp the variant's defaults onto every node in place.
 */
export type SizeVariant = 'small' | 'medium' | 'large';

export interface SizeTokens {
  /** Recommended `RowNode.size` for this variant. */
  readonly rowHeight: number;
  /** Recommended `CollapseNode.headerSize` for this variant. */
  readonly headerHeight: number;
  /** Recommended `BlockNode.defaultRowSize` for placeholder rows. */
  readonly placeholderHeight: number;
  /** Body font size in CSS px. */
  readonly fontSize: number;
  /** Secondary/meta text font size in CSS px. */
  readonly metaFontSize: number;
  /** Caret + checkbox + grip glyph size in CSS px. */
  readonly iconSize: number;
  /** Per-depth indent step in CSS px (added to `--tv-indent-base`). */
  readonly indentStep: number;
  /** Left padding floor for any node at depth 0. */
  readonly indentBase: number;
  /** Horizontal gap between caret / checkbox / label inside a row or header. */
  readonly gap: number;
}

export const SIZE_TOKENS: Record<SizeVariant, SizeTokens> = {
  small: {
    rowHeight: 22,
    headerHeight: 22,
    placeholderHeight: 22,
    fontSize: 11.5,
    metaFontSize: 10,
    iconSize: 12,
    indentStep: 10,
    indentBase: 6,
    gap: 4,
  },
  medium: {
    rowHeight: 28,
    headerHeight: 28,
    placeholderHeight: 28,
    fontSize: 12.5,
    metaFontSize: 11,
    iconSize: 14,
    indentStep: 14,
    indentBase: 8,
    gap: 6,
  },
  large: {
    rowHeight: 36,
    headerHeight: 36,
    placeholderHeight: 36,
    fontSize: 14,
    metaFontSize: 12,
    iconSize: 16,
    indentStep: 18,
    indentBase: 10,
    gap: 8,
  },
};

/**
 * Stamp the variant's default row / header / placeholder heights onto every
 * node in the tree. Walks the full Collapse + Block subtree once.
 *
 * Use this when you want the variant to actually change physical row heights
 * (not just the visual density of fonts and padding). Skipped when a node has
 * a non-default size — callers who explicitly set per-row sizes for their data
 * keep those overrides. "Non-default" means the size doesn't match any other
 * variant's row height; if it matches a different variant, this function
 * overwrites it (so the variant switch lands).
 */
export function applyTreeSize(root: CollapseNode, variant: SizeVariant): void {
  const tokens = SIZE_TOKENS[variant];
  const knownHeights = new Set<number>([
    SIZE_TOKENS.small.rowHeight,
    SIZE_TOKENS.medium.rowHeight,
    SIZE_TOKENS.large.rowHeight,
  ]);
  visitCollapse(root);

  function visitCollapse(node: CollapseNode): void {
    if (knownHeights.has(node.headerSize())) {
      node.headerSize.set(tokens.headerHeight);
    }
    for (const child of node.children()) {
      if (child.kind === 'collapse') visitCollapse(child);
      else visitBlock(child);
    }
    const lm = node.loadMore();
    if (lm !== null && knownHeights.has(lm.renderSize())) {
      lm.renderSize.set(tokens.rowHeight);
    }
  }

  function visitBlock(block: BlockNode): void {
    if (knownHeights.has(block.defaultRowSize())) {
      block.defaultRowSize.set(tokens.placeholderHeight);
    }
    for (const child of block.children()) {
      if (child.kind === 'row') {
        if (knownHeights.has(child.size())) child.size.set(tokens.rowHeight);
      } else if (child.kind === 'block') {
        visitBlock(child);
      } else {
        visitCollapse(child);
      }
    }
  }
}
