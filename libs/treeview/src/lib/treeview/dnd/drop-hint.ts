import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TreeDragService } from './tree-drag.service';

/**
 * Floating 2-px horizontal line drawn at the top edge (for `before`) or
 * bottom edge (for `after`) of the currently-targeted row. Positioned in
 * viewport coordinates via `getBoundingClientRect`, then converted back to
 * scroller-local coords using the host scroller's rect.
 *
 * Rendered inside the LargeTreeView's overlay layer (a `position: absolute`
 * div that covers the scroller). The host passes its own clientTop / scroller
 * scrollTop so we can place the hint relative to the canvas — not the
 * viewport — which keeps the hint anchored while CDK auto-scrolls.
 */
@Component({
  selector: 'app-drop-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (linePlacement(); as p) {
      <div
        class="tv-drop-hint"
        [style.top.px]="p.top"
        [style.left.px]="p.left"
        [style.width.px]="p.width"
        aria-hidden="true"
      ></div>
    }
    @if (overPlacement(); as p) {
      <div
        class="tv-drop-over"
        [style.top.px]="p.top"
        [style.left.px]="p.left"
        [style.width.px]="p.width"
        [style.height.px]="p.height"
        aria-hidden="true"
      ></div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 200;
      overflow: hidden;
    }
    .tv-drop-hint {
      position: absolute;
      height: 2px;
      background: #0969da;
      box-shadow: 0 0 0 1px rgba(9, 105, 218, 0.35);
      border-radius: 1px;
    }
    .tv-drop-hint::before,
    .tv-drop-hint::after {
      content: '';
      position: absolute;
      top: -3px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #0969da;
    }
    .tv-drop-hint::before {
      left: -4px;
    }
    .tv-drop-hint::after {
      right: -4px;
    }
    .tv-drop-over {
      position: absolute;
      box-sizing: border-box;
      border: 2px solid #0969da;
      border-radius: 4px;
      background: rgba(9, 105, 218, 0.08);
    }
  `,
})
export class DropHint {
  /** Scroller element used to translate viewport-relative coords to local. */
  readonly scrollerRect = input.required<DOMRect | null>();

  private readonly drag = inject(TreeDragService);

  /** Used when `position` is `before` or `after` — a 2px line at the edge. */
  protected readonly linePlacement = computed<
    | { top: number; left: number; width: number }
    | null
  >(() => {
    const target = this.drag.target();
    const rect = this.scrollerRect();
    if (target === null || rect === null) return null;
    if (target.position === 'over') return null;
    const elementRect = target.element.getBoundingClientRect();
    const top =
      target.position === 'before'
        ? elementRect.top - rect.top
        : elementRect.bottom - rect.top;
    return {
      top,
      left: elementRect.left - rect.left,
      width: elementRect.width,
    };
  });

  /** Used when `position` is `over` — a rectangle outline around the row. */
  protected readonly overPlacement = computed<
    | { top: number; left: number; width: number; height: number }
    | null
  >(() => {
    const target = this.drag.target();
    const rect = this.scrollerRect();
    if (target === null || rect === null) return null;
    if (target.position !== 'over') return null;
    const elementRect = target.element.getBoundingClientRect();
    return {
      top: elementRect.top - rect.top,
      left: elementRect.left - rect.left,
      width: elementRect.width,
      height: elementRect.height,
    };
  });
}
