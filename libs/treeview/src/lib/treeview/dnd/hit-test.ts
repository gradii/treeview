import { CollapseNode, RowNode } from '../tree-model';

export type DropPosition = 'before' | 'over' | 'after';

export type DropTargetNode = RowNode | CollapseNode;

export interface DropTarget {
  /** Node under the cursor — either a row leaf or a collapse header. */
  readonly node: DropTargetNode;
  /**
   * Drop position relative to the target:
   * - rows: `before` / `after` (2-band split, halfway through the row)
   * - collapses: `before` / `over` / `after` (3-band split — top 25% is
   *   `before`, bottom 25% is `after`, the middle 50% is `over`)
   */
  readonly position: DropPosition;
  /** DOM element of the hit row — used by DropHint to position itself. */
  readonly element: HTMLElement;
}

/**
 * Resolve a pointer position to a drop target — either a row (before/after)
 * or a collapse header (before/over/after). Uses `elementFromPoint` to find
 * the closest treeitem under the cursor; the `instancePrefix` (handed out
 * by `TreeViewIdService`) is used to filter for rows belonging to **this**
 * LargeTreeView when multiple TreeViews coexist.
 *
 * Returns `null` when the pointer is over empty space, over the source
 * node itself, over a descendant of the source (would create a cycle), or
 * over a LoadMore trailer (not a valid drop target).
 */
export function hitTestRow(args: {
  clientX: number;
  clientY: number;
  source: RowNode | CollapseNode;
  instancePrefix: string;
  resolveNode: (domId: string) => DropTargetNode | null;
}): DropTarget | null {
  const { clientX, clientY, source, instancePrefix, resolveNode } = args;
  const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (hit === null) return null;
  const targetEl = hit.closest<HTMLElement>(`[id^="${instancePrefix}-item-"]`);
  if (targetEl === null) return null;
  const id = targetEl.id.slice(`${instancePrefix}-item-`.length);
  const targetNode = resolveNode(id);
  if (targetNode === null) return null;
  if (targetNode === source) return null;
  if (source.kind === 'collapse' && isDescendantOf(targetNode, source)) {
    // Can't drop a folder into its own subtree.
    return null;
  }

  const rect = targetEl.getBoundingClientRect();
  let position: DropPosition;
  if (targetNode.kind === 'collapse') {
    // 3-band split for collapses so sibling reordering stays accessible:
    // top 25% = `before`, bottom 25% = `after`, the middle 50% = `over`
    // (drop into the folder).
    const local = clientY - rect.top;
    if (local < rect.height * 0.25) position = 'before';
    else if (local > rect.height * 0.75) position = 'after';
    else position = 'over';
  } else {
    const local = clientY - rect.top;
    position = local < rect.height / 2 ? 'before' : 'after';
  }
  return { node: targetNode, position, element: targetEl };
}

/** True iff `candidate` lives anywhere inside `ancestor`'s subtree. */
function isDescendantOf(candidate: DropTargetNode, ancestor: CollapseNode): boolean {
  let cur: typeof candidate.parent = candidate.parent;
  while (cur !== null) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

