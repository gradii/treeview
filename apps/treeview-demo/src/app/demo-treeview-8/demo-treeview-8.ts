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
  TreeView,
} from '@gradii/treeview';

interface OrgItem {
  id: string;
  name: string;
  children?: OrgItem[];
}

const ORG: OrgItem[] = [
  {
    id: 'engineering',
    name: 'Engineering',
    children: [
      {
        id: 'platform',
        name: 'Platform',
        children: [
          { id: 'alice', name: 'Alice Park' },
          { id: 'bob', name: 'Bob Liu' },
          { id: 'cleo', name: 'Cleo Martin' },
        ],
      },
      {
        id: 'frontend',
        name: 'Frontend (frozen)',
        children: [
          { id: 'dax', name: 'Dax Romero' },
          { id: 'eve', name: 'Eve Tanaka' },
          { id: 'finn', name: 'Finn Adler' },
        ],
      },
      {
        id: 'data',
        name: 'Data',
        children: [
          { id: 'hank', name: 'Hank Mori' },
          { id: 'iris', name: 'Iris Chen (on leave)' },
        ],
      },
    ],
  },
  {
    id: 'design',
    name: 'Design',
    children: [
      { id: 'jay', name: 'Jay Okafor' },
      { id: 'kira', name: 'Kira Sato' },
      { id: 'leo', name: 'Leo Watts' },
    ],
  },
  {
    id: 'ops',
    name: 'Operations (read-only)',
    children: [
      { id: 'owen', name: 'Owen Bell' },
      { id: 'piper', name: 'Piper Quinn' },
    ],
  },
];

/**
 * Initial disabled set:
 * - `frontend` — whole team frozen (selection/check off; cascades to members
 *   unless `disableParentNodesOnly` is on)
 * - `iris` — single member on leave
 * - `ops` — read-only group (cascades to Owen/Piper by default)
 */
const INITIAL_DISABLED = new Set<Key>(['frontend', 'iris', 'ops']);

@Component({
  selector: 'app-demo-treeview-8',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-8.html',
  styleUrl: './demo-treeview-8.css',
})
export class DemoTreeview8 {
  readonly root = computed<CollapseNode>(() =>
    buildFromHierarchy(ORG, {
      childrenField: 'children',
      textField: 'name',
      idField: 'id',
      blockSize: 0,
      rootLabel: 'Company',
    }),
  );

  readonly disabledKeys = signal<ReadonlySet<Key>>(INITIAL_DISABLED);
  readonly disableParentNodesOnly = signal(false);
  readonly expandDisabledNodes = signal(false);
  readonly checkable = signal(true);
  readonly selectedKeys = signal<ReadonlySet<Key>>(new Set());
  readonly checkedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly selectionMode = signal<SelectionMode>('multiple');
  readonly selectionModes: ReadonlyArray<SelectionMode> = [
    'none',
    'single',
    'multiple',
  ];

  toggleParentsOnly(): void {
    this.disableParentNodesOnly.update((v) => !v);
  }

  setSelectionMode(m: SelectionMode): void {
    this.selectionMode.set(m);
    this.selectedKeys.set(new Set());
  }

  toggleExpandDisabled(): void {
    this.expandDisabledNodes.update((v) => !v);
  }

  toggleCheckable(): void {
    this.checkable.update((v) => !v);
    if (!this.checkable()) this.checkedKeys.set(new Set());
  }

  resetDisabled(): void {
    this.disabledKeys.set(INITIAL_DISABLED);
  }

  toggleKey(key: Key): void {
    this.disabledKeys.update((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  isDisabled(key: Key): boolean {
    return this.disabledKeys().has(key);
  }
}
