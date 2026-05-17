import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  buildFromHierarchy,
  CheckableSettings,
  CollapseNode,
  Key,
  RowNode,
  setCollapsedRecursive,
  TreeNode,
  TreeView,
} from '@gradii/treeview';

interface PrefItem {
  id: string;
  label: string;
  hint?: string;
  children?: PrefItem[];
}

const PREFS: PrefItem[] = [
  {
    id: 'activity',
    label: 'Activity',
    children: [
      { id: 'activity/mentions', label: 'Mentions', hint: '@you in comments' },
      {
        id: 'activity/replies',
        label: 'Replies',
        hint: 'Replies to your threads',
      },
      { id: 'activity/reactions', label: 'Reactions', hint: 'Likes & emoji' },
      { id: 'activity/follows', label: 'New followers' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    children: [
      {
        id: 'work/issues',
        label: 'Issues',
        children: [
          { id: 'work/issues/assigned', label: 'Assigned to me' },
          { id: 'work/issues/mentioned', label: 'I am mentioned' },
          { id: 'work/issues/closed', label: 'Closed' },
          { id: 'work/issues/reopened', label: 'Reopened' },
        ],
      },
      {
        id: 'work/prs',
        label: 'Pull requests',
        children: [
          { id: 'work/prs/review', label: 'Review requested' },
          { id: 'work/prs/merged', label: 'Merged' },
          { id: 'work/prs/conflicts', label: 'Merge conflicts' },
        ],
      },
      {
        id: 'work/deploys',
        label: 'Deploys',
        children: [
          { id: 'work/deploys/failed', label: 'Failed' },
          { id: 'work/deploys/rollback', label: 'Rolled back' },
        ],
      },
    ],
  },
  {
    id: 'announcements',
    label: 'Announcements',
    children: [
      { id: 'announcements/company', label: 'Company-wide' },
      { id: 'announcements/team', label: 'Team-only' },
      { id: 'announcements/changelog', label: 'Product changelog' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    children: [
      { id: 'security/login', label: 'New device sign-in' },
      { id: 'security/recovery', label: 'Recovery codes' },
      { id: 'security/api-keys', label: 'API key activity' },
    ],
  },
];

interface CheckablePreset {
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly value: boolean | CheckableSettings;
}

@Component({
  selector: 'app-demo-treeview-2',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-2.html',
  styleUrl: './demo-treeview-2.css',
})
export class DemoTreeview2 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy(PREFS, {
      childrenField: 'children',
      textField: 'label',
      idField: 'id',
      blockSize: 0,
      rootLabel: 'Notification preferences',
    }),
  );

  readonly presets: ReadonlyArray<CheckablePreset> = [
    {
      key: 'multi-full',
      label: 'multi · full cascade',
      summary:
        'Defaults. Checking a parent fills its descendants; parents go indeterminate when only some descendants are checked.',
      value: true,
    },
    {
      key: 'multi-no-parents',
      label: 'multi · no parent cascade',
      summary:
        'checkParents: false. Children cascade down, but parents never derive indeterminate / checked from descendants.',
      value: { checkParents: false },
    },
    {
      key: 'multi-no-children',
      label: 'multi · no child cascade',
      summary:
        'checkChildren: false. Each node is checked on its own; parents still go indeterminate when a descendant is checked.',
      value: { checkChildren: false },
    },
    {
      key: 'multi-checkOnClick',
      label: 'multi · checkOnClick',
      summary:
        'Plain row click also toggles the checkbox (in addition to the checkbox itself).',
      value: { checkOnClick: true },
    },
    {
      key: 'single',
      label: 'single',
      summary: 'At most one node may be checked. Cascade settings are ignored.',
      value: { mode: 'single' },
    },
  ];
  readonly presetIndex = signal(0);
  readonly checkable = computed(() => this.presets[this.presetIndex()].value);
  readonly presetSummary = computed(
    () => this.presets[this.presetIndex()].summary,
  );

  readonly checkedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly nodeByKey = computed<ReadonlyMap<Key, TreeNode>>(() => {
    const map = new Map<Key, TreeNode>();
    indexNodes(this.root(), map);
    return map;
  });

  readonly checkedNodes = computed<ReadonlyArray<TreeNode>>(() => {
    const map = this.nodeByKey();
    const out: TreeNode[] = [];
    for (const key of this.checkedKeys()) {
      const node = map.get(key);
      if (node) out.push(node);
    }
    out.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    return out;
  });

  readonly leafCheckedCount = computed(() => {
    const map = this.nodeByKey();
    let n = 0;
    for (const key of this.checkedKeys()) {
      const node = map.get(key);
      if (node && node.kind === 'row') n++;
    }
    return n;
  });

  readonly totalLeafCount = computed(() => {
    let n = 0;
    for (const node of this.nodeByKey().values()) {
      if (node.kind === 'row') n++;
    }
    return n;
  });

  setPreset(i: number): void {
    this.presetIndex.set(i);
    this.checkedKeys.set(new Set());
  }

  checkAll(): void {
    const next = new Set<Key>();
    for (const [key, node] of this.nodeByKey()) {
      if (node.id === this.root().id) continue;
      next.add(key);
    }
    this.checkedKeys.set(next);
  }

  checkAllLeaves(): void {
    const next = new Set<Key>();
    for (const [key, node] of this.nodeByKey()) {
      if (node.kind === 'row') next.add(key);
    }
    this.checkedKeys.set(next);
  }

  clear(): void {
    this.checkedKeys.set(new Set());
  }

  expandAll(): void {
    setCollapsedRecursive(this.root(), false);
  }

  collapseAll(): void {
    setCollapsedRecursive(this.root(), true);
    this.root().expand();
  }

  hint(node: TreeNode): string {
    if (node.kind === 'block') return '';
    const data = node.meta as PrefItem | undefined;
    if (data?.hint) return data.hint;
    return node.kind === 'row' ? 'leaf preference' : 'group';
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
