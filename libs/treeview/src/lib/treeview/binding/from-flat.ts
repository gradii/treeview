import { Key } from '../state/keys';
import { CollapseNode } from '../tree-model';
import {
  buildFromHierarchy,
  FieldOrFn,
  FromHierarchyOptions,
  read,
} from './from-hierarchy';

export interface FromFlatOptions<T>
  extends Omit<FromHierarchyOptions<T>, 'childrenField' | 'idField'> {
  /** Stable identity for each item. Required (used to index parent → children). */
  readonly idField: FieldOrFn<T, Key>;
  /**
   * Per-item accessor for the parent ID. Items where this is null / undefined
   * become top-level roots; items whose parent ID has no matching `idField` in
   * the input are silently dropped as orphans.
   */
  readonly parentIdField: FieldOrFn<T, Key | null | undefined>;
}

/**
 * Build a TreeView model from a flat list joined by parent ID. Indexes
 * children by parent in one pass then delegates to `buildFromHierarchy` via a
 * synthetic children accessor — so chunking, idField, hasChildren, textField,
 * and rootLabel all behave identically.
 */
export function buildFromFlat<T>(
  items: readonly T[],
  opts: FromFlatOptions<T>,
): CollapseNode {
  const { idField, parentIdField, hasChildren, ...rest } = opts;

  const childrenByParent = new Map<Key | null, T[]>();
  const idOf = (item: T): Key => read(item, idField);

  for (const item of items) {
    const parent = read(item, parentIdField);
    const key: Key | null =
      parent === undefined || parent === null ? null : parent;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(item);
    else childrenByParent.set(key, [item]);
  }

  const roots = childrenByParent.get(null) ?? [];

  return buildFromHierarchy(roots, {
    ...rest,
    idField,
    childrenField: (item: T) => childrenByParent.get(idOf(item)) ?? null,
    hasChildren:
      hasChildren ??
      ((item: T) => (childrenByParent.get(idOf(item))?.length ?? 0) > 0),
  });
}
