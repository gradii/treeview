import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  forwardRef,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Collapse } from './collapse';
import { Row } from './row';
import { BlockNode, CollapseNode, RowNode } from './tree-model';

const LAZY_LOAD_DEBOUNCE_MS = 200;

type VisibleBlockChild =
  | { kind: 'row'; key: string; node: RowNode; top: number }
  | { kind: 'block'; key: string; node: BlockNode; top: number }
  | { kind: 'collapse'; key: string; node: CollapseNode; top: number };

interface PlaceholderSlot {
  key: string;
  top: number;
  height: number;
}

/**
 * Renders a Block — a virtualization container that is a real DOM element with
 * `position: absolute` and an explicit height. May hold either RowNodes (leaf
 * block) or further BlockNodes (group block).
 *
 * Leaf blocks render ALL their rows unconditionally (no per-row viewport
 * culling). Rows use normal document flow inside the block container.
 *
 * Group blocks still cull child sub-blocks against the viewport — only
 * sub-blocks whose absolute position intersects the viewport are rendered.
 * Child sub-block `top` values are relative to this block's container.
 */
@Component({
  selector: 'app-block',
  imports: [Row, forwardRef(() => Collapse)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.top.px]': 'offset()',
    '[style.height.px]': 'height()',
  },
  template: `
    @for (item of visibleChildren(); track item.key) {
      @switch (item.kind) {
        @case ('row') {
          <app-row
            [row]="item.node"
            [top]="item.top"
            [depth]="rowDepth()"
          />
        }
        @case ('block') {
          <app-block
            [block]="item.node"
            [offset]="item.top"
            [absoluteOrigin]="absoluteTop()"
            [viewportTop]="viewportTop()"
            [viewportBottom]="viewportBottom()"
            [rowDepth]="rowDepth()"
          />
        }
        @case ('collapse') {
          <app-collapse
            [node]="item.node"
            [offset]="item.top"
            [absoluteOrigin]="absoluteTop()"
            [viewportTop]="viewportTop()"
            [viewportBottom]="viewportBottom()"
          />
        }
      }
    }
    @if (isLeaf()) {
      @for (slot of placeholderSlots(); track slot.key) {
        <div
          class="tv-placeholder"
          [class.is-idle]="loadState() === 'idle'"
          [class.is-loading]="loadState() === 'loading'"
          [class.has-error]="loadState() === 'error'"
          [style.top.px]="slot.top"
          [style.height.px]="slot.height"
          [style.--tv-depth]="rowDepth()"
          aria-hidden="true"
        >
          <span class="placeholder-shimmer"></span>
        </div>
      }
    }
  `,
  styles: `
    :host {
      position: absolute;
      left: 0;
      right: 0;
    }

    .tv-placeholder {
      display: flex;
      position: absolute;
      left: 0;
      right: 0;
      align-items: center;
      padding-left: calc(
        var(--tv-indent-base) + var(--tv-depth, 0) * var(--tv-indent-step)
      );
      padding-right: var(--tv-padding-x);
      background: var(--tv-bg-row);
      border-bottom: 1px solid var(--tv-border-soft);
      box-sizing: border-box;
    }

    /* Smooth fade-in for placeholders */
    :host-context(.tv-animate) .tv-placeholder {
      animation: tv-fade-in 300ms var(--tv-anim-easing);
    }

    @keyframes tv-fade-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .tv-placeholder.has-error {
      background: var(--tv-bg-error);
    }

    .placeholder-shimmer {
      display: block;
      flex: 1 1 auto;
      height: 10px;
      border-radius: 3px;
      background: linear-gradient(
          90deg,
          var(--tv-shimmer-from) 0%,
          var(--tv-shimmer-mid) 50%,
          var(--tv-shimmer-from) 100%
      );
      background-size: 200% 100%;
      animation: tv-shimmer 1.2s linear infinite;
    }

    .tv-placeholder.is-idle .placeholder-shimmer,
    .tv-placeholder.has-error .placeholder-shimmer {
      animation: none;
      background: var(--tv-shimmer-from);
    }

    .tv-placeholder.has-error .placeholder-shimmer {
      background: var(--tv-shimmer-error);
    }

    @keyframes tv-shimmer {
      0% {
        background-position: 100% 0;
      }
      100% {
        background-position: -100% 0;
      }
    }
  `,
})
export class Block {
  readonly block = input.required<BlockNode>();
  /** Top offset relative to the parent container. */
  readonly offset = input.required<number>();
  /** Top edge of the effective viewport (in canvas coordinates). */
  readonly viewportTop = input.required<number>();
  /** Bottom edge of the effective viewport (in canvas coordinates). */
  readonly viewportBottom = input.required<number>();
  /**
   * Depth (integer) for any RowNode rendered inside this Block. Set on the
   * row's `--tv-depth` CSS variable so indentation respects the active size
   * variant via CSS calc, instead of being hard-coded in JS.
   */
  readonly rowDepth = input<number>(0);

  protected readonly height = computed(() => this.block().height());
  protected readonly loadState = computed(() => this.block().loadState());

  /**
   * The absolute Y of this block's top edge in canvas coordinates.
   * Computed by walking parent offsets. The root Collapse passes absolute
   * coordinates via `absoluteOrigin`; nested blocks accumulate from there.
   */
  protected readonly absoluteTop = computed(() => this.absoluteOrigin() + this.offset());

  /**
   * Absolute canvas-Y origin of the parent container. Passed down so each
   * level can compute its own absoluteTop for viewport intersection tests.
   */
  readonly absoluteOrigin = input<number>(0);

  /** True when no sub-block children — i.e. rows / collapses only, the
   *  "leaf-like" mode where placeholder slots for unloaded rows apply. */
  protected readonly isLeaf = computed(() => {
    const children = this.block().children();
    for (const c of children) {
      if (c.kind === 'block') return false;
    }
    return true;
  });

  /**
   * Visible children with each one's `top` resolved as a running offset
   * inside this block. All three kinds (row / sub-block / collapse) share
   * the same absolute-positioning model now — Row's host carries
   * `position: absolute; top: …` just like Block and Collapse — so the
   * Block component renders them uniformly via switch. Sub-blocks /
   * collapses are still viewport-culled; rows are kept always so
   * intra-block focus-scrolling still finds them.
   */
  protected readonly visibleChildren = computed<VisibleBlockChild[]>(() => {
    const children = this.block().children();
    const absTop = this.absoluteTop();
    const vt = this.viewportTop();
    const vb = this.viewportBottom();
    let cursor = 0;
    const out: VisibleBlockChild[] = [];
    for (const c of children) {
      if (c.kind === 'row') {
        const h = c.renderSize();
        if (c.invisible() === 0) {
          out.push({kind: 'row', key: c.id, node: c, top: cursor});
        }
        cursor += h;
        continue;
      }
      const h = c.height();
      if (h === 0) continue;
      const childAbsTop = absTop + cursor;
      const childAbsBot = childAbsTop + h;
      if (childAbsBot > vt && childAbsTop < vb) {
        if (c.kind === 'block') {
          out.push({kind: 'block', key: c.id, node: c, top: cursor});
        } else {
          out.push({kind: 'collapse', key: c.id, node: c, top: cursor});
        }
      }
      cursor += h;
    }
    return out;
  });

  /**
   * Placeholder slots for unloaded rows in leaf-like blocks. Slot tops are
   * pinned right after the loaded rows since the parent block now uses
   * absolute positioning for everything.
   */
  protected readonly placeholderSlots = computed<PlaceholderSlot[]>(() => {
    const b = this.block();
    const children = b.children();
    const remaining = Math.max(0, b.totalRowCount() - children.length);
    if (remaining === 0) return [];
    const size = b.defaultRowSize();
    let cursor = 0;
    for (const c of children) {
      cursor += c.kind === 'row' ? c.renderSize() : c.height();
    }
    const out: PlaceholderSlot[] = [];
    for (let i = 0; i < remaining; i++) {
      out.push({
        key: `${b.id}:ph:${i}`,
        top: cursor + i * size,
        height: size,
      });
    }
    return out;
  });

  protected readonly visible = computed(() => {
    const top = this.absoluteTop();
    const bottom = top + this.height();
    return bottom > this.viewportTop() && top < this.viewportBottom();
  });

  constructor() {
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelTimer = () => {
      if (loadTimer !== null) {
        clearTimeout(loadTimer);
        loadTimer = null;
      }
    };
    effect(() => {
      const isVisible = this.visible();
      const state = this.block().loadState();
      if (isVisible && state === 'idle') {
        if (loadTimer !== null) return;
        loadTimer = setTimeout(() => {
          loadTimer = null;
          untracked(() => {
            if (this.visible() && this.block().loadState() === 'idle') {
              this.block().ensureLoaded();
            }
          });
        }, LAZY_LOAD_DEBOUNCE_MS);
      } else {
        cancelTimer();
      }
    });
    inject(DestroyRef).onDestroy(cancelTimer);
  }
}
