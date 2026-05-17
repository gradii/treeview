import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  Signal,
  signal,
  untracked,
} from '@angular/core';
import { from, map } from 'rxjs';
import {
  buildFromHierarchy,
  chunkRows,
  CollapseChild,
  CollapseNode,
  LoadMoreNode,
  RowNode,
  TreeView,
} from '@gradii/treeview';

interface Repo {
  id: string;
  name: string;
  stars: number;
}

interface Org {
  id: string;
  name: string;
  repos: Repo[];
}

function syntheticOrgs(count: number, reposPerOrg: number): Org[] {
  const out: Org[] = [];
  for (let o = 0; o < count; o++) {
    const repos: Repo[] = [];
    for (let r = 0; r < reposPerOrg; r++) {
      repos.push({
        id: `org-${o}/repo-${r}`,
        name: `repo-${String(r).padStart(3, '0')}`,
        stars: ((o + 1) * 31 + r * 7) % 4096,
      });
    }
    out.push({
      id: `org-${o}`,
      name: `org-${String(o).padStart(2, '0')}`,
      repos,
    });
  }
  return out;
}

const CLIENT_DATA: Org[] = syntheticOrgs(40, 80);

const REMOTE_LATENCY_MS = 450;
const REMOTE_TOTAL_LOGS = 1200;
const REMOTE_PAGE_SIZE = 40;
let remoteLoadCounter = 0;

/**
 * Simulate a paginated remote endpoint: returns a slice of synthetic log
 * entries after a short delay. The counter is global so callers can observe
 * how many requests they triggered.
 */
function fetchLogPage(skip: number, take: number): Promise<RowNode[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      remoteLoadCounter++;
      const rows: RowNode[] = [];
      for (let i = 0; i < take; i++) {
        const idx = skip + i;
        if (idx >= REMOTE_TOTAL_LOGS) break;
        rows.push(
          new RowNode({
            id: `log/${idx}`,
            label: `log #${String(idx).padStart(4, '0')} · req=${remoteLoadCounter}`,
          }),
        );
      }
      resolve(rows);
    }, REMOTE_LATENCY_MS);
  });
}

interface RemoteBundle {
  readonly root: CollapseNode;
  readonly rowsLoaded: Signal<number>;
}

function buildRemoteBundle(): RemoteBundle {
  const root = new CollapseNode({
    id: 'logs',
    label: `Application logs (remote, ${REMOTE_TOTAL_LOGS} total)`,
  });
  // Track the row-level offset ourselves. The framework's `skip` in
  // `LoadMoreRequestArgs` counts *direct children* of the CollapseNode
  // (Blocks, in our case — each holding 20 rows), so it grows by 2 per
  // page rather than by `pageSize` rows. Using it as the row offset
  // would re-fetch overlapping ranges and create duplicate ids. Using a
  // signal also lets the UI display row-accurate gradii without
  // walking the tree.
  const rowsLoaded = signal(0);
  root.setLoadMore(
    new LoadMoreNode({
      id: 'logs:loadmore',
      label: 'Fetch next page',
      pageSize: REMOTE_PAGE_SIZE,
      // No `totalCount` declared — the server tells us when to stop via
      // `hasMore` on each page. The trailer keeps showing as long as the
      // response says more is available.
      loadFn: ({ take }) => {
        const skip = rowsLoaded();
        return from(fetchLogPage(skip, take)).pipe(
          map((rows) => {
            rowsLoaded.update((n) => n + rows.length);
            return {
              // CollapseNode children are Block|Collapse — wrap fetched rows
              // in Blocks of 20 each so they nest properly into the tree.
              children: chunkRows(
                rows,
                20,
                `logs:loaded:${skip}`,
              ) as CollapseChild[],
              hasMore: rowsLoaded() < REMOTE_TOTAL_LOGS,
            };
          }),
        );
      },
    }),
  );
  return { root, rowsLoaded };
}

@Component({
  selector: 'app-demo-treeview-3',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-3.html',
  styleUrl: './demo-treeview-3.css',
})
export class DemoTreeview3 {
  private readonly injector = inject(Injector);
  readonly clientPageSize = signal(15);

  readonly clientRoot = computed<CollapseNode>(() =>
    buildFromHierarchy<Org | Repo>(CLIENT_DATA, {
      childrenField: (item) => ('repos' in item ? (item as Org).repos : null),
      textField: (item) =>
        'repos' in item ? item.name : `${item.name} (★${item.stars})`,
      idField: 'id',
      pageSize: this.clientPageSize(),
      blockSize: 25,
      rootLabel: `GitHub orgs (${CLIENT_DATA.length} total)`,
    }),
  );

  private readonly remoteBundle = signal<RemoteBundle>(buildRemoteBundle());
  readonly remoteRoot = computed(() => this.remoteBundle().root);
  readonly remoteLoaded = computed(() => this.remoteBundle().rowsLoaded());

  setClientPageSize(n: number): void {
    this.clientPageSize.set(n);
  }

  resetRemote(): void {
    this.remoteBundle.set(buildRemoteBundle());
  }

  loadAllRemote(): void {
    // Drain the trailer reactively: each batch's `rowsLoaded` change reruns
    // the effect, which fires the next page until `loadMore()` returns null.
    const ref = effect(
      () => {
        const lm = this.remoteRoot().loadMore();
        if (lm === null) {
          untracked(() => ref.destroy());
          return;
        }
        this.remoteBundle().rowsLoaded(); // track gradii
        untracked(() => {
          if (lm.loadState() !== 'loading') lm.load();
        });
      },
      { injector: this.injector },
    );
  }
}
