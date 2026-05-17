import { Injectable, signal, TemplateRef, WritableSignal } from '@angular/core';
import { CheckedState } from '../state/check';
import { CollapseNode, RowNode, TreeNode } from '../tree-model';

/**
 * Reactive context handed to a user-provided node template. `$implicit` is
 * the underlying source item (whatever was in `meta`), so the simple
 * `let-item` shorthand maps to it.
 *
 * State flags reflect the *current* tick — Angular re-evaluates the
 * `ngTemplateOutlet` context whenever the signals backing them change.
 */
export interface NodeTemplateContext<T> {
  $implicit: T;
  /** The tree node itself — type-narrow on `node.kind` for row vs collapse. */
  node: RowNode | CollapseNode;
  /** Visual depth used for indentation. 1-based from the synthetic root's children. */
  depth: number;
  isSelected: boolean;
  /** `'checked'` / `'indeterminate'` / `'none'`. Always `'none'` when check is disabled. */
  isChecked: CheckedState;
  /** `null` for rows (not collapsible); `true` / `false` for CollapseNode. */
  isExpanded: boolean | null;
  isDisabled: boolean;
  /** Convenience: is this node currently keyboard-focused? */
  isActive: boolean;
}

/**
 * Per-LargeTreeView slot for a user-supplied `<ng-template>`. LargeTreeView
 * picks the template up via `@ContentChild(NodeTemplateDirective)` and pokes
 * it into the registry; descendant Row and Collapse components inject the
 * registry and read the signal each render.
 *
 * Why a service (not an `@Input`)? Row and Collapse are deep descendants —
 * threading the template through Collapse → Block → Row as input chains
 * means re-binding at every level. The registry shares one source of truth
 * via DI, scoped to the LargeTreeView providers, with zero glue.
 */
@Injectable()
export class NodeTemplateRegistry {
  readonly template: WritableSignal<
    TemplateRef<NodeTemplateContext<unknown>> | null
  > = signal(null);

  set(template: TemplateRef<NodeTemplateContext<unknown>> | null): void {
    this.template.set(template);
  }

  has(): boolean {
    return this.template() !== null;
  }
}

/**
 * Build a NodeTemplateContext for a node, pulling reactive state from the
 * supplied accessors. Each accessor is a plain getter — call inside a
 * `computed` so dependent signals flow through automatically.
 */
export function buildTemplateContext<T>(args: {
  node: RowNode | CollapseNode;
  depth: number;
  isSelected: () => boolean;
  isChecked: () => CheckedState;
  isDisabled: () => boolean;
  isActive: () => boolean;
}): NodeTemplateContext<T> {
  const { node, depth, isSelected, isChecked, isDisabled, isActive } = args;
  return {
    $implicit: node.meta as T,
    node,
    depth,
    isSelected: isSelected(),
    isChecked: isChecked(),
    isExpanded: node.kind === 'collapse' ? !node.collapsed() : null,
    isDisabled: isDisabled(),
    isActive: isActive(),
  };
}

export type AnyTreeNode = TreeNode;
