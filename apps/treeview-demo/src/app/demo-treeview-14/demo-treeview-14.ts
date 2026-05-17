import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  signal,
} from '@angular/core';
import {
  CollapseNode,
  generateTree,
  setCollapsedRecursive,
  StickyConfig,
  TreeView,
} from '@gradii/treeview';

function forEachCollapse(
  node: CollapseNode,
  visit: (n: CollapseNode) => void,
): void {
  visit(node);
  for (const child of node.children()) {
    if (child.kind === 'collapse') forEachCollapse(child, visit);
  }
}

@Component({
  selector: 'app-demo-treeview-14',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-14.html',
  styleUrl: './demo-treeview-14.css',
})
export class DemoTreeview14 {
  readonly root = computed<CollapseNode>(() =>
    generateTree({ depth: 3, blockSize: 8, variableRowHeight: true }),
  );

  readonly marginTop = signal(12);
  readonly marginLeft = signal(12);
  readonly marginRight = signal(12);

  /**
   * Per-level header sizes. Each entry is the `headerSize` applied to every
   * `CollapseNode` at that depth, demonstrating that sticky items can each
   * have a different height (no uniform `itemHeight` override needed).
   */
  readonly levelHeights = signal<number[]>([56, 44, 36, 28]);
  readonly levelIndices = [0, 1, 2, 3];

  readonly stickyConfig = computed<StickyConfig>(() => ({
    marginTop: this.marginTop(),
    marginLeft: this.marginLeft(),
    marginRight: this.marginRight(),
  }));

  constructor() {
    effect(() => {
      const heights = this.levelHeights();
      forEachCollapse(this.root(), (n) => {
        const h = heights[n.depth()] ?? heights[heights.length - 1];
        if (n.headerSize() !== h) n.headerSize.set(h);
      });
    });
  }

  setMarginTop(v: number): void {
    this.marginTop.set(v);
  }

  setMarginLeft(v: number): void {
    this.marginLeft.set(v);
  }

  setMarginRight(v: number): void {
    this.marginRight.set(v);
  }

  setLevelHeight(level: number, value: number): void {
    const cur = this.levelHeights();
    if (cur[level] === value) return;
    const next = cur.slice();
    next[level] = value;
    this.levelHeights.set(next);
  }

  expandAll(): void {
    setCollapsedRecursive(this.root(), false);
  }

  collapseAll(): void {
    setCollapsedRecursive(this.root(), true);
    this.root().expand();
  }
}
