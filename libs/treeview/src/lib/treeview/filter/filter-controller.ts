import {
  computed,
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  Signal,
  untracked,
} from '@angular/core';
import { BlockNode, CollapseNode } from '../tree-model';
import {
  applyFilter,
  applyVisibilityToTree,
  FilterResult,
  FilterSettings,
} from './filter-engine';

export interface FilterControllerConfig {
  /** Reactive accessor for the search term. Empty string disables filtering. */
  readonly term: () => string;
  /** Reactive accessor for the operator/mode/ignoreCase settings. */
  readonly settings: () => FilterSettings;
  /** Tree root, walked by the filter engine. */
  readonly root: () => CollapseNode;
  /**
   * When `true`, filter matches that are descendants of collapsed Collapses
   * cause those ancestors to auto-expand. The controller emits the new key
   * set for the host to apply (via expandedKeys). Default: `true`.
   */
  readonly autoExpandMatches?: () => boolean;
  /**
   * Optional callback invoked when filter wants to expand ancestors of
   * matches. Caller wires this into ExpandController.expand() per node.
   */
  readonly onAutoExpand?: (nodes: ReadonlyArray<CollapseNode>) => void;
}

const EMPTY_RESULT: FilterResult = {
  visibleIds: new Set<string>(),
  matchedIds: new Set<string>(),
};

/**
 * Reactive filter pipeline. The result is a `computed` signal — recomputes
 * only when term / settings / root change. An `effect` then writes back to
 * each node's `visible` signal (and, when configured, expands ancestors of
 * matches so users can see them).
 *
 * The controller owns the side effect; nothing else should write to
 * `node.visible`. Passing an empty term clears all visibility flags.
 */
@Injectable()
export class FilterController {
  private readonly injector = inject(Injector);
  private cfg: FilterControllerConfig | null = null;

  private resultSig: Signal<FilterResult> | null = null;

  configure(cfg: FilterControllerConfig): void {
    this.cfg = cfg;
    this.resultSig = computed<FilterResult>(() => {
      const term = cfg.term();
      if (term === '') return EMPTY_RESULT;
      return applyFilter(cfg.root(), term, cfg.settings());
    });

    runInInjectionContext(this.injector, () => {
      // Side effect: apply the precomputed visibility back to the tree, and
      // optionally expand collapsed ancestors so matches are reachable.
      effect(() => {
        const result = this.resultSig?.();
        const root = cfg.root();
        if (result === undefined) return;
        const isClearing = cfg.term() === '';
        untracked(() => {
          applyVisibilityToTree(root, isClearing ? null : result);
          if (
            !isClearing &&
            (cfg.autoExpandMatches?.() ?? true) &&
            cfg.onAutoExpand
          ) {
            const ancestors = collectCollapsedAncestors(root, result.matchedIds);
            if (ancestors.length > 0) cfg.onAutoExpand(ancestors);
          }
        });
      });
    });
  }

  /** Reactive: true when a non-empty term is currently active. */
  isActive(): boolean {
    return this.cfg !== null && this.cfg.term() !== '';
  }

  /** Reactive: result of the last filter pass. */
  result(): FilterResult {
    return this.resultSig?.() ?? EMPTY_RESULT;
  }

  matchCount(): number {
    return this.result().matchedIds.size;
  }

  visibleCount(): number {
    return this.result().visibleIds.size;
  }

  isMatched(id: string): boolean {
    return this.result().matchedIds.has(id);
  }
}

/**
 * Walk the tree and collect every collapsed CollapseNode that has at least
 * one matched descendant (so the host can expand them in one batch).
 */
function collectCollapsedAncestors(
  root: CollapseNode,
  matchedIds: ReadonlySet<string>,
): CollapseNode[] {
  const out: CollapseNode[] = [];
  if (matchedIds.size === 0) return out;
  walk(root);
  return out;

  function walk(node: CollapseNode): boolean {
    let descendantMatched = matchedIds.has(node.id);
    for (const child of node.children()) {
      if (child.kind === 'collapse') {
        if (walk(child)) descendantMatched = true;
      } else {
        // block: recursively check rows (handles nested block trees)
        if (blockHasMatch(child, matchedIds)) descendantMatched = true;
      }
    }
    if (descendantMatched && node.collapsed()) out.push(node);
    return descendantMatched;
  }
}

function blockHasMatch(
  block: BlockNode,
  matchedIds: ReadonlySet<string>,
): boolean {
  for (const c of block.children()) {
    if (c.kind === 'row') {
      if (matchedIds.has(c.id)) return true;
    } else if (c.kind === 'block' && blockHasMatch(c, matchedIds)) {
      return true;
    }
    // Collapse children embedded in a block aren't part of its row run —
    // their own filter state propagates through their `invisible` mask.
  }
  return false;
}
