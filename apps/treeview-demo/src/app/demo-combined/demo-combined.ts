import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  signal,
} from '@angular/core';
import { buildFileTree } from '../file-tree-data';
import {
  BlockNode,
  CheckableSettings,
  CollapseNode,
  generateTree,
  Key,
  RowNode,
  SelectionMode,
  setCollapsedRecursive,
  TreeView,
} from '@gradii/treeview';

type DataSource = 'stress' | 'files';

interface CheckablePreset {
  readonly label: string;
  readonly value: boolean | CheckableSettings;
}

@Component({
  selector: 'app-demo-combined',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-combined.html',
  styleUrl: './demo-combined.scss',
})
export class DemoCombined {
  readonly depthOptions = [2, 3, 4, 5];
  readonly depth = signal(3);
  readonly stickyHeaders = signal(true);
  readonly stressRoot = computed<CollapseNode>(() =>
    generateTree({ depth: this.depth(), variableRowHeight: true }),
  );

  readonly filesRoot = computed<CollapseNode>(() => buildFileTree());

  readonly source = signal<DataSource>('stress');
  readonly activeRoot = computed<CollapseNode>(() =>
    this.source() === 'stress' ? this.stressRoot() : this.filesRoot(),
  );

  readonly selectionModes: ReadonlyArray<SelectionMode> = [
    'none',
    'single',
    'multiple',
  ];
  readonly selectionMode = signal<SelectionMode>('none');
  readonly selectedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly checkablePresets: ReadonlyArray<CheckablePreset> = [
    { label: 'off', value: false },
    { label: 'multi (defaults)', value: true },
    { label: 'multi, no parents', value: { checkParents: false } },
    { label: 'multi, no children cascade', value: { checkChildren: false } },
    { label: 'single', value: { mode: 'single' } },
    { label: 'multi + checkOnClick', value: { checkOnClick: true } },
  ];
  readonly checkablePresetIndex = signal(0);
  readonly checkable = computed(
    () => this.checkablePresets[this.checkablePresetIndex()].value,
  );
  readonly checkedKeys = signal<ReadonlySet<Key>>(new Set());

  readonly useExternalExpand = signal(false);
  readonly expandedKeys = signal<ReadonlySet<Key>>(new Set());
  readonly effectiveExpandedKeys = computed<ReadonlySet<Key> | null>(() =>
    this.useExternalExpand() ? this.expandedKeys() : null,
  );

  readonly selectedCount = computed(() => this.selectedKeys().size);
  readonly checkedCount = computed(() => this.checkedKeys().size);
  readonly expandedCount = computed(() => this.expandedKeys().size);

  constructor() {
    effect(() => {
      this.source();
      this.depth();
      this.selectedKeys.set(new Set());
      this.checkedKeys.set(new Set());
      this.expandedKeys.set(new Set());
    });
  }

  setSource(s: DataSource): void {
    this.source.set(s);
  }

  setSelectionMode(m: SelectionMode): void {
    this.selectionMode.set(m);
    this.selectedKeys.set(new Set());
  }
  clearSelection(): void {
    this.selectedKeys.set(new Set());
  }

  setCheckablePreset(i: number): void {
    this.checkablePresetIndex.set(i);
    this.checkedKeys.set(new Set());
  }
  clearChecked(): void {
    this.checkedKeys.set(new Set());
  }

  setExpandOwner(external: boolean): void {
    this.useExternalExpand.set(external);
    this.expandedKeys.set(new Set());
  }
  toggleExpandOwner(): void {
    this.setExpandOwner(!this.useExternalExpand());
  }

  onDepthChange(e: Event): void {
    this.depth.set(Number((e.target as HTMLSelectElement).value));
  }
  expandAll(): void {
    setCollapsedRecursive(this.activeRoot(), false);
  }
  collapseAll(): void {
    setCollapsedRecursive(this.activeRoot(), true);
    this.activeRoot().expand();
  }
  toggleSticky(): void {
    this.stickyHeaders.update((v) => !v);
  }
  resizeRandomRow(): void {
    if (this.source() !== 'stress') return;
    const row = this._pickRandomRow(this.activeRoot());
    if (row) row.size.set(18 + Math.floor(Math.random() * 200));
  }

  private _pickRandomRow(node: CollapseNode): RowNode | null {
    // Walk down through either Collapse or Block until we land on a row.
    let cur: CollapseNode | BlockNode = node;
    for (;;) {
      const kids: ReadonlyArray<CollapseNode | BlockNode | RowNode> =
        cur.children();
      if (kids.length === 0) return null;
      const pick = kids[Math.floor(Math.random() * kids.length)];
      if (pick.kind === 'row') return pick;
      cur = pick;
    }
  }
}
