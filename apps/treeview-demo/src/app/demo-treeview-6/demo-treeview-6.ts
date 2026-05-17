import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { from } from 'rxjs';
import {
  CollapseChild,
  CollapseNode,
  lazyBlocks,
  RowNode,
  TreeView,
} from '@gradii/treeview';

interface Region {
  id: string;
  name: string;
  /** Total rows the region eventually exposes. */
  totalChildren: number;
}

const REGIONS: Region[] = [
  { id: 'us-east-1', name: 'us-east-1 · N. Virginia', totalChildren: 240 },
  { id: 'us-west-2', name: 'us-west-2 · Oregon', totalChildren: 180 },
  { id: 'eu-west-1', name: 'eu-west-1 · Ireland', totalChildren: 320 },
  { id: 'eu-central-1', name: 'eu-central-1 · Frankfurt', totalChildren: 95 },
  { id: 'ap-south-1', name: 'ap-south-1 · Mumbai', totalChildren: 410 },
  { id: 'ap-northeast-1', name: 'ap-northeast-1 · Tokyo', totalChildren: 280 },
  { id: 'sa-east-1', name: 'sa-east-1 · São Paulo', totalChildren: 60 },
];

const FETCH_LATENCY_MS = 900;
const BLOCK_SIZE = 20;
let requestCounter = 0;

/**
 * Simulate a paginated bucket endpoint. The counter is global so demo rows
 * carry a `req=N` suffix and you can verify how many requests have actually
 * been issued (vs how many blocks merely showed skeletons).
 */
function fetchRegionItems(
  regionId: string,
  skip: number,
  take: number,
): Promise<string[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      requestCounter++;
      const out: string[] = [];
      for (let i = 0; i < take; i++) {
        const idx = skip + i;
        out.push(
          `${regionId}/instance-${String(idx).padStart(4, '0')} · req=${requestCounter}`,
        );
      }
      resolve(out);
    }, FETCH_LATENCY_MS);
  });
}

@Component({
  selector: 'app-demo-treeview-6',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TreeView],
  templateUrl: './demo-treeview-6.html',
  styleUrl: './demo-treeview-6.css',
})
export class DemoTreeview6 {
  readonly root = computed<CollapseNode>(() => buildRoot());
  readonly hint = signal<string>(
    'Expand a region. Each region is sliced into 20-row blocks — only the blocks you actually land on after scroll-stabilization (~200ms) fire a load.',
  );
}

function buildRoot(): CollapseNode {
  const children: CollapseChild[] = REGIONS.map(buildRegion);
  return new CollapseNode({
    id: '__root',
    label: 'AWS regions (lazy, chunked)',
    depth: 0,
    collapsed: false,
    children,
  });
}

function buildRegion(region: Region): CollapseNode {
  const blocks = lazyBlocks<string>({
    idPrefix: `${region.id}:rows`,
    depth: 1,
    totalCount: region.totalChildren,
    blockSize: BLOCK_SIZE,
    loader: (skip, take) => from(fetchRegionItems(region.id, skip, take)),
    toRow: (label) => new RowNode({ id: label, label }),
  });
  return new CollapseNode({
    id: region.id,
    label: `${region.name} (${region.totalChildren} rows · ${blocks.length} blocks)`,
    depth: 1,
    // Start collapsed so users can observe lazy loading on expand.
    collapsed: true,
    children: blocks,
  });
}
