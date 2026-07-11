import { NgTemplateOutlet } from '@angular/common';
import { CdkDrag, CdkDragEnd, CdkDragHandle, CdkDragMove, CdkDragStart } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, input, } from '@angular/core';
import { Block } from './block';
import { LoadMore } from './load-more';
import { TreeDragService } from './dnd/tree-drag.service';
import { CheckController } from './state/check';
import { DisableController } from './state/disable';
import { ExpandController } from './state/expand';
import { TreeViewInstance } from './state/id.service';
import { NavigationController } from './state/navigation';
import { SelectionController } from './state/selection';
import { buildTemplateContext, NodeTemplateRegistry } from './templates/node-template.registry';
import { BlockNode, CollapseNode, HIDE_SELF_MASK, LoadMoreNode } from './tree-model';

interface VisibleCollapseChild {
  kind: 'collapse';
  key: string;
  node: CollapseNode;
  top: number;
}

interface VisibleBlockChild {
  kind: 'block';
  key: string;
  node: BlockNode;
  top: number;
}

interface VisibleLoadMoreChild {
  kind: 'loadmore';
  key: string;
  node: LoadMoreNode;
  top: number;
}

type VisibleChild =
  | VisibleCollapseChild
  | VisibleBlockChild
  | VisibleLoadMoreChild;

/**
 * Renders a CollapseNode as a real DOM container with `position: absolute` and
 * explicit height. Its header and children are positioned relative to this
 * container. Children (sub-Collapses, Blocks, LoadMore) are viewport-culled at
 * each level — only those whose absolute range intersects the viewport are
 * rendered. The header is skipped when the node appears in the sticky stack.
 */
@Component({
  selector: 'app-collapse',
  imports: [forwardRef(() => Block), LoadMore, NgTemplateOutlet, CdkDrag, CdkDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.top.px]': 'offset()',
    '[style.height.px]': '_nodeHeight()',
  },
  template: `
    @if (_renderHeader()) {
      <div
        class="tv-header"
        [class.is-drag-source]="_isDragSource()"
        [class.is-in-drag-subtree]="_isInDragSubtree()"
        role="treeitem"
        [id]="_domId()"
        [attr.aria-level]="_level()"
        [attr.aria-expanded]="!node().collapsed()"
        [attr.aria-posinset]="_posInSet()"
        [attr.aria-setsize]="_setSize()"
        [class.collapsed]="node().collapsed()"
        [class.is-selected]="_isSelected()"
        [class.is-active]="_isActive()"
        [class.is-disabled]="_isDisabled()"
        [attr.aria-selected]="_ariaSelected()"
        [attr.aria-disabled]="_isDisabled() ? true : null"
        [style.top.px]="0"
        [style.height.px]="node().headerSize()"
        [style.--tv-depth]="node().depth()"
        cdkDrag
        [cdkDragDisabled]="!_isDraggable()"
        (cdkDragStarted)="_onDragStarted($event)"
        (cdkDragMoved)="_onDragMoved($event)"
        (cdkDragEnded)="_onDragEnded($event)"
        (click)="_onClick($event)"
      >
        @if (_handleVisible()) {
          <span class="tv-drag-grip" cdkDragHandle aria-hidden="true">⠿</span>
        }
        <span class="caret" [class.is-expanded]="!node().collapsed()">▶</span>
        @if (_check.isEnabled()) {
          <input
            type="checkbox"
            class="tv-check"
            [checked]="_checkedState() === 'checked'"
            [indeterminate]="_checkedState() === 'indeterminate'"
            (click)="_onCheckClick($event)"
          />
        }
        @if (_customTemplate(); as tpl) {
          <ng-container
            [ngTemplateOutlet]="tpl"
            [ngTemplateOutletContext]="_templateContext()"
          />
        } @else {
          <span class="label">{{ node().label() }}</span>
          <span class="meta">{{ node().nodeCount() }} nodes</span>
        }
      </div>
    }

    @if (!node().collapsed()) {
      @for (child of _visibleChildren(); track child.key) {
        @switch (child.kind) {
          @case ('collapse') {
            <app-collapse
              [node]="child.node"
              [offset]="child.top"
              [absoluteOrigin]="_absoluteTop()"
              [viewportTop]="viewportTop()"
              [viewportBottom]="viewportBottom()"
              [stickyIds]="stickyIds()"
            />
          }
          @case ('block') {
            <app-block
              [block]="child.node"
              [offset]="child.top"
              [absoluteOrigin]="_absoluteTop()"
              [viewportTop]="viewportTop()"
              [viewportBottom]="viewportBottom()"
              [rowDepth]="_childDepth()"
            />
          }
          @case ('loadmore') {
            <app-load-more
              [node]="child.node"
              [absoluteTop]="child.top"
              [depth]="_childDepth()"
            />
          }
        }
      }
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
    }

    .tv-header {
      position: absolute;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      gap: var(--tv-gap);
      background: var(--tv-bg-header);
      border-bottom: 1px solid var(--tv-border);
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: var(--tv-font);
      color: var(--tv-text-strong);
      padding-left: calc(
        var(--tv-indent-base) + var(--tv-depth, 0) * var(--tv-indent-step)
      );
      padding-right: var(--tv-padding-x);
      box-sizing: border-box;
    }

    /* Smooth transitions for header state changes */
    :host-context(.tv-animate) .tv-header {
      transition: background var(--tv-anim-duration) var(--tv-anim-easing),
                  box-shadow var(--tv-anim-duration) var(--tv-anim-easing),
                  opacity var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .tv-header .caret {
      width: var(--tv-icon-size);
      color: var(--tv-text-subtle);
      display: inline-block;
      transform-origin: 50% 50%;
      font-size: 0.85em;
    }

    :host-context(.tv-animate) .tv-header .caret {
      transition: transform var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .tv-header .caret.is-expanded {
      transform: rotate(90deg);
    }

    .tv-header .label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tv-header .meta {
      font-size: var(--tv-meta-font);
      color: var(--tv-text-muted);
      font-weight: 400;
    }

    .tv-header.is-selected {
      background: var(--tv-bg-selected);
    }

    .tv-header.is-active {
      box-shadow: inset 2px 0 0 var(--tv-accent);
      background: var(--tv-bg-active-header);
    }

    .tv-header.is-active.is-selected {
      background: var(--tv-bg-selected-active);
    }

    .tv-header.is-disabled {
      color: var(--tv-text-disabled);
      cursor: default;
    }

    .tv-header.is-disabled .tv-check {
      pointer-events: none;
      opacity: 0.5;
    }

    .tv-header.is-disabled .caret {
      color: var(--tv-text-disabled);
      opacity: 0.6;
    }

    .tv-header.is-drag-source {
      opacity: 0.35;
      transform: none !important;
    }

    .tv-header.is-in-drag-subtree {
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

    .tv-header.is-disabled .tv-drag-grip {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .tv-check {
      flex: 0 0 auto;
      margin: 0 4px 0 0;
      cursor: pointer;
      width: var(--tv-icon-size);
      height: var(--tv-icon-size);
    }
  `,
})
export class Collapse {
  readonly node = input.required<CollapseNode>();
  /** Top offset relative to the parent container. */
  readonly offset = input.required<number>();
  /**
   * Absolute canvas-Y origin of the parent container. Used together with
   * `offset` to compute this collapse's absolute position for viewport tests.
   */
  readonly absoluteOrigin = input<number>(0);
  /** Top edge of the effective viewport (in canvas coordinates). */
  readonly viewportTop = input.required<number>();
  /** Bottom edge of the effective viewport (in canvas coordinates). */
  readonly viewportBottom = input.required<number>();
  readonly stickyIds = input<ReadonlySet<string>>(new Set<string>());

  private readonly expand = inject(ExpandController);
  private readonly selection = inject(SelectionController);
  private readonly navigation = inject(NavigationController);
  private readonly disable = inject(DisableController);
  private readonly templates = inject(NodeTemplateRegistry);
  private readonly instance = inject(TreeViewInstance);
  private readonly drag = inject(TreeDragService);
  protected readonly _check = inject(CheckController);

  /** Absolute canvas-Y of this collapse's top edge. */
  protected readonly _absoluteTop = computed(() => this.absoluteOrigin() + this.offset());

  protected readonly _nodeHeight = computed(() => this.node().height());

  /** Visual depth handed to descendant Blocks / LoadMore for indentation. */
  protected readonly _childDepth = computed(() => this.node().depth() + 1);

  protected readonly _isSelected = computed(() =>
    this.selection.isSelected(this.node()),
  );

  protected readonly _isActive = computed(() =>
    this.navigation.isActive(this.node()),
  );

  protected readonly _isDisabled = computed(() =>
    this.disable.isDisabled(this.node()),
  );

  /** Source of an in-flight drag — dims the header while the user holds it. */
  protected readonly _isDragSource = computed(
    () => this.drag.source() === this.node(),
  );

  /**
   * True when an ancestor `CollapseNode` is the current drag source — the
   * header sits inside the subtree being dragged. The hit-tester already
   * rejects drops here; this signal lets the header paint as a non-target so
   * the user sees why nothing happens when they hover.
   */
  protected readonly _isInDragSubtree = computed(() => {
    const src = this.drag.source();
    if (src === null || src.kind !== 'collapse') return false;
    let cur: BlockNode | CollapseNode | null = this.node().parent;
    while (cur !== null) {
      if (cur === src) return true;
      cur = cur.parent;
    }
    return false;
  });

  /**
   * Drag enabled when the host opted in, the collapse isn't disabled, and
   * this isn't the synthetic root (which has no parent — `moveCollapse`
   * can't relocate it, so initiating a drag would lead nowhere).
   */
  protected readonly _isDraggable = computed(
    () =>
      this.drag.isEnabledFor(this.instance.prefix) &&
      !this._isDisabled() &&
      this.node().parent !== null,
  );

  /** Whether to render the explicit grip element (vs whole-header drag). */
  protected readonly _handleVisible = computed(
    () => this._isDraggable() && this.drag.isHandleRequiredFor(this.instance.prefix),
  );

  protected readonly _domId = computed(() => this.instance.domIdFor(this.node().id));
  protected readonly _level = computed(() => this.navigation.ariaLevel(this.node()));
  protected readonly _posInSet = computed(
    () => this.navigation.ariaPosition(this.node())?.posInSet ?? null,
  );
  protected readonly _setSize = computed(
    () => this.navigation.ariaPosition(this.node())?.setSize ?? null,
  );

  /** Reactive accessor for an optional user template — null = default rendering. */
  protected readonly _customTemplate = computed(() => this.templates.template());

  /** Context object handed to `ngTemplateOutlet` when a custom template runs. */
  protected readonly _templateContext = computed(() =>
    buildTemplateContext({
      node: this.node(),
      depth: this._level(),
      isSelected: () => this._isSelected(),
      isChecked: () => this._checkedState(),
      isDisabled: () => this._isDisabled(),
      isActive: () => this._isActive(),
    }),
  );

  protected readonly _checkedState = computed(() =>
    this._check.getState(this.node()),
  );

  /** `aria-selected` is omitted entirely when selection is disabled. */
  protected readonly _ariaSelected = computed(() => {
    if (!this.selection.isEnabled()) return null;
    return this._isSelected();
  });

  /**
   * Skip the natural header when this collapse is already in the sticky stack —
   * the overlay layer will paint it. Skip when filtered-out (visible=false).
   * Otherwise emit only if the header intersects the effective viewport.
   */
  protected readonly _renderHeader = computed(() => {
    if ((this.node().invisible() & HIDE_SELF_MASK) !== 0) return false;
    if (this.stickyIds().has(this.node().id)) return false;
    const absTop = this._absoluteTop();
    const absBot = absTop + this.node().headerSize();
    return absBot > this.viewportTop() && absTop < this.viewportBottom();
  });

  /**
   * Children whose absolute range intersects the viewport, with `top` values
   * relative to this collapse's content area (i.e. starting after the header).
   */
  protected readonly _visibleChildren = computed<VisibleChild[]>(() => {
    const results: VisibleChild[] = [];
    if ((this.node().invisible() & HIDE_SELF_MASK) !== 0 || this.node().collapsed()) return results;
    const headerH = this.node().headerSize();
    const contentAbsTop = this._absoluteTop() + headerH;
    const vt = this.viewportTop();
    const vb = this.viewportBottom();
    let cursor = 0;
    for (const c of this.node().children()) {
      const h = c.height();
      if (h === 0) continue;
      const childAbsTop = contentAbsTop + cursor;
      const childAbsBot = childAbsTop + h;
      if (childAbsBot > vt && childAbsTop < vb) {
        if (c.kind === 'collapse') {
          results.push({kind: 'collapse', key: c.id, node: c, top: headerH + cursor});
        } else {
          results.push({kind: 'block', key: c.id, node: c, top: headerH + cursor});
        }
      }
      cursor += h;
    }
    const lm = this.node().loadMore();
    if (lm !== null) {
      const lmAbsTop = contentAbsTop + cursor;
      const lmAbsBot = lmAbsTop + lm.renderSize();
      if (lmAbsBot > vt && lmAbsTop < vb) {
        results.push({kind: 'loadmore', key: lm.id, node: lm, top: headerH + cursor});
      }
    }
    return results;
  });

  /**
   * Plain click toggles + selects (matches sticky overlay behavior). Modifier
   * clicks (ctrl/cmd/shift) drive selection only — toggling during a range
   * select would be jarring.
   */
  protected _onClick(event: MouseEvent): void {
    const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!hasModifier) this.expand.toggle(this.node());
    this.navigation.setActive(this.node());
    this.selection.handleClick(this.node(), event);
    this._check.handleRowClick(this.node());
  }

  protected _onCheckClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigation.setActive(this.node());
    this._check.toggle(this.node());
  }

  protected _onDragStarted(event: CdkDragStart): void {
    this.drag.beginDrag(this.node(), event.source.element.nativeElement, event.source);
  }

  protected _onDragMoved(event: CdkDragMove): void {
    this.drag.trackPointerFromEvent(event.event);
  }

  protected _onDragEnded(event: CdkDragEnd): void {
    event.source.reset();
    this.drag.commitAndEnd();
  }

  protected _toggle(): void {
    this.expand.toggle(this.node());
  }
}
