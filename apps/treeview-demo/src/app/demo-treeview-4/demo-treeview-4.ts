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
  SelectionMode,
  TreeNode,
  TreeView,
} from '@gradii/treeview';

interface Item {
  id: string;
  name: string;
  detail?: string;
  children?: Item[];
}

const DATA: Item[] = [
  {
    id: 'kbd',
    name: 'Keyboard reference',
    children: [
      {
        id: 'kbd/move',
        name: 'Movement',
        children: [
          {
            id: 'kbd/move/down',
            name: 'ArrowDown',
            detail: 'Move to next visible item',
          },
          {
            id: 'kbd/move/up',
            name: 'ArrowUp',
            detail: 'Move to previous visible item',
          },
          { id: 'kbd/move/home', name: 'Home', detail: 'Jump to first item' },
          {
            id: 'kbd/move/end',
            name: 'End',
            detail: 'Jump to last visible item',
          },
        ],
      },
      {
        id: 'kbd/expand',
        name: 'Expand / collapse',
        children: [
          {
            id: 'kbd/expand/right',
            name: 'ArrowRight',
            detail: 'Expand · or descend into first child',
          },
          {
            id: 'kbd/expand/left',
            name: 'ArrowLeft',
            detail: 'Collapse · or jump to parent',
          },
        ],
      },
      {
        id: 'kbd/activate',
        name: 'Activation',
        children: [
          {
            id: 'kbd/activate/enter',
            name: 'Enter',
            detail: 'Toggle collapse · select row · load more',
          },
          {
            id: 'kbd/activate/space',
            name: 'Space',
            detail: 'Toggle checkbox · load more',
          },
        ],
      },
    ],
  },
  {
    id: 'mixed',
    name: 'Mixed content (test surfaces)',
    children: [
      ...buildLeafGroup('mixed/alpha', 'Alpha leaves', 12),
      {
        id: 'mixed/nested',
        name: 'Nested branch',
        children: [
          ...buildLeafGroup('mixed/nested/x', 'X', 8),
          {
            id: 'mixed/nested/deep',
            name: 'Deeper',
            children: buildLeafGroup('mixed/nested/deep/y', 'Y', 6),
          },
        ],
      },
      ...buildLeafGroup('mixed/beta', 'Beta leaves', 30),
    ],
  },
  {
    id: 'paged',
    name: 'Paged group (load-more)',
    children: buildLeafGroup('paged/log', 'log', 80),
  },
];

function buildLeafGroup(
  idPrefix: string,
  label: string,
  count: number,
): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `${idPrefix}/${i}`,
      name: `${label} ${String(i).padStart(3, '0')}`,
      detail: `leaf · idx ${i}`,
    });
  }
  return out;
}

@Component({
  selector: 'app-demo-treeview-4',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-4.html',
  styleUrl: './demo-treeview-4.css',
})
export class DemoTreeview4 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy(DATA, {
      childrenField: 'children',
      textField: 'name',
      idField: 'id',
      blockSize: 20,
      pageSize: 25,
      rootLabel: 'Demo 4 root',
    }),
  );

  readonly selectionMode = signal<SelectionMode>('single');
  readonly selectedKeys = signal<ReadonlySet<Key>>(new Set());
  readonly checkable = signal<boolean>(true);
  readonly checkedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly selectionModes: ReadonlyArray<SelectionMode> = [
    'none',
    'single',
    'multiple',
  ];

  readonly recentKeys = signal<string[]>([]);

  readonly nodeByKey = computed<ReadonlyMap<Key, TreeNode>>(() => {
    const map = new Map<Key, TreeNode>();
    indexNodes(this.root(), map);
    return map;
  });

  readonly checkedNodes = computed<ReadonlyArray<TreeNode>>(() => {
    const map = this.nodeByKey();
    const out: TreeNode[] = [];
    for (const k of this.checkedKeys()) {
      const n = map.get(k);
      if (n) out.push(n);
    }
    return out;
  });

  setMode(m: SelectionMode): void {
    this.selectionMode.set(m);
    this.selectedKeys.set(new Set());
  }

  toggleCheckable(): void {
    this.checkable.update((v) => !v);
    if (!this.checkable()) this.checkedKeys.set(new Set());
  }

  /**
   * Mirror keystrokes into the side panel so users see exactly which keys are
   * being intercepted. We use the capture-phase listener at document level for
   * the demo only — the tree itself uses its own keydown handler.
   */
  onWindowKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && !target.closest('app-large-tree-view')) return;
    const next = [keyLabel(event), ...this.recentKeys()].slice(0, 12);
    this.recentKeys.set(next);
  }

  labelOf(node: TreeNode): string {
    if (node.kind === 'block') return node.id;
    if (node.kind === 'loadmore') return node.label();
    return node.label();
  }
}

function indexNodes(node: TreeNode, out: Map<Key, TreeNode>): void {
  if (node.kind === 'row' || node.kind === 'collapse') out.set(node.id, node);
  if (node.kind === 'row' || node.kind === 'loadmore') return;
  for (const c of node.children()) indexNodes(c, out);
}

function keyLabel(event: KeyboardEvent): string {
  const mods: string[] = [];
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.metaKey) mods.push('Cmd');
  if (event.shiftKey) mods.push('Shift');
  if (event.altKey) mods.push('Alt');
  const key = event.key === ' ' ? 'Space' : event.key;
  return [...mods, key].join('+');
}
