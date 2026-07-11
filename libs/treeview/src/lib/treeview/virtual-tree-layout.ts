import { CollapseNode } from './tree-model';

/**
 * Finds the chain of Collapse ancestors that should currently be sticky.
 *
 * The transition is anchored to the **visual stack** the overlay actually
 * renders: a candidate enters slot K when its canvas top reaches the Kth
 * slot's top edge. Each slot uses the candidate's own `headerSize()`, so
 * different sticky items can have different heights and free-scrolling keeps
 * each sticky row aligned with its corresponding canvas row.
 *
 * Sibling transitions are seamless: the previous candidate leaves slot K at
 * the same scrollTop at which its successor enters, because
 * `prev.canvasBottom === next.canvasTop`. There is no dead zone.
 *
 * `marginTop` is the viewport y-offset of the first slot's top edge.
 *
 * Only CollapseNodes carry headers — Block and Row children contribute to the
 * vertical cursor but are not part of the sticky chain.
 */
export function collectStickyAncestors(
  root: CollapseNode,
  scrollTop: number,
  marginTop: number,
): CollapseNode[] {
  const path: CollapseNode[] = [];
  let cur: CollapseNode | null = root;
  let offset = 0;
  let stickyHeightSoFar = 0;

  while (cur) {
    const slotTop = scrollTop + marginTop + stickyHeightSoFar;
    const N = cur.headerSize();
    const bottom = offset + cur.height();

    if (offset <= slotTop && bottom > slotTop) {
      path.push(cur);
      stickyHeightSoFar += N;
    } else {
      break;
    }

    if (cur.collapsed()) break;

    const nextSlotTop = scrollTop + marginTop + stickyHeightSoFar;
    let next: CollapseNode | null = null;
    let cursor = offset + N;
    for (const child of cur.children()) {
      // CollapseChild is now BlockNode | CollapseNode — both expose `height()`.
      const h = child.height();
      const childBot = cursor + h;
      if (
        child.kind === 'collapse' &&
        cursor <= nextSlotTop &&
        childBot > nextSlotTop
      ) {
        next = child;
        offset = cursor;
        break;
      }
      cursor = childBot;
    }
    // The loadMore trailer never carries a sticky header — it just contributes
    // to the vertical cursor for siblings below (there are none here).
    cur = next;
  }
  return path;
}
