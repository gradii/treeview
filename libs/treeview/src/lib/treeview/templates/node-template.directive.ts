import { Directive, inject, TemplateRef } from '@angular/core';
import { NodeTemplateContext } from './node-template.registry';

/**
 * Drop a `<ng-template appTreeViewNodeTemplate let-item …>` inside a
 * `<app-large-tree-view>` to customize how rows and collapse headers render.
 *
 * The template gets a single `NodeTemplateContext<T>`:
 * - `$implicit` (default `let-item`) is `node.meta` — the original source item.
 * - Named slots: `let-node`, `let-depth`, `let-isSelected`, `let-isChecked`,
 *   `let-isExpanded`, `let-isDisabled`, `let-isActive`.
 *
 * Switch on `node.kind` (`'row'` vs `'collapse'`) when the two need different
 * markup. Templates are optional — components fall back to default rendering
 * when the slot is empty.
 *
 * The directive is a passive holder: LargeTreeView picks it up via
 * `contentChild` and pushes the captured `templateRef` into the
 * `NodeTemplateRegistry` (which lives in the LargeTreeView providers, hence
 * the indirection — content-projected directives don't share the host's DI
 * scope).
 *
 * @example
 * ```html
 * <app-large-tree-view [root]="root">
 *   <ng-template appTreeViewNodeTemplate let-item let-node="node">
 *     @switch (node.kind) {
 *       @case ('collapse') { 📁 {{ item.name }} ({{ item.children?.length }}) }
 *       @case ('row')      { 📄 {{ item.name }} }
 *     }
 *   </ng-template>
 * </app-large-tree-view>
 * ```
 */
@Directive({
  selector: '[appTreeViewNodeTemplate]',
  standalone: true,
})
export class NodeTemplateDirective<T = unknown> {
  readonly templateRef = inject<TemplateRef<NodeTemplateContext<T>>>(TemplateRef);
}
