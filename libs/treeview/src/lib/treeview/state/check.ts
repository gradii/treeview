import { computed, inject, Injectable, Signal } from '@angular/core';
import { BlockNode, CollapseNode, TreeNode } from '../tree-model';
import { DisableController } from './disable';
import { defaultKeyFn, Key, KeyFn } from './keys';

export type CheckedState = 'checked' | 'indeterminate' | 'none';
export type CheckMode = 'single' | 'multiple';

/**
 * Mirrors Kendo's `CheckableSettings`. Pass `false` to disable, `true` to
 * enable with defaults, or an object to override individual fields.
 */
export interface CheckableSettings {
  readonly enabled?: boolean;
  readonly mode?: CheckMode;
  /** In multiple mode, checking a node cascades to its descendants. */
  readonly checkChildren?: boolean;
  /** In multiple mode, parents derive `indeterminate` from their children. */
  readonly checkParents?: boolean;
  /** When true, plain row click also toggles the check state. */
  readonly checkOnClick?: boolean;
}

const DEFAULT_SETTINGS: Required<CheckableSettings> = {
  enabled: true,
  mode: 'multiple',
  checkChildren: true,
  checkParents: true,
  checkOnClick: false,
};

export interface CheckControllerConfig {
  readonly keyFn: () => KeyFn | undefined;
  /** Reactive accessor for the checkable settings (boolean shortcut OK). */
  readonly settings: () => boolean | CheckableSettings;
  readonly checkedKeys: () => ReadonlySet<Key>;
  readonly root: () => CollapseNode;
  readonly emit: (next: ReadonlySet<Key>) => void;
}

/**
 * Owns the check (tri-state) behavior. `checkedKeys` is the caller-held source
 * of truth; this controller emits a new Set on every mutation.
 *
 * `indeterminate` is **not** stored — it's a derived `computed` over the tree
 * shape plus `checkedKeys`. A node is indeterminate iff some descendant is in
 * the checked set but the node itself is not. Empty subtrees are never
 * indeterminate.
 *
 * Block wrappers are transparent: they hold no key and contribute only their
 * row children to cascades and indeterminate computation.
 */
@Injectable()
export class CheckController {
  private cfg: CheckControllerConfig | null = null;
  private settingsSig: Signal<Required<CheckableSettings>> | null = null;
  private indeterminateSig: Signal<ReadonlySet<Key>> | null = null;
  private readonly disable = inject(DisableController, { optional: true });

  configure(cfg: CheckControllerConfig): void {
    this.cfg = cfg;

    this.settingsSig = computed<Required<CheckableSettings>>(() => {
      const raw = cfg.settings();
      if (typeof raw === 'boolean') {
        return { ...DEFAULT_SETTINGS, enabled: raw };
      }
      return { ...DEFAULT_SETTINGS, ...raw };
    });

    this.indeterminateSig = computed<ReadonlySet<Key>>(() => {
      const s = this.settingsSig?.();
      if (s === undefined) return EMPTY;
      const checked = cfg.checkedKeys();
      if (
        !s.enabled ||
        s.mode !== 'multiple' ||
        !s.checkParents ||
        checked.size === 0
      ) {
        return EMPTY;
      }
      const out = new Set<Key>();
      computeIndeterminate(
        cfg.root(),
        cfg.keyFn() ?? defaultKeyFn,
        checked,
        out,
      );
      return out;
    });
  }

  /** Reactive: true when the controller has been told to render checkboxes. */
  isEnabled(): boolean {
    return this.settingsSig?.().enabled ?? false;
  }

  /** Reactive: true when plain row click should also toggle the check. */
  isCheckOnClick(): boolean {
    const s = this.settingsSig?.();
    return Boolean(s?.enabled && s.checkOnClick);
  }

  /** Reactive: indeterminate keys derived from `checkedKeys` + tree shape. */
  indeterminateKeys(): ReadonlySet<Key> {
    return this.indeterminateSig?.() ?? EMPTY;
  }

  /** Reactive: tri-state for the given node. */
  getState(node: TreeNode): CheckedState {
    const cfg = this.cfg;
    const s = this.settingsSig?.();
    if (cfg === null || s === undefined || !s.enabled) return 'none';
    if (node.kind === 'block') return 'none';
    const key = (cfg.keyFn() ?? defaultKeyFn)(node);
    if (cfg.checkedKeys().has(key)) return 'checked';
    if (this.indeterminateSig?.().has(key)) return 'indeterminate';
    return 'none';
  }

  /**
   * Toggle the check state of `node`. Cascades according to current settings.
   * No-op when disabled, when `node` is a Block, or in `single` mode if the
   * caller passes a Block (we still only operate on Rows and Collapses).
   */
  toggle(node: TreeNode): void {
    const cfg = this.cfg;
    const s = this.settingsSig?.();
    if (cfg === null || s === undefined || !s.enabled) return;
    if (node.kind === 'block') return;
    if (this.disable?.isDisabled(node)) return;

    const keyFn = cfg.keyFn() ?? defaultKeyFn;
    const key = keyFn(node);
    const current = cfg.checkedKeys();
    const isOn = current.has(key);

    if (s.mode === 'single') {
      cfg.emit(isOn ? new Set() : new Set([key]));
      return;
    }

    const next = new Set(current);
    const disabled = this.disable;
    if (isOn) {
      next.delete(key);
      if (s.checkChildren) cascadeDescendants(node, keyFn, next, false, disabled);
    } else {
      next.add(key);
      if (s.checkChildren) cascadeDescendants(node, keyFn, next, true, disabled);
    }
    if (s.checkParents) cascadeAncestors(node, keyFn, next);
    cfg.emit(next);
  }

  /**
   * Invoked from row/collapse click handlers; toggles only when
   * `checkOnClick` is on. Always returns silently otherwise.
   */
  handleRowClick(node: TreeNode): void {
    if (!this.isCheckOnClick()) return;
    this.toggle(node);
  }
}

const EMPTY: ReadonlySet<Key> = new Set<Key>();

function cascadeDescendants(
  node: TreeNode,
  keyFn: KeyFn,
  set: Set<Key>,
  on: boolean,
  disable: DisableController | null,
): void {
  if (node.kind === 'row' || node.kind === 'loadmore') return;
  for (const child of node.children()) {
    if (child.kind === 'row' || child.kind === 'collapse') {
      // Disabled descendants are skipped during cascade — neither checked
      // when their parent is checked nor un-checked when the parent flips off.
      if (disable === null || !disable.isDisabled(child)) {
        const k = keyFn(child);
        if (on) set.add(k);
        else set.delete(k);
      }
    }
    cascadeDescendants(child, keyFn, set, on, disable);
  }
}

function cascadeAncestors(
  node: TreeNode,
  keyFn: KeyFn,
  set: Set<Key>,
): void {
  let cur: TreeNode | null = node.parent;
  while (cur !== null) {
    if (cur.kind === 'collapse') {
      const key = keyFn(cur);
      if (areAllChildrenChecked(cur, keyFn, set)) set.add(key);
      else set.delete(key);
    }
    cur = (cur as BlockNode | CollapseNode).parent;
  }
}

function areAllChildrenChecked(
  parent: CollapseNode,
  keyFn: KeyFn,
  set: ReadonlySet<Key>,
): boolean {
  const children = parent.children();
  if (children.length === 0) return false;
  for (const c of children) {
    if (c.kind === 'collapse') {
      if (!set.has(keyFn(c))) return false;
    } else {
      // block: recursively check its rows (possibly through nested sub-blocks)
      if (!blockAllRowsChecked(c, keyFn, set)) return false;
    }
  }
  return true;
}

function blockAllRowsChecked(
  block: BlockNode,
  keyFn: KeyFn,
  set: ReadonlySet<Key>,
): boolean {
  const children = block.children();
  if (children.length === 0) return false;
  for (const c of children) {
    if (c.kind === 'row') {
      if (!set.has(keyFn(c))) return false;
    } else if (c.kind === 'block') {
      if (!blockAllRowsChecked(c, keyFn, set)) return false;
    }
    // Collapse children embedded in a row block are their own subtree —
    // their checked-state is tracked separately, not via the host block.
  }
  return true;
}

/**
 * DFS the tree. For every Collapse that's NOT in `checked` but has at least
 * one descendant in `checked`, add its key to `out`. Returns true if `node`
 * (or any descendant) is in the checked set, used to short-circuit ancestors.
 */
function computeIndeterminate(
  node: TreeNode,
  keyFn: KeyFn,
  checked: ReadonlySet<Key>,
  out: Set<Key>,
): boolean {
  if (node.kind === 'row') return checked.has(keyFn(node));
  if (node.kind === 'loadmore') return false;
  if (node.kind === 'block') {
    let any = false;
    for (const c of node.children()) {
      if (computeIndeterminate(c, keyFn, checked, out)) any = true;
    }
    return any;
  }
  const key = keyFn(node);
  const selfChecked = checked.has(key);
  let descHasChecked = false;
  for (const c of node.children()) {
    if (computeIndeterminate(c, keyFn, checked, out)) descHasChecked = true;
  }
  if (!selfChecked && descHasChecked) out.add(key);
  return selfChecked || descHasChecked;
}
