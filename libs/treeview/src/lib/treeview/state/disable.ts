import { Injectable } from '@angular/core';
import { CollapseNode, TreeNode } from '../tree-model';
import { defaultKeyFn, Key, KeyFn } from './keys';

export interface DisableControllerConfig {
  readonly keyFn: () => KeyFn | undefined;
  readonly disabledKeys: () => ReadonlySet<Key>;
  /**
   * `true` → only nodes whose key is explicitly in `disabledKeys` are disabled;
   * descendants of disabled parents stay interactive. Default `false`
   * (cascading: disabling a folder disables every descendant).
   */
  readonly disableParentNodesOnly: () => boolean;
  /**
   * `true` → disabled CollapseNodes can still toggle their expanded state
   * (keyboard ←/→ or click still works), useful when the disabled state
   * means "no selection/check" but not "frozen visibility". Default `false`.
   */
  readonly expandDisabledNodes: () => boolean;
  readonly root: () => CollapseNode;
}

/**
 * Tri-state disable semantics shared across Selection / Check / Expand:
 *
 * - `isDisabled(node)` — true when `node`'s key is in `disabledKeys`, or
 *   (in cascading mode) when any CollapseNode ancestor is disabled.
 * - `isInteractive(node)` — convenience inverse for selection / check.
 * - `canToggleExpand(node)` — same as `isInteractive` unless
 *   `expandDisabledNodes` is on, in which case disabled Collapses can still
 *   toggle.
 *
 * Reactivity: `disabledKeys()` is read each call, so consumers calling
 * `isDisabled` inside their own `computed` blocks track changes naturally —
 * flipping a key in the input set re-evaluates everything keyed off it.
 *
 * Block nodes are virtualization-only and never disabled directly; they
 * inherit their parent CollapseNode's state via the ancestor walk.
 */
@Injectable()
export class DisableController {
  private cfg: DisableControllerConfig | null = null;

  configure(cfg: DisableControllerConfig): void {
    this.cfg = cfg;
  }

  isDisabled(node: TreeNode): boolean {
    const cfg = this.cfg;
    if (cfg === null) return false;
    const keys = cfg.disabledKeys();
    if (keys.size === 0) return false;
    const keyFn = cfg.keyFn() ?? defaultKeyFn;
    if (node.kind !== 'block' && node.kind !== 'loadmore') {
      if (keys.has(keyFn(node))) return true;
    }
    if (cfg.disableParentNodesOnly()) return false;
    // Walk ancestors; a single disabled Collapse ancestor disables the subtree.
    let cur: TreeNode | null = node.parent;
    while (cur !== null) {
      if (cur.kind === 'collapse' && keys.has(keyFn(cur))) return true;
      cur = cur.parent;
    }
    return false;
  }

  isInteractive(node: TreeNode): boolean {
    return !this.isDisabled(node);
  }

  canToggleExpand(node: CollapseNode): boolean {
    if (!this.isDisabled(node)) return true;
    const cfg = this.cfg;
    return cfg !== null && cfg.expandDisabledNodes();
  }
}
