import {
  CollapseNode,
  HIDE_FILTER,
  RowNode,
  TreeNode,
} from '../tree-model';

export type FilterOperator =
  | 'contains'
  | 'startswith'
  | 'endswith'
  | 'equals'
  | FilterMatcherFn;

export type FilterMatcherFn = (label: string, term: string) => boolean;

export type FilterMode = 'lenient' | 'strict';

export interface FilterSettings {
  /**
   * Matching strategy. Strings are case-insensitive when `ignoreCase` is on.
   * Pass a custom function to opt out of the built-in operators entirely.
   * Default: `'contains'`.
   */
  readonly operator?: FilterOperator;
  /** Lower-case both sides before comparing (built-in operators only). Default: `true`. */
  readonly ignoreCase?: boolean;
  /**
   * - `'lenient'` (default): matches show up with all their ancestors **and**
   *   all their descendants.
   * - `'strict'`: matches show up with their ancestors only — descendants stay
   *   hidden unless they match independently.
   */
  readonly mode?: FilterMode;
}

const DEFAULTS: Required<Omit<FilterSettings, 'operator'>> & {
  operator: FilterOperator;
} = {
  operator: 'contains',
  ignoreCase: true,
  mode: 'lenient',
};

export interface FilterResult {
  /** Keys of every node that should remain visible. */
  readonly visibleIds: ReadonlySet<string>;
  /** Keys of nodes that matched the term directly (subset of `visibleIds`). */
  readonly matchedIds: ReadonlySet<string>;
}

/**
 * Walk the tree once and decide which nodes stay visible.
 *
 * Empty terms short-circuit to "everything visible / nothing matched" — the
 * caller is expected to skip applying altogether in that case, but we return a
 * sensible result for symmetry.
 *
 * Strict mode: only matches + their ancestor chain are visible.
 * Lenient mode: also reveal every descendant of a matched node, even if the
 * descendant doesn't independently match — handy for "expand into folders
 * whose name hits the query".
 *
 * Block nodes are transparent: they don't carry a label and never match on
 * their own. They're added to `visibleIds` iff any of their child rows are
 * visible — keeps `BlockNode.height()` nonzero when virtualization needs to render.
 */
export function applyFilter(
  root: CollapseNode,
  term: string,
  settings: FilterSettings = {},
): FilterResult {
  const opts: Required<Omit<FilterSettings, 'operator'>> & {
    operator: FilterOperator;
  } = { ...DEFAULTS, ...settings };

  const matchedIds = new Set<string>();
  const visibleIds = new Set<string>();

  if (term === '') {
    return { visibleIds, matchedIds };
  }

  const matcher = compileMatcher(opts.operator, opts.ignoreCase);
  const normalizedTerm = opts.ignoreCase ? term.toLowerCase() : term;

  // First pass: tag matches + propagate visibility from matched node outward.
  visit(root, false);

  return { visibleIds, matchedIds };

  /**
   * Returns `true` when the node (or any descendant) matched. The boolean is
   * used to bubble visibility back up the ancestor chain.
   *
   * `forceVisible` is set when an ancestor matched in lenient mode — every
   * node in the subtree then becomes visible regardless of its own label.
   */
  function visit(node: TreeNode, forceVisible: boolean): boolean {
    if (node.kind === 'loadmore') {
      // LoadMore is a UI affordance, never a search target. It's visible iff
      // its parent ends up visible (handled by the parent's own decision).
      return false;
    }

    if (node.kind === 'block') {
      let anyChildVisible = false;
      for (const child of node.children()) {
        if (visit(child, forceVisible)) anyChildVisible = true;
      }
      if (anyChildVisible) visibleIds.add(node.id);
      return anyChildVisible;
    }

    if (node.kind === 'row') {
      const isMatch = matchLabel(node, matcher, normalizedTerm, opts.ignoreCase);
      if (isMatch) matchedIds.add(node.id);
      if (isMatch || forceVisible) {
        visibleIds.add(node.id);
        return true;
      }
      return false;
    }

    // collapse
    const isMatch = matchLabel(node, matcher, normalizedTerm, opts.ignoreCase);
    if (isMatch) matchedIds.add(node.id);
    const descendantsForce = forceVisible || (isMatch && opts.mode === 'lenient');
    let descendantHit = false;
    for (const child of node.children()) {
      if (visit(child, descendantsForce)) descendantHit = true;
    }
    if (isMatch || descendantHit || forceVisible) {
      visibleIds.add(node.id);
      return true;
    }
    return false;
  }
}

function matchLabel(
  node: RowNode | CollapseNode,
  matcher: FilterMatcherFn,
  normalizedTerm: string,
  ignoreCase: boolean,
): boolean {
  const raw = node.label();
  const label = ignoreCase ? raw.toLowerCase() : raw;
  return matcher(label, normalizedTerm);
}

function compileMatcher(
  op: FilterOperator,
  ignoreCase: boolean,
): FilterMatcherFn {
  if (typeof op === 'function') {
    // Custom matcher: call with original-case inputs so the consumer can do
    // whatever they want (regex, fuzzy, etc.). We pass our internally
    // lower-cased label only when ignoreCase is on — the consumer chose.
    return ignoreCase
      ? op
      : (label, term) => op(label, term);
  }
  switch (op) {
    case 'startswith':
      return (l, t) => l.startsWith(t);
    case 'endswith':
      return (l, t) => l.endsWith(t);
    case 'equals':
      return (l, t) => l === t;
    case 'contains':
    default:
      return (l, t) => l.includes(t);
  }
}

/**
 * Convenience: apply a precomputed `FilterResult` to the tree by flipping the
 * `HIDE_FILTER` bit in each node's `invisible` mask. Pass `null` to clear
 * (every node's filter-hide bit goes to 0 — other hide reasons like
 * `HIDE_USER` or `HIDE_PARENT_COLLAPSED` are left alone).
 *
 * Walks every node — O(N) — but only writes when the bit actually flips, so
 * downstream `computed`s only re-fire for nodes whose visibility changed.
 */
export function applyVisibilityToTree(
  root: CollapseNode,
  result: FilterResult | null,
): void {
  const visibleIds = result?.visibleIds ?? null;
  walk(root);

  function walk(node: TreeNode): void {
    if (node.kind === 'loadmore') return;
    if (node.kind === 'row' || node.kind === 'collapse') {
      const shouldHide = visibleIds !== null && !visibleIds.has(node.id);
      const cur = node.invisible();
      const next = shouldHide ? cur | HIDE_FILTER : cur & ~HIDE_FILTER;
      if (cur !== next) node.invisible.set(next);
    }
    // Block has no `invisible` signal — its visibility is implicit via the
    // sum of its row children's renderSize. We still recurse so each row gets
    // its flag set; the Block-level entry in `visibleIds` exists for callers
    // who want to query block visibility but is intentionally not written back.
    if (node.kind === 'row') return;
    for (const child of node.children()) walk(child);
  }
}
