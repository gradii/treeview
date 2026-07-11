import {
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  untracked,
} from '@angular/core';
import { CollapseNode } from '../tree-model';
import { DisableController } from './disable';
import { defaultKeyFn, Key, KeyFn } from './keys';

/**
 * Wiring between LargeTreeView and ExpandController. The host calls
 * `configure()` once with signal-accessor closures so the controller stays
 * reactive without owning the inputs itself.
 */
export interface ExpandControllerConfig {
  /** Active key function (defaults to `node.id`). Read reactively. */
  readonly keyFn: () => KeyFn | undefined;
  /** Externally controlled expanded-key set, or `null` for self-managed mode. */
  readonly externalKeys: () => ReadonlySet<Key> | null;
  /** Tree root, used to walk Collapse nodes when syncing with an external set. */
  readonly root: () => CollapseNode;
  /** Invoked when a controller-initiated mutation produces a new key set. */
  readonly emit: (next: ReadonlySet<Key>) => void;
  /**
   * Optional hook fired after a user-driven expand/collapse. Skipped for
   * external-key mirroring (those changes are already known to the host).
   * LargeTreeView wires this to flash the expand-animation class so child rows
   * can transition into their new positions instead of snapping.
   */
  readonly onChange?: (node: CollapseNode, expanded: boolean) => void;
}

/**
 * Single source of truth at the node level remains `CollapseNode`'s
 * `HIDE_COLLAPSED` bit (read via `collapsed()`, written via `setCollapsed()`).
 * When `externalKeys` returns non-null, this controller treats it as the
 * owner and keeps the bit synchronized: incoming external changes apply
 * top-down via the effect; outgoing user toggles re-collect the tree and emit.
 */
@Injectable()
export class ExpandController {
  private readonly injector = inject(Injector);
  private readonly disable = inject(DisableController, { optional: true });
  private cfg: ExpandControllerConfig | null = null;
  private syncing = false;

  configure(cfg: ExpandControllerConfig): void {
    this.cfg = cfg;
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const keys = cfg.externalKeys();
        if (keys === null) return;
        const root = cfg.root();
        untracked(() => this._applyExternalKeys(root, keys));
      });
    });
  }

  isExpanded(node: CollapseNode): boolean {
    return !node.collapsed();
  }

  toggle(node: CollapseNode): void {
    if (this.disable !== null && !this.disable.canToggleExpand(node)) return;
    if (this.isExpanded(node)) this.collapse(node);
    else this.expand(node);
  }

  expand(node: CollapseNode): void {
    if (this.disable !== null && !this.disable.canToggleExpand(node)) return;
    if (this.isExpanded(node)) return;
    node.setCollapsed(false);
    this.cfg?.onChange?.(node, true);
    this._emitFromTreeIfExternal();
  }

  collapse(node: CollapseNode): void {
    if (this.disable !== null && !this.disable.canToggleExpand(node)) return;
    if (!this.isExpanded(node)) return;
    node.setCollapsed(true);
    this.cfg?.onChange?.(node, false);
    this._emitFromTreeIfExternal();
  }

  private _emitFromTreeIfExternal(): void {
    const cfg = this.cfg;
    if (this.syncing || cfg === null) return;
    const keys = untracked(() => cfg.externalKeys());
    if (keys === null) return;
    const keyFn = untracked(() => cfg.keyFn()) ?? defaultKeyFn;
    const root = untracked(() => cfg.root());
    const next = new Set<Key>();
    collectExpandedKeys(root, keyFn, next);
    cfg.emit(next);
  }

  private _applyExternalKeys(root: CollapseNode, keys: ReadonlySet<Key>): void {
    const cfg = this.cfg;
    if (this.syncing || cfg === null) return;
    const keyFn = untracked(() => cfg.keyFn()) ?? defaultKeyFn;
    this.syncing = true;
    try {
      applyExpandedKeys(root, keys, keyFn);
    } finally {
      this.syncing = false;
    }
  }
}

function collectExpandedKeys(
  node: CollapseNode,
  keyFn: KeyFn,
  out: Set<Key>,
): void {
  if (!node.collapsed()) out.add(keyFn(node));
  for (const child of node.children()) {
    if (child.kind === 'collapse') collectExpandedKeys(child, keyFn, out);
  }
}

function applyExpandedKeys(
  node: CollapseNode,
  keys: ReadonlySet<Key>,
  keyFn: KeyFn,
): void {
  const wantCollapsed = !keys.has(keyFn(node));
  if (node.collapsed() !== wantCollapsed) {
    node.setCollapsed(wantCollapsed);
  }
  for (const child of node.children()) {
    if (child.kind === 'collapse') applyExpandedKeys(child, keys, keyFn);
  }
}
