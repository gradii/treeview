import { inject, Injectable } from '@angular/core';
import { CollapseNode, TreeNode } from '../tree-model';
import { DisableController } from './disable';
import { defaultKeyFn, Key, KeyFn } from './keys';

export type SelectionMode = 'none' | 'single' | 'multiple';

/** Click-event-like shape — keeps the controller free of DOM dependencies. */
export interface SelectionClickEvent {
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface SelectionControllerConfig {
  readonly keyFn: () => KeyFn | undefined;
  readonly mode: () => SelectionMode;
  readonly selectedKeys: () => ReadonlySet<Key>;
  readonly root: () => CollapseNode;
  readonly emit: (next: ReadonlySet<Key>) => void;
}

/**
 * Selection state owner. The `selectedKeys` set is held by the caller and read
 * here reactively; mutations are emitted back via the `emit` callback so the
 * caller can update its `WritableSignal`.
 *
 * Click semantics (matches Kendo-style trees + common file managers):
 * - mode `'none'`: no-op
 * - mode `'single'`: any click replaces selection with the clicked node
 * - mode `'multiple'`:
 *   - plain click → replace selection with the clicked node
 *   - ctrl/cmd+click → toggle this node in the set
 *   - shift+click → range from the last anchor (inclusive) in visible flat order
 */
@Injectable()
export class SelectionController {
  private cfg: SelectionControllerConfig | null = null;
  private anchor: Key | null = null;
  private readonly disable = inject(DisableController, { optional: true });

  configure(cfg: SelectionControllerConfig): void {
    this.cfg = cfg;
  }

  isSelected(node: TreeNode): boolean {
    const cfg = this.cfg;
    if (cfg === null) return false;
    if (cfg.mode() === 'none') return false;
    return cfg.selectedKeys().has(this._keyOf(node));
  }

  /** Reactive: returns true when selection is active (mode ≠ 'none'). */
  isEnabled(): boolean {
    const cfg = this.cfg;
    return cfg !== null && cfg.mode() !== 'none';
  }

  handleClick(node: TreeNode, event?: SelectionClickEvent): void {
    const cfg = this.cfg;
    if (cfg === null) return;
    const mode = cfg.mode();
    if (mode === 'none') return;
    if (this.disable?.isDisabled(node)) return;

    const key = this._keyOf(node);

    if (mode === 'single') {
      cfg.emit(new Set([key]));
      this.anchor = key;
      return;
    }

    const ctrl = !!event?.ctrlKey || !!event?.metaKey;
    const shift = !!event?.shiftKey;

    if (shift && this.anchor !== null) {
      const range = visibleRangeKeys(
        cfg.root(),
        cfg.keyFn() ?? defaultKeyFn,
        this.anchor,
        key,
      );
      const next = new Set(cfg.selectedKeys());
      for (const k of range) next.add(k);
      cfg.emit(next);
      return;
    }

    if (ctrl) {
      const next = new Set(cfg.selectedKeys());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      cfg.emit(next);
      this.anchor = key;
      return;
    }

    cfg.emit(new Set([key]));
    this.anchor = key;
  }

  /** Explicit setter for programmatic callers. */
  setSelection(keys: Iterable<Key>): void {
    const cfg = this.cfg;
    if (cfg === null) return;
    cfg.emit(new Set(keys));
  }

  /** Reset the shift-range anchor. Useful when programmatically replacing selection. */
  resetAnchor(key: Key | null = null): void {
    this.anchor = key;
  }

  private _keyOf(node: TreeNode): Key {
    const cfg = this.cfg;
    if (cfg === null) return defaultKeyFn(node);
    return (cfg.keyFn() ?? defaultKeyFn)(node);
  }
}

/**
 * DFS the tree in display order and collect every Collapse / Row key visible
 * given the current `collapsed` state. Block wrappers are skipped (their rows
 * still emit). Used by shift-range to determine "between anchor and target".
 *
 * Stage 6's a11y/flat-index will offer a memoized version with depth metadata;
 * this lightweight walker covers Stage 3's needs without that dependency.
 */
export function visibleFlatKeys(root: CollapseNode, keyFn: KeyFn): Key[] {
  const out: Key[] = [];
  walk(root);
  return out;

  function walk(node: TreeNode): void {
    if (node.kind === 'collapse') {
      out.push(keyFn(node));
      if (!node.collapsed()) {
        for (const c of node.children()) walk(c);
      }
    } else if (node.kind === 'block') {
      for (const c of node.children()) walk(c);
    } else {
      out.push(keyFn(node));
    }
  }
}

/**
 * Early-exit variant of `visibleFlatKeys` that returns only the inclusive
 * range between two keys, in tree display order. Walks at most once and stops
 * after the second endpoint is found.
 */
export function visibleRangeKeys(
  root: CollapseNode,
  keyFn: KeyFn,
  a: Key,
  b: Key,
): Key[] {
  const buffer: Key[] = [];
  let startIdx = -1;
  let endIdx = -1;

  const collect = (node: TreeNode): boolean => {
    if (node.kind === 'block') {
      for (const c of node.children()) {
        if (collect(c)) return true;
      }
      return false;
    }
    if (node.kind === 'collapse') {
      const idx = buffer.push(keyFn(node)) - 1;
      checkBoundary(buffer[idx], idx);
      if (endIdx !== -1) return true;
      if (!node.collapsed()) {
        for (const c of node.children()) {
          if (collect(c)) return true;
        }
      }
      return false;
    }
    const idx = buffer.push(keyFn(node)) - 1;
    checkBoundary(buffer[idx], idx);
    return endIdx !== -1;
  };

  function checkBoundary(k: Key, idx: number): void {
    if (startIdx === -1) {
      if (k === a || k === b) startIdx = idx;
    } else if (endIdx === -1 && (k === a || k === b)) {
      endIdx = idx;
    }
  }

  collect(root);

  if (startIdx === -1) return [];
  if (endIdx === -1) return [buffer[startIdx]];
  return buffer.slice(startIdx, endIdx + 1);
}
