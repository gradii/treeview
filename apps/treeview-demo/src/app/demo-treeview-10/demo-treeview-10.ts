import { JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  buildFromHierarchy,
  CollapseNode,
  RowNode,
  SourceAccessors,
  TreeView,
} from '@gradii/treeview';

interface Task {
  id: string;
  title: string;
}

interface Lane {
  id: string;
  name: string;
  tasks: Task[];
}

const INITIAL_LANES: Lane[] = [
  {
    id: 'todo',
    name: 'To do',
    tasks: [
      { id: 'todo/1', title: 'Wire up sticky scroll' },
      { id: 'todo/2', title: 'Add aria-activedescendant' },
      { id: 'todo/3', title: 'Cache row heights' },
      { id: 'todo/4', title: 'Restore scroll on rebuild' },
      { id: 'todo/5', title: 'Variable row heights' },
      { id: 'todo/6', title: 'Sticky drift on iOS Safari' },
      { id: 'todo/7', title: 'Lazy chunk loading' },
      { id: 'todo/8', title: 'Multi-select drag bundle' },
    ],
  },
  {
    id: 'in-gradii',
    name: 'In gradii',
    tasks: [
      { id: 'wip/1', title: 'Nested Block tree' },
      { id: 'wip/2', title: 'Filter mode toggle' },
      { id: 'wip/3', title: 'Drop hint visuals' },
      { id: 'wip/4', title: 'Auto-scroll during drag' },
      { id: 'wip/5', title: 'Snap-back animation' },
    ],
  },
  {
    id: 'done',
    name: 'Done',
    tasks: [
      { id: 'done/1', title: 'Selection (single + multi + shift)' },
      { id: 'done/2', title: 'Three-state check cascade' },
      { id: 'done/3', title: 'Load-more trailer' },
      { id: 'done/4', title: 'Lazy block placeholders' },
      { id: 'done/5', title: 'Keyboard navigation' },
      { id: 'done/6', title: 'Disabled state cascade' },
      { id: 'done/7', title: 'Filter engine with operators' },
      { id: 'done/8', title: 'Drag-handle option' },
      { id: 'done/9', title: 'Escape cancels drag' },
      { id: 'done/10', title: 'Cross-tree drop routing' },
      { id: 'done/11', title: 'Shape-compatibility guards' },
      { id: 'done/12', title: 'Drop-on-folder header' },
    ],
  },
];

const accessors: SourceAccessors<Lane | Lane[], Lane | Task> = {
  // Lane[]  →  the array itself (root's "children" are the lanes).
  // Lane    →  lane.tasks (lane's children are tasks).
  // Task    →  no children (returns undefined → leaf).
  childrenField: (parent) =>
    Array.isArray(parent)
      ? parent
      : 'tasks' in parent
        ? parent.tasks
        : undefined,
};

interface MoveLog {
  source: string;
  target: string;
  position: 'before' | 'over' | 'after';
  kind: 'row→row' | 'row→folder' | 'folder→folder';
}

@Component({
  selector: 'app-demo-treeview-10',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPipe, TreeView],
  templateUrl: './demo-treeview-10.html',
  styleUrl: './demo-treeview-10.css',
})
export class DemoTreeview10 {
  // Source of truth — we mutate this array in place. The tree reflects it.
  protected readonly _lanes: Lane[] = JSON.parse(JSON.stringify(INITIAL_LANES));

  readonly root = computed(() =>
    buildFromHierarchy<Lane | Task>(this._lanes, {
      childrenField: (node) =>
        'tasks' in node ? (node.tasks as readonly (Lane | Task)[]) : undefined,
      textField: (node) => ('tasks' in node ? node.name : node.title),
      idField: 'id',
      blockSize: 0,
      rootLabel: 'Sprint board',
      // Attach the lanes array to the synthetic root's `meta` so
      // `moveCollapse` can splice into it when the user reorders lanes.
      // `accessors.childrenField(this._lanes)` returns the array itself.
      rootMeta: this._lanes,
    }),
  );

  readonly accessors = accessors as SourceAccessors<unknown, unknown>;

  readonly moves = signal<MoveLog[]>([]);
  readonly totalMoves = computed(() => this.moves().length);

  onDropped(event: {
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }): void {
    const log: MoveLog = {
      source: labelOf(event.source),
      target: labelOf(event.target),
      position: event.position,
      kind:
        event.source.kind === 'row'
          ? event.target.kind === 'collapse'
            ? 'row→folder'
            : 'row→row'
          : 'folder→folder',
    };
    this.moves.update((cur) => [log, ...cur].slice(0, 12));
  }

  clearLog(): void {
    this.moves.set([]);
  }
}

function labelOf(node: RowNode | CollapseNode): string {
  return node.label();
}
