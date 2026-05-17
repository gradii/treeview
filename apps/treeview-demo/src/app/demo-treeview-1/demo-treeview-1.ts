import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  buildFromHierarchy,
  CollapseNode,
  Key,
  RowNode,
  SelectionMode,
  setCollapsedRecursive,
  TreeNode,
  TreeView,
  visibleFlatKeys,
} from '@gradii/treeview';

interface OrgItem {
  id: string;
  name: string;
  title?: string;
  team?: string;
  children?: OrgItem[];
}

const ORG: OrgItem[] = [
  {
    id: 'eng',
    name: 'Engineering',
    children: [
      {
        id: 'eng/platform',
        name: 'Platform',
        children: [
          {
            id: 'eng/platform/alice',
            name: 'Alice Park',
            title: 'Staff Eng',
            team: 'platform',
          },
          {
            id: 'eng/platform/bob',
            name: 'Bob Liu',
            title: 'Senior Eng',
            team: 'platform',
          },
          {
            id: 'eng/platform/cleo',
            name: 'Cleo Martin',
            title: 'Eng',
            team: 'platform',
          },
        ],
      },
      {
        id: 'eng/frontend',
        name: 'Frontend',
        children: [
          {
            id: 'eng/frontend/dax',
            name: 'Dax Romero',
            title: 'Senior Eng',
            team: 'frontend',
          },
          {
            id: 'eng/frontend/eve',
            name: 'Eve Tanaka',
            title: 'Eng',
            team: 'frontend',
          },
          {
            id: 'eng/frontend/finn',
            name: 'Finn Adler',
            title: 'Eng II',
            team: 'frontend',
          },
          {
            id: 'eng/frontend/gina',
            name: 'Gina Brooks',
            title: 'Eng',
            team: 'frontend',
          },
        ],
      },
      {
        id: 'eng/data',
        name: 'Data',
        children: [
          {
            id: 'eng/data/hank',
            name: 'Hank Mori',
            title: 'Staff Eng',
            team: 'data',
          },
          {
            id: 'eng/data/iris',
            name: 'Iris Chen',
            title: 'Senior Eng',
            team: 'data',
          },
        ],
      },
    ],
  },
  {
    id: 'design',
    name: 'Design',
    children: [
      {
        id: 'design/product',
        name: 'Product Design',
        children: [
          {
            id: 'design/product/jay',
            name: 'Jay Okafor',
            title: 'Principal Designer',
            team: 'product-design',
          },
          {
            id: 'design/product/kira',
            name: 'Kira Sato',
            title: 'Senior Designer',
            team: 'product-design',
          },
          {
            id: 'design/product/leo',
            name: 'Leo Watts',
            title: 'Designer',
            team: 'product-design',
          },
        ],
      },
      {
        id: 'design/brand',
        name: 'Brand',
        children: [
          {
            id: 'design/brand/mira',
            name: 'Mira Voss',
            title: 'Brand Lead',
            team: 'brand',
          },
          {
            id: 'design/brand/nyx',
            name: 'Nyx Aragon',
            title: 'Brand Designer',
            team: 'brand',
          },
        ],
      },
    ],
  },
  {
    id: 'ops',
    name: 'Operations',
    children: [
      { id: 'ops/owen', name: 'Owen Bell', title: 'COO', team: 'ops' },
      {
        id: 'ops/piper',
        name: 'Piper Quinn',
        title: 'People Ops',
        team: 'ops',
      },
      { id: 'ops/ravi', name: 'Ravi Shah', title: 'Finance', team: 'ops' },
    ],
  },
];

@Component({
  selector: 'app-demo-treeview-1',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-1.html',
  styleUrl: './demo-treeview-1.css',
})
export class DemoTreeview1 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy(ORG, {
      childrenField: 'children',
      textField: 'name',
      idField: 'id',
      blockSize: 0,
      rootLabel: 'Company',
    }),
  );

  readonly selectionModes: ReadonlyArray<SelectionMode> = [
    'none',
    'single',
    'multiple',
  ];
  readonly selectionMode = signal<SelectionMode>('multiple');
  readonly selectedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly selectedCount = computed(() => this.selectedKeys().size);

  readonly nodeByKey = computed<ReadonlyMap<Key, TreeNode>>(() => {
    const map = new Map<Key, TreeNode>();
    indexNodes(this.root(), map);
    return map;
  });

  readonly selectedNodes = computed<ReadonlyArray<TreeNode>>(() => {
    const map = this.nodeByKey();
    const out: TreeNode[] = [];
    for (const key of this.selectedKeys()) {
      const node = map.get(key);
      if (node) out.push(node);
    }
    out.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    return out;
  });

  setSelectionMode(m: SelectionMode): void {
    this.selectionMode.set(m);
    this.selectedKeys.set(new Set());
  }

  selectAllPeople(): void {
    const next = new Set<Key>();
    for (const [key, node] of this.nodeByKey()) {
      if (node.kind === 'row') next.add(key);
    }
    this.selectedKeys.set(next);
    if (this.selectionMode() === 'none') this.selectionMode.set('multiple');
  }

  selectAllVisible(): void {
    const keys = visibleFlatKeys(this.root(), (n) => n.id);
    const filtered = new Set<Key>();
    const map = this.nodeByKey();
    for (const k of keys) {
      const node = map.get(k);
      if (node && node.id !== this.root().id) filtered.add(k);
    }
    this.selectedKeys.set(filtered);
    if (this.selectionMode() === 'none') this.selectionMode.set('multiple');
  }

  invertSelection(): void {
    const cur = this.selectedKeys();
    const next = new Set<Key>();
    for (const [key, node] of this.nodeByKey()) {
      if (node.id === this.root().id) continue;
      if (!cur.has(key)) next.add(key);
    }
    this.selectedKeys.set(next);
    if (this.selectionMode() === 'none') this.selectionMode.set('multiple');
  }

  clearSelection(): void {
    this.selectedKeys.set(new Set());
  }

  expandAll(): void {
    setCollapsedRecursive(this.root(), false);
  }

  collapseAll(): void {
    setCollapsedRecursive(this.root(), true);
    this.root().expand();
  }

  meta(node: TreeNode): string {
    const data = node.meta as OrgItem | undefined;
    if (!data) return '';
    if (data.title) return data.title;
    return node.kind === 'row' ? 'person' : 'group';
  }

  isLeaf(node: TreeNode): boolean {
    return node.kind === 'row';
  }
}

function indexNodes(node: TreeNode, out: Map<Key, TreeNode>): void {
  if (node.kind === 'row' || node.kind === 'collapse') out.set(node.id, node);
  if (node.kind === 'row' || node.kind === 'loadmore') return;
  for (const c of node.children()) indexNodes(c, out);
}

function labelOf(node: TreeNode): string {
  if (node.kind === 'block') return node.id;
  return (node as RowNode | CollapseNode).label();
}
