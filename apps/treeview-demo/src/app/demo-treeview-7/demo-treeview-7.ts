import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  BlockNode,
  buildFromHierarchy,
  CollapseNode,
  insertRowAtEdge,
  insertRowSibling,
  removeRowFromSource,
  RowNode,
  SourceAccessors,
  TreeView,
} from '@gradii/treeview';

interface Item {
  id: string;
  label: string;
}

interface Bucket {
  id: string;
  name: string;
  items: Item[];
}

const INITIAL_ROWS = 10_000;
const BLOCK_SIZE = 20;
let insertCounter = 0;

const accessors: SourceAccessors<Bucket, Item> = {
  childrenField: (bucket) => bucket.items,
};

@Component({
  selector: 'app-demo-treeview-7',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-7.html',
  styleUrl: './demo-treeview-7.css',
})
export class DemoTreeview7 {
  // Single bucket whose `items[]` array IS the source of truth.
  private readonly bucket: Bucket = buildBucket();

  readonly root = signal<CollapseNode>(buildRoot(this.bucket));

  readonly insertIndex = signal<number>(5000);
  readonly status = signal<string>('Ready');

  /** Mirrors `bucket.items.length` reactively after every mutation. */
  readonly sourceCount = signal<number>(this.bucket.items.length);

  readonly stats = computed(() => {
    this.status();
    return measure(this.root());
  });

  setInsertIndex(value: string): void {
    const n = Number(value);
    if (Number.isFinite(n)) this.insertIndex.set(Math.max(0, Math.floor(n)));
  }

  insertOne(): void {
    const at = Math.min(this.insertIndex(), this.bucket.items.length);
    const newItem: Item = {
      id: `dyn-${++insertCounter}`,
      label: `★ inserted at ${at} (#${insertCounter})`,
    };

    // Reference-row insert when possible (exercises insertRowSibling); fall
    // back to edge insert at boundaries.
    const refRow =
      at < this.bucket.items.length
        ? findRowForItem(this.root(), this.bucket.items[at])
        : null;

    if (refRow !== null) {
      insertRowSibling(refRow, newItem, 'before', {
        accessors,
        toRow: itemToRow,
      });
    } else {
      insertRowAtEdge(this.root(), newItem, 'last', {
        accessors,
        toRow: itemToRow,
      });
    }
    this._afterMutation(`Inserted ${newItem.id} at source index ${at}`);
  }

  insertBatch(): void {
    const base = Math.min(this.insertIndex(), this.bucket.items.length);
    for (let i = 0; i < 50; i++) {
      const at = Math.min(base + i, this.bucket.items.length);
      const newItem: Item = {
        id: `dyn-${++insertCounter}`,
        label: `★ batch row ${i} at ${at} (#${insertCounter})`,
      };
      const refRow =
        at < this.bucket.items.length
          ? findRowForItem(this.root(), this.bucket.items[at])
          : null;
      if (refRow !== null) {
        insertRowSibling(refRow, newItem, 'before', {
          accessors,
          toRow: itemToRow,
        });
      } else {
        insertRowAtEdge(this.root(), newItem, 'last', {
          accessors,
          toRow: itemToRow,
        });
      }
    }
    this._afterMutation(`Inserted 50 rows starting at source index ${base}`);
  }

  removeFirstDynamic(): void {
    const dynItem = this.bucket.items.find((it) => it.id.startsWith('dyn-'));
    if (dynItem === undefined) {
      this.status.set('No dynamic rows in source');
      return;
    }
    const row = findRowForItem(this.root(), dynItem);
    if (row === null) {
      this.status.set('Source has the item but no tree row found');
      return;
    }
    const ok = removeRowFromSource(row, accessors);
    if (!ok) {
      this.status.set('Removal failed');
      return;
    }
    this._afterMutation(`Removed ${dynItem.id} (source + tree)`);
  }

  private _afterMutation(msg: string): void {
    this.sourceCount.set(this.bucket.items.length);
    this.status.set(msg);
  }
}

function itemToRow(item: Item): RowNode {
  return new RowNode({ id: item.id, label: item.label, meta: item });
}

function buildBucket(): Bucket {
  const items: Item[] = [];
  for (let i = 0; i < INITIAL_ROWS; i++) {
    items.push({ id: `row-${i}`, label: `Row ${String(i).padStart(5, '0')}` });
  }
  return { id: 'bucket', name: 'rows', items };
}

function buildRoot(bucket: Bucket): CollapseNode {
  const root = buildFromHierarchy<Bucket | Item>([bucket], {
    childrenField: (node) =>
      'items' in node ? (node.items as readonly (Bucket | Item)[]) : undefined,
    textField: (node) => ('items' in node ? node.name : node.label),
    idField: 'id',
    blockSize: BLOCK_SIZE,
    rootLabel: 'demo-7',
  });
  return root;
}

function findRowForItem(root: CollapseNode, target: Item): RowNode | null {
  for (const c of root.children()) {
    if (c.kind === 'collapse') {
      const found = findRowForItem(c, target);
      if (found) return found;
    } else {
      const found = findRowForItemInBlock(c, target);
      if (found) return found;
    }
  }
  return null;
}

function findRowForItemInBlock(block: BlockNode, target: Item): RowNode | null {
  for (const c of block.children()) {
    if (c.kind === 'row') {
      if (c.meta === target) return c;
    } else if (c.kind === 'block') {
      const sub = findRowForItemInBlock(c, target);
      if (sub) return sub;
    }
  }
  return null;
}

interface BlockStats {
  totalBlocks: number;
  totalLeafBlocks: number;
  totalGroupBlocks: number;
  maxDepth: number;
  totalRows: number;
  maxLeafSize: number;
  minLeafSize: number;
}

function measure(root: CollapseNode): BlockStats {
  const stats: BlockStats = {
    totalBlocks: 0,
    totalLeafBlocks: 0,
    totalGroupBlocks: 0,
    maxDepth: 0,
    totalRows: 0,
    maxLeafSize: 0,
    minLeafSize: Number.POSITIVE_INFINITY,
  };
  walkCollapse(root, 0);
  if (!Number.isFinite(stats.minLeafSize)) stats.minLeafSize = 0;
  return stats;

  function walkCollapse(node: CollapseNode, depth: number): void {
    for (const c of node.children()) {
      if (c.kind === 'block') walkBlock(c, depth + 1);
      else walkCollapse(c, depth);
    }
  }

  function walkBlock(block: BlockNode, depth: number): void {
    stats.totalBlocks++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    const children = block.children();
    if (children.length === 0 || children[0].kind === 'row') {
      stats.totalLeafBlocks++;
      const size = children.length;
      stats.totalRows += size;
      stats.maxLeafSize = Math.max(stats.maxLeafSize, size);
      stats.minLeafSize = Math.min(stats.minLeafSize, size);
    } else {
      stats.totalGroupBlocks++;
      for (const c of children) {
        if (c.kind === 'block') walkBlock(c, depth + 1);
      }
    }
  }
}
