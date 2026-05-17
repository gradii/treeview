import { inject, Injectable } from '@angular/core';

/**
 * Root-scoped counter that hands out process-unique `tv0`, `tv1`, …
 * prefixes to each LargeTreeView instance. Pure side-effect-free dispenser —
 * doesn't hold any per-instance state itself.
 *
 * Replace via the standard Angular provider override when test isolation
 * needs deterministic ids.
 */
@Injectable({ providedIn: 'root' })
export class TreeViewIdGenerator {
  private next = 0;

  nextInstanceId(): string {
    return `tv${this.next++}`;
  }
}

/**
 * Per-LargeTreeView identity holder. Provided once in the LargeTreeView
 * component's `providers`, every descendant (Row / Collapse / LoadMore /
 * NavigationController / DropHint / hit-test caller) injects this to learn
 * its tree's unique DOM-id prefix and to compose row ids.
 *
 * Why a separate per-instance class? The prefix is shared infrastructure —
 * it doesn't belong to any one feature (navigation, dnd, a11y all need it).
 * Centralising it here keeps NavigationController focused on keyboard nav
 * and lets DnD reach the prefix without going through navigation.
 */
@Injectable()
export class TreeViewInstance {
  /** Process-unique prefix (e.g. `tv0`) used to namespace DOM ids. */
  readonly prefix = inject(TreeViewIdGenerator).nextInstanceId();

  /**
   * DOM id for `nodeId` in this tree — `<instancePrefix>-item-<nodeId>`.
   * Used for `aria-activedescendant`, dnd hit-test queries, and any other
   * "find this row in the DOM" lookup.
   */
  domIdFor(nodeId: string): string {
    return `${this.prefix}-item-${nodeId}`;
  }
}
