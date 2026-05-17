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

interface Project {
  id: string;
  name: string;
  tasks: Task[];
}

interface Workspace {
  id: string;
  name: string;
  projects: Project[];
}

type FsNode = Workspace | Project | Task;

const TEAM_A: Workspace[] = [
  {
    id: 'a/q1',
    name: 'Q1 Roadmap',
    projects: [
      {
        id: 'a/q1/fe',
        name: 'Frontend',
        tasks: [
          { id: 'a/q1/fe/1', title: 'Wire up sticky scroll' },
          { id: 'a/q1/fe/2', title: 'Aria activedescendant' },
          { id: 'a/q1/fe/3', title: 'Cache row heights' },
        ],
      },
      {
        id: 'a/q1/be',
        name: 'Backend',
        tasks: [
          { id: 'a/q1/be/1', title: 'Cache invalidation' },
          { id: 'a/q1/be/2', title: 'Auth middleware' },
        ],
      },
    ],
  },
  {
    id: 'a/personal',
    name: 'Personal',
    projects: [
      {
        id: 'a/personal/notes',
        name: 'Notes',
        tasks: [
          { id: 'a/personal/notes/1', title: 'Read paper · KSP' },
          { id: 'a/personal/notes/2', title: 'Write blog · signals' },
        ],
      },
    ],
  },
];

const TEAM_B: Workspace[] = [
  {
    id: 'b/q1',
    name: 'Q1 Roadmap',
    projects: [
      {
        id: 'b/q1/mobile',
        name: 'Mobile',
        tasks: [
          { id: 'b/q1/mobile/1', title: 'iOS push regression' },
          { id: 'b/q1/mobile/2', title: 'Android crash on boot' },
        ],
      },
    ],
  },
  {
    id: 'b/research',
    name: 'Research',
    projects: [
      {
        id: 'b/research/spike',
        name: 'Spike',
        tasks: [
          { id: 'b/research/spike/1', title: 'Benchmark virtual scroll' },
          { id: 'b/research/spike/2', title: 'Compare DnD libs' },
        ],
      },
    ],
  },
];

// Polymorphic accessor — works at all three levels:
// - Workspace[]  → the array (root's children are workspaces)
// - Workspace    → workspace.projects
// - Project      → project.tasks
// - Task         → undefined (leaf)
const accessors: SourceAccessors<Workspace[] | Workspace | Project, FsNode> = {
  childrenField: (parent) =>
    Array.isArray(parent)
      ? parent
      : 'projects' in parent
        ? parent.projects
        : 'tasks' in parent
          ? parent.tasks
          : undefined,
};

interface MoveLog {
  receiver: 'A' | 'B';
  kind: 'workspace' | 'project' | 'task';
  source: string;
  target: string;
  position: 'before' | 'over' | 'after';
}

@Component({
  selector: 'app-demo-treeview-12',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPipe, TreeView],
  templateUrl: './demo-treeview-12.html',
  styleUrl: './demo-treeview-12.css',
})
export class DemoTreeview12 {
  protected readonly teamA: Workspace[] = JSON.parse(JSON.stringify(TEAM_A));
  protected readonly teamB: Workspace[] = JSON.parse(JSON.stringify(TEAM_B));

  readonly leftRoot = computed(() => buildWorkspaceRoot(this.teamA, 'Team A'));
  readonly rightRoot = computed(() => buildWorkspaceRoot(this.teamB, 'Team B'));

  readonly accessors = accessors as SourceAccessors<unknown, unknown>;

  readonly moves = signal<MoveLog[]>([]);

  onLeftDropped(e: {
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }): void {
    this.recordMove('A', e);
  }

  onRightDropped(e: {
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }): void {
    this.recordMove('B', e);
  }

  clearLog(): void {
    this.moves.set([]);
  }

  private recordMove(
    receiver: 'A' | 'B',
    e: {
      source: RowNode | CollapseNode;
      target: RowNode | CollapseNode;
      position: 'before' | 'over' | 'after';
    },
  ): void {
    this.moves.update((cur) =>
      [
        {
          receiver,
          kind: classifyDragKind(e.source),
          source: e.source.label(),
          target: e.target.label(),
          position: e.position,
        },
        ...cur,
      ].slice(0, 14),
    );
  }
}

function buildWorkspaceRoot(
  workspaces: Workspace[],
  label: string,
): CollapseNode {
  return buildFromHierarchy<FsNode>(workspaces, {
    childrenField: (node) =>
      'projects' in node
        ? (node.projects as readonly FsNode[])
        : 'tasks' in node
          ? (node.tasks as readonly FsNode[])
          : undefined,
    textField: (node) => ('name' in node ? node.name : node.title),
    idField: 'id',
    blockSize: 0,
    rootLabel: label,
    rootMeta: workspaces,
  });
}

/**
 * Classify the dragged node by its position in the tree so the move log
 * carries level info (workspace / project / task). Workspaces are
 * Collapses whose first source-array entry is a Workspace; projects are
 * Collapses whose source has `tasks`; tasks are Rows.
 */
function classifyDragKind(
  source: RowNode | CollapseNode,
): 'workspace' | 'project' | 'task' {
  if (source.kind === 'row') return 'task';
  const meta = source.meta as Workspace | Project | undefined;
  if (meta !== undefined && 'projects' in meta) return 'workspace';
  return 'project';
}
