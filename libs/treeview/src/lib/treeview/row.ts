import { NgTemplateOutlet } from '@angular/common';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TreeDragService } from './dnd/tree-drag.service';
import { CheckController } from './state/check';
import { DisableController } from './state/disable';
import { TreeViewInstance } from './state/id.service';
import { NavigationController } from './state/navigation';
import { SelectionController } from './state/selection';
import { buildTemplateContext, NodeTemplateRegistry } from './templates/node-template.registry';
import { BlockNode, CollapseNode, RowNode } from './tree-model';

@Component({
  selector: 'app-row',
  imports: [NgTemplateOutlet, CdkDrag, CdkDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.top.px]': 'top()',
    '[style.height.px]': 'row().renderSize()',
  },
  template: `
    <div
      class="tv-row"
      [class.is-drag-source]="_isDragSource()"
      [class.is-in-drag-subtree]="_isInDragSubtree()"
      role="treeitem"
      [id]="_domId()"
      [attr.aria-level]="_level()"
      [attr.aria-posinset]="_posInSet()"
      [attr.aria-setsize]="_setSize()"
      [class.is-selected]="_isSelected()"
      [class.is-active]="_isActive()"
      [class.is-disabled]="_isDisabled()"
      [attr.aria-selected]="_ariaSelected()"
      [attr.aria-disabled]="_isDisabled() ? true : null"
      [style.height.px]="row().renderSize()"
      [style.--tv-depth]="depth()"
      cdkDrag
      [cdkDragDisabled]="!_isDraggable()"
      (cdkDragStarted)="_onDragStarted($event)"
      (cdkDragMoved)="_onDragMoved($event)"
      (cdkDragEnded)="_onDragEnded($event)"
      (click)="_onClick($event)"
    >
      @if (_check.isEnabled()) {
        <input
          type="checkbox"
          class="tv-check"
          [checked]="_checkedState() === 'checked'"
          [indeterminate]="_checkedState() === 'indeterminate'"
          (click)="_onCheckClick($event)"
        />
      }
      @if (_handleVisible()) {
        <span class="tv-drag-grip" cdkDragHandle aria-hidden="true">⠿</span>
      }
      @if (_customTemplate(); as tpl) {
        <ng-container
          [ngTemplateOutlet]="tpl"
          [ngTemplateOutletContext]="_templateContext()"
        />
      } @else {
        <span class="row-label">{{ row().label() }}</span>
        <span class="row-meta">{{ row().renderSize() }}px</span>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      left: 0;
      right: 0;
    }
    .tv-row {
      display: flex;
      align-items: center;
      gap: var(--tv-gap);
      padding-left: calc(
        var(--tv-indent-base) + var(--tv-depth, 0) * var(--tv-indent-step)
      );
      padding-right: var(--tv-padding-x);
      border-bottom: 1px solid var(--tv-border-soft);
      background: var(--tv-bg-row);
      font-size: var(--tv-font);
      color: var(--tv-text);
      box-sizing: border-box;
    }

    /* Smooth background transitions when state changes */
    :host-context(.tv-animate) .tv-row {
      transition: background var(--tv-anim-duration) var(--tv-anim-easing),
                  box-shadow var(--tv-anim-duration) var(--tv-anim-easing),
                  opacity var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .tv-row.is-selected {
      background: var(--tv-bg-selected);
    }
    .tv-row.is-active {
      box-shadow: inset 2px 0 0 var(--tv-accent);
      background: var(--tv-bg-active);
    }
    .tv-row.is-active.is-selected {
      background: var(--tv-bg-selected-active);
    }
    .tv-row.is-disabled {
      color: var(--tv-text-disabled);
      cursor: default;
      pointer-events: auto;
    }
    .tv-row.is-disabled .tv-check {
      pointer-events: none;
      opacity: 0.5;
    }
    .tv-row.is-drag-source {
      opacity: 0.35;
      transform: none !important;
    }
    .tv-row.is-in-drag-subtree {
      opacity: 0.4;
      pointer-events: none;
    }
    .tv-drag-grip {
      flex: 0 0 auto;
      width: var(--tv-grip-width);
      color: var(--tv-text-muted);
      cursor: grab;
      user-select: none;
      font-size: var(--tv-icon-size);
      line-height: 1;
      text-align: center;
    }
    .tv-drag-grip:active {
      cursor: grabbing;
    }
    .tv-row.is-disabled .tv-drag-grip {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .tv-check {
      flex: 0 0 auto;
      margin: 0;
      cursor: pointer;
      width: var(--tv-icon-size);
      height: var(--tv-icon-size);
    }
    .row-label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-meta {
      font-size: var(--tv-meta-font);
      color: var(--tv-text-muted);
    }
  `,
})
export class Row {
  readonly row = input.required<RowNode>();
  /** Top offset within the parent container (px). */
  readonly top = input<number>(0);
  /** Visual depth used for indentation (`--tv-depth` CSS variable). */
  readonly depth = input<number>(0);

  private readonly selection = inject(SelectionController);
  private readonly navigation = inject(NavigationController);
  private readonly disable = inject(DisableController);
  private readonly templates = inject(NodeTemplateRegistry);
  private readonly drag = inject(TreeDragService);
  private readonly instance = inject(TreeViewInstance);
  protected readonly _check = inject(CheckController);

  protected readonly _isSelected = computed(() =>
    this.selection.isSelected(this.row()),
  );

  protected readonly _ariaSelected = computed(() => {
    if (!this.selection.isEnabled()) return null;
    return this._isSelected();
  });

  protected readonly _checkedState = computed(() =>
    this._check.getState(this.row()),
  );

  protected readonly _isActive = computed(() =>
    this.navigation.isActive(this.row()),
  );

  protected readonly _isDisabled = computed(() =>
    this.disable.isDisabled(this.row()),
  );

  /** Source of the current in-flight drag — used to dim the original row. */
  protected readonly _isDragSource = computed(
    () => this.drag.source() === this.row(),
  );

  /**
   * True when an ancestor `CollapseNode` is the current drag source — i.e. the
   * row sits inside the subtree being dragged. The hit-tester already rejects
   * drops on these rows; this signal lets the row paint itself as a
   * non-target so the user sees why nothing happens when they hover.
   */
  protected readonly _isInDragSubtree = computed(() => {
    const src = this.drag.source();
    if (src === null || src.kind !== 'collapse') return false;
    let cur: BlockNode | CollapseNode | null = this.row().parent;
    while (cur !== null) {
      if (cur === src) return true;
      cur = cur.parent;
    }
    return false;
  });

  /** Drag is allowed when the host opted in AND this row isn't disabled. */
  protected readonly _isDraggable = computed(
    () => this.drag.isEnabledFor(this.instance.prefix) && !this._isDisabled(),
  );

  /**
   * `true` when the host set `dragHandle: true` — Row renders a grip that
   * CDK uses as the sole drag-initiation target (`*cdkDragHandle`).
   */
  protected readonly _handleVisible = computed(
    () => this._isDraggable() && this.drag.isHandleRequiredFor(this.instance.prefix),
  );

  protected readonly _domId = computed(() => this.instance.domIdFor(this.row().id));
  protected readonly _level = computed(() => this.navigation.ariaLevel(this.row()));
  protected readonly _posInSet = computed(
    () => this.navigation.ariaPosition(this.row())?.posInSet ?? null,
  );
  protected readonly _setSize = computed(
    () => this.navigation.ariaPosition(this.row())?.setSize ?? null,
  );

  /** Reactive accessor for an optional user template — null = default rendering. */
  protected readonly _customTemplate = computed(() => this.templates.template());

  /** Context object handed to `ngTemplateOutlet` when a custom template runs. */
  protected readonly _templateContext = computed(() =>
    buildTemplateContext({
      node: this.row(),
      depth: this._level(),
      isSelected: () => this._isSelected(),
      isChecked: () => this._checkedState(),
      isDisabled: () => this._isDisabled(),
      isActive: () => this._isActive(),
    }),
  );

  protected _onClick(event: MouseEvent): void {
    this.navigation.setActive(this.row());
    this.selection.handleClick(this.row(), event);
    this._check.handleRowClick(this.row());
  }

  protected _onCheckClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigation.setActive(this.row());
    this._check.toggle(this.row());
  }

  protected _onDragStarted(event: CdkDragStart): void {
    this.drag.beginDrag(this.row(), event.source.element.nativeElement, event.source);
  }

  protected _onDragMoved(event: CdkDragMove): void {
    this.drag.trackPointerFromEvent(event.event);
  }

  protected _onDragEnded(event: CdkDragEnd): void {
    // CDK leaves the `translate3d(...)` it applied during drag on the source
    // element when there's no `cdkDropList` (drag-ref.ts:867 onward — it
    // converts active→passive transform instead of clearing). For our
    // virtualized tree the row is moved by data updates, not by the
    // transform, so we have to wipe it ourselves; otherwise the now-visible
    // row appears shifted by however far the user dragged.
    event.source.reset();
    this.drag.commitAndEnd();
  }
}
