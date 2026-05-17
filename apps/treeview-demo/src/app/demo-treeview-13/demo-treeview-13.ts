import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  chunkRowsRecursive,
  CollapseNode,
  RowNode,
  setCollapsedRecursive,
  TreeView,
} from '@gradii/treeview';

function generateRows(count: number): RowNode[] {
  const rows: RowNode[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      new RowNode({
        id: `row-${i}`,
        label: `Row ${String(i).padStart(5, '0')}`,
        size: 28 + (i % 5) * 4,
      }),
    );
  }
  return rows;
}

/**
 * Builds a single CollapseNode whose leaf rows are organized into a
 * hierarchy of BlockNodes via `chunkRowsRecursive`. For example, 10 000
 * rows with blockSize=20 produces:
 *   - 500 leaf blocks (20 rows each)
 *   - 25 group blocks (20 leaf-blocks each)
 *   - 2 top-level super-group blocks
 *
 * This exercises the new block-as-DOM-container architecture: each block
 * level is a real positioned DOM element, sub-blocks are viewport-culled,
 * and leaf blocks render all their rows unconditionally.
 */
function buildLargeCollapseRoot(
  rowCount: number,
  blockSize: number,
): CollapseNode {
  const rows = generateRows(rowCount);
  const blocks = chunkRowsRecursive(rows, blockSize, '__tv:block:large', 1);
  return new CollapseNode({
    id: 'large-root',
    label: `${rowCount.toLocaleString()} rows · blockSize=${blockSize}`,
    depth: 0,
    children: blocks,
  });
}

@Component({
  selector: 'app-demo-treeview-13',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, TreeView],
  templateUrl: './demo-treeview-13.html',
  styleUrl: './demo-treeview-13.css',
})
export class DemoTreeview13 {
  readonly rowCountOptions = [1_000, 5_000, 10_000, 50_000, 100_000];
  readonly blockSizeOptions = [10, 20, 50, 100];

  readonly rowCount = signal(10_000);
  readonly blockSize = signal(20);

  readonly root = computed<CollapseNode>(() =>
    buildLargeCollapseRoot(this.rowCount(), this.blockSize()),
  );

  readonly blockDepth = computed(() => {
    let levels = 1;
    let n = this.rowCount();
    const bs = this.blockSize();
    while (n > bs) {
      n = Math.ceil(n / bs);
      levels++;
    }
    return levels;
  });

  readonly totalBlocks = computed(() => {
    let total = 0;
    let n = this.rowCount();
    const bs = this.blockSize();
    while (n > bs) {
      const count = Math.ceil(n / bs);
      total += count;
      n = count;
    }
    total += n;
    return total;
  });

  setRowCount(n: number): void {
    this.rowCount.set(n);
  }

  setBlockSize(n: number): void {
    this.blockSize.set(n);
  }

  expandAll(): void {
    setCollapsedRecursive(this.root(), false);
  }

  collapseAll(): void {
    setCollapsedRecursive(this.root(), true);
    this.root().expand();
  }
}
