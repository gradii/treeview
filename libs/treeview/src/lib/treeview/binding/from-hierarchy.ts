import { of } from 'rxjs';
import { Key } from '../state/keys';
import {
  CollapseChild,
  CollapseNode,
  LoadMoreNode,
  RowNode,
} from '../tree-model';
import { chunkRowsRecursive } from './chunking';

/**
 * Either a string field name on `T` or an accessor function.
 *
 * The string form accepts dot paths (`'meta.label'`) for nested access — same
 * semantics as Kendo's `@progress/kendo-common` `getter`. Use the function
 * form when you want compile-time type safety.
 */
export type FieldOrFn<T, R> = string | ((item: T) => R);

export interface FromHierarchyOptions<T> {
  /** Per-item accessor for the child collection (string field or function). */
  readonly childrenField: FieldOrFn<T, readonly T[] | null | undefined>;
  /**
   * Label accessor. Pass an array to use a different field per data level:
   * `textField[i]` for items at data depth `i`; depths beyond the array reuse
   * the last entry (matches Kendo's behavior).
   */
  readonly textField:
    | FieldOrFn<T, string>
    | ReadonlyArray<FieldOrFn<T, string>>;
  /**
   * Stable identity for keyed state (selection / check / expand). Defaults to
   * a synthetic path-based ID — unstable across re-orderings.
   */
  readonly idField?: FieldOrFn<T, Key>;
  /**
   * Override the "is this a leaf?" check. Reserved for lazy-load scenarios
   * where children are not yet fetched but the node should still render as
   * a Collapse. Default: `children && children.length > 0`.
   */
  readonly hasChildren?: (item: T) => boolean;
  /** Max rows per Block (default 20). Set to 0 or negative to disable chunking. */
  readonly blockSize?: number;
  /**
   * Page size for client-side load-more. When `> 0`, each group with more than
   * `pageSize` children renders only the first `pageSize`, and a "Load more"
   * trailer reveals subsequent pages. `0` (default) disables paging.
   */
  readonly pageSize?: number;
  /** Label for the synthetic root when wrapping is needed (default ''). */
  readonly rootLabel?: string;
  /**
   * Payload attached to the synthetic root's `meta`. Provide this when you
   * want `source-mutation` helpers (`moveCollapse`, `moveRowAsChild`, ...) to
   * reach into a top-level container — typically pass the same array you
   * passed as `roots`, then have `childrenField` return it when called on the
   * array. Without this, top-level reordering silently fails because the
   * synthetic root has no resolvable source children. Has no effect when the
   * input is a single top-level item (in which case that item becomes the
   * root unwrapped and carries its own meta).
   */
  readonly rootMeta?: unknown;
}

/**
 * Build a TreeView model from nested data.
 *
 * - Each data item with children → CollapseNode
 * - Each leaf data item → RowNode, but rows always live inside a BlockNode —
 *   every consecutive leaf run is wrapped via `chunkRows`, so the parent
 *   CollapseNode only ever sees BlockNode / CollapseNode children.
 * - Single top-level Collapse root is returned unwrapped; multi-root or
 *   single-leaf-root inputs get a synthetic CollapseNode wrapper.
 */
export function buildFromHierarchy<T>(
  roots: readonly T[],
  opts: FromHierarchyOptions<T>,
): CollapseNode {
  const {
    childrenField,
    textField,
    idField,
    hasChildren,
    blockSize = 20,
    pageSize = 0,
    rootLabel = '',
    rootMeta,
  } = opts;

  const textFields: ReadonlyArray<FieldOrFn<T, string>> = Array.isArray(
    textField,
  )
    ? (textField as ReadonlyArray<FieldOrFn<T, string>>)
    : [textField as FieldOrFn<T, string>];

  let blockSeq = 0;
  let loadMoreSeq = 0;

  const labelFor = (item: T, dataDepth: number): string => {
    const idx = Math.min(dataDepth, textFields.length - 1);
    return String(read(item, textFields[idx]) ?? '');
  };

  const idFor = (item: T, fallback: string): string => {
    if (idField === undefined) return fallback;
    const k = read(item, idField);
    return k !== undefined && k !== null ? String(k) : fallback;
  };

  const buildItem = (
    item: T,
    dataDepth: number,
    nodeDepth: number,
    pathId: string,
  ): RowNode | CollapseNode => {
    const id = idFor(item, `__tv:item:${pathId}`);
    const label = labelFor(item, dataDepth);
    const rawChildren = read(item, childrenField);
    const childArray =
      rawChildren && rawChildren.length > 0 ? rawChildren : null;
    const isLeaf = hasChildren ? !hasChildren(item) : childArray === null;

    if (isLeaf) {
      return new RowNode({ id, label, meta: item });
    }

    let children: CollapseChild[] = [];
    let loadMore: LoadMoreNode | null = null;
    if (childArray) {
      const split = splitForPaging(childArray, pageSize);
      children = buildChildren(split.visible, dataDepth + 1, nodeDepth + 1, id);
      if (split.remaining.length > 0) {
        loadMore = buildPagedLoadMore({
          parentId: id,
          remaining: split.remaining,
          dataDepth: dataDepth + 1,
          nodeDepth: nodeDepth + 1,
          initialLoaded: split.visible.length,
        });
      }
    }
    return new CollapseNode({
      id,
      label,
      depth: nodeDepth,
      children,
      loadMore,
      meta: item,
    });
  };

  const buildChildren = (
    items: readonly T[],
    dataDepth: number,
    nodeDepth: number,
    parentId: string,
  ): CollapseChild[] => {
    const out: CollapseChild[] = [];
    let leafRun: RowNode[] = [];

    const flushRun = () => {
      if (leafRun.length === 0) return;
      out.push(
        ...chunkRowsRecursive(
          leafRun,
          blockSize,
          `__tv:block:${parentId}:${blockSeq++}`,
          nodeDepth,
        ),
      );
      leafRun = [];
    };

    items.forEach((item, i) => {
      const node = buildItem(item, dataDepth, nodeDepth, `${parentId}/${i}`);
      if (node.kind === 'row') {
        leafRun.push(node);
      } else {
        flushRun();
        out.push(node);
      }
    });
    flushRun();
    return out;
  };

  /**
   * Build a LoadMoreNode whose loadFn slices the captured `remaining` array.
   * The closure freezes the slice for client-side paging — no remote calls.
   */
  const buildPagedLoadMore = (args: {
    parentId: string;
    remaining: readonly T[];
    dataDepth: number;
    nodeDepth: number;
    initialLoaded: number;
  }): LoadMoreNode => {
    const { parentId, remaining, dataDepth, nodeDepth, initialLoaded } = args;
    let consumed = 0;
    const size = pageSize > 0 ? pageSize : remaining.length;
    return new LoadMoreNode({
      id: `__tv:loadmore:${parentId}:${loadMoreSeq++}`,
      pageSize: size,
      totalCount: initialLoaded + remaining.length,
      loadedCount: initialLoaded,
      loadFn: ({ take }) => {
        const next = remaining.slice(consumed, consumed + take);
        consumed += next.length;
        // Re-enter buildChildren so newly revealed items pick up the same
        // chunking + nested paging behavior as their already-visible peers.
        return of(buildChildren(next, dataDepth, nodeDepth, parentId));
      },
    });
  };

  if (roots.length === 1) {
    const only = buildItem(roots[0], 0, 0, 'root');
    if (only.kind === 'collapse') return only;
  }

  const split = splitForPaging(roots, pageSize);
  const rootLoadMore =
    split.remaining.length > 0
      ? buildPagedLoadMore({
          parentId: '__root',
          remaining: split.remaining,
          dataDepth: 0,
          nodeDepth: 1,
          initialLoaded: split.visible.length,
        })
      : null;
  return new CollapseNode({
    id: '__tv:root',
    label: rootLabel,
    depth: 0,
    children: buildChildren(split.visible, 0, 1, '__root'),
    loadMore: rootLoadMore,
    meta: rootMeta,
  });
}

interface PageSplit<T> {
  visible: readonly T[];
  remaining: readonly T[];
}

function splitForPaging<T>(items: readonly T[], pageSize: number): PageSplit<T> {
  if (pageSize <= 0 || items.length <= pageSize) {
    return { visible: items, remaining: [] };
  }
  return {
    visible: items.slice(0, pageSize),
    remaining: items.slice(pageSize),
  };
}

/** @internal Resolve a `FieldOrFn` against a data item. Supports dot paths. */
export function read<T, R>(item: T, field: FieldOrFn<T, R>): R {
  if (typeof field === 'function') return field(item);
  let cur: unknown = item;
  for (const key of field.split('.')) {
    if (cur === null || cur === undefined) return cur as R;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as R;
}
