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
      [class.is-drag-source]="isDragSource()"
      [class.is-in-drag-subtree]="isInDragSubtree()"
      role="treeitem"
      [id]="domId()"
      [attr.aria-level]="level()"
      [attr.aria-posinset]="posInSet()"
      [attr.aria-setsize]="setSize()"
      [class.is-selected]="isSelected()"
      [class.is-active]="isActive()"
      [class.is-disabled]="isDisabled()"
      [attr.aria-selected]="ariaSelected()"
      [attr.aria-disabled]="isDisabled() ? true : null"
      [style.height.px]="row().renderSize()"
      [style.--tv-depth]="depth()"
      cdkDrag
      [cdkDragDisabled]="!isDraggable()"
      (cdkDragStarted)="onDragStarted($event)"
      (cdkDragMoved)="onDragMoved($event)"
      (cdkDragEnded)="onDragEnded($event)"
      (click)="onClick($event)"
    >
      @if (check.isEnabled()) {
        <input
          type="checkbox"
          class="tv-check"
          [checked]="checkedState() === 'checked'"
          [indeterminate]="checkedState() === 'indeterminate'"
          (click)="onCheckClick($event)"
        />
      }
      @if (handleVisible()) {
        <span class="tv-drag-grip" cdkDragHandle aria-hidden="true">⠿</span>
      }
      @if (customTemplate(); as tpl) {
        <ng-container
          [ngTemplateOutlet]="tpl"
          [ngTemplateOutletContext]="templateContext()"
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
  protected readonly check = inject(CheckController);

  protected readonly isSelected = computed(() =>
    this.selection.isSelected(this.row()),
  );

  protected readonly ariaSelected = computed(() => {
    if (!this.selection.isEnabled()) return null;
    return this.isSelected();
  });

  protected readonly checkedState = computed(() =>
    this.check.getState(this.row()),
  );

  protected readonly isActive = computed(() =>
    this.navigation.isActive(this.row()),
  );

  protected readonly isDisabled = computed(() =>
    this.disable.isDisabled(this.row()),
  );

  /** Source of the current in-flight drag — used to dim the original row. */
  protected readonly isDragSource = computed(
    () => this.drag.source() === this.row(),
  );

  /**
   * True when an ancestor `CollapseNode` is the current drag source — i.e. the
   * row sits inside the subtree being dragged. The hit-tester already rejects
   * drops on these rows; this signal lets the row paint itself as a
   * non-target so the user sees why nothing happens when they hover.
   */
  protected readonly isInDragSubtree = computed(() => {
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
  protected readonly isDraggable = computed(
    () => this.drag.isEnabledFor(this.instance.prefix) && !this.isDisabled(),
  );

  /**
   * `true` when the host set `dragHandle: true` — Row renders a grip that
   * CDK uses as the sole drag-initiation target (`*cdkDragHandle`).
   */
  protected readonly handleVisible = computed(
    () => this.isDraggable() && this.drag.isHandleRequiredFor(this.instance.prefix),
  );

  protected readonly domId = computed(() => this.instance.domIdFor(this.row().id));
  protected readonly level = computed(() => this.navigation.ariaLevel(this.row()));
  protected readonly posInSet = computed(
    () => this.navigation.ariaPosition(this.row())?.posInSet ?? null,
  );
  protected readonly setSize = computed(
    () => this.navigation.ariaPosition(this.row())?.setSize ?? null,
  );

  /** Reactive accessor for an optional user template — null = default rendering. */
  protected readonly customTemplate = computed(() => this.templates.template());

  /** Context object handed to `ngTemplateOutlet` when a custom template runs. */
  protected readonly templateContext = computed(() =>
    buildTemplateContext({
      node: this.row(),
      depth: this.level(),
      isSelected: () => this.isSelected(),
      isChecked: () => this.checkedState(),
      isDisabled: () => this.isDisabled(),
      isActive: () => this.isActive(),
    }),
  );

  protected onClick(event: MouseEvent): void {
    this.navigation.setActive(this.row());
    this.selection.handleClick(this.row(), event);
    this.check.handleRowClick(this.row());
  }

  protected onCheckClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigation.setActive(this.row());
    this.check.toggle(this.row());
  }

  protected onDragStarted(event: CdkDragStart): void {
    this.drag.beginDrag(this.row(), event.source.element.nativeElement, event.source);
  }

  protected onDragMoved(event: CdkDragMove): void {
    this.drag.trackPointerFromEvent(event.event);
  }

  protected onDragEnded(event: CdkDragEnd): void {
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
