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

interface Card {
  id: string;
  title: string;
}

interface Bucket {
  id: string;
  name: string;
  cards: Card[];
}

const BACKLOG: Bucket = {
  id: 'backlog',
  name: 'Backlog',
  cards: [
    { id: 'b/1', title: 'Investigate sticky drift' },
    { id: 'b/2', title: 'Audit ARIA labels' },
    { id: 'b/3', title: 'Restore scroll on rebuild' },
    { id: 'b/4', title: 'Profile recursive chunking' },
    { id: 'b/5', title: 'Animated reveal for filter clear' },
    { id: 'b/6', title: 'Skeleton variants' },
  ],
};

const SPRINT: Bucket = {
  id: 'sprint',
  name: 'Current sprint',
  cards: [
    { id: 's/1', title: 'Cross-tree DnD' },
    { id: 's/2', title: 'Escape cancels' },
    { id: 's/3', title: 'Drag-handle option' },
  ],
};

const accessors: SourceAccessors<Bucket, Card> = {
  childrenField: (bucket) => bucket.cards,
};

@Component({
  selector: 'app-demo-treeview-11',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPipe, TreeView],
  templateUrl: './demo-treeview-11.html',
  styleUrl: './demo-treeview-11.css',
})
export class DemoTreeview11 {
  // Mutable source — both trees share these references; drops mutate them.
  protected readonly backlog: Bucket = JSON.parse(JSON.stringify(BACKLOG));
  protected readonly sprint: Bucket = JSON.parse(JSON.stringify(SPRINT));

  readonly leftRoot = computed(() => buildBucketRoot(this.backlog));
  readonly rightRoot = computed(() => buildBucketRoot(this.sprint));

  readonly accessors = accessors as SourceAccessors<unknown, unknown>;

  readonly moves = signal<string[]>([]);
  readonly useHandle = signal(false);

  private _logMove(
    receiver: 'Backlog' | 'Sprint',
    e: {
      source: RowNode | CollapseNode;
      target: RowNode | CollapseNode;
      position: 'before' | 'over' | 'after';
    },
  ): void {
    const kind = e.target.kind === 'collapse' ? '↳' : '↔';
    this.moves.update((cur) =>
      [
        `→ ${receiver} · ${kind} ${e.source.label()} ${e.position} ${e.target.label()}`,
        ...cur,
      ].slice(0, 12),
    );
  }

  onLeftDropped(e: {
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }): void {
    this._logMove('Backlog', e);
  }

  onRightDropped(e: {
    source: RowNode | CollapseNode;
    target: RowNode | CollapseNode;
    position: 'before' | 'over' | 'after';
  }): void {
    this._logMove('Sprint', e);
  }

  toggleHandle(): void {
    this.useHandle.update((v) => !v);
  }

  clearLog(): void {
    this.moves.set([]);
  }
}

function buildBucketRoot(bucket: Bucket) {
  return buildFromHierarchy<Bucket | Card>([bucket], {
    childrenField: (node) =>
      'cards' in node ? (node.cards as readonly (Bucket | Card)[]) : undefined,
    textField: (node) => ('cards' in node ? node.name : node.title),
    idField: 'id',
    blockSize: 0,
    rootLabel: bucket.name,
  });
}
