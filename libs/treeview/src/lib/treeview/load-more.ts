import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TreeViewInstance } from './state/id.service';
import { NavigationController } from './state/navigation';
import { LoadMoreNode } from './tree-model';

/**
 * Trailer button for a CollapseNode that fetches/reveals more children. Like
 * a floating Row visually, but driven by `LoadMoreNode.load()`. Idempotent:
 * clicking while loading is a no-op (the underlying node returns the in-flight
 * promise).
 */
@Component({
  selector: 'app-load-more',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.top.px]': 'absoluteTop()',
    '[style.height.px]': 'node().renderSize()',
  },
  template: `
    <div
      class="tv-load-more"
      [class.is-loading]="loadState() === 'loading'"
      [class.has-error]="loadState() === 'error'"
      [class.is-active]="isActive()"
      [id]="domId()"
      [style.height.px]="node().renderSize()"
      [style.--tv-depth]="depth()"
      role="button"
      tabindex="0"
      [attr.aria-level]="level()"
      [attr.aria-posinset]="posInSet()"
      [attr.aria-setsize]="setSize()"
      [attr.aria-busy]="loadState() === 'loading' ? true : null"
      [attr.aria-disabled]="loadState() === 'loading' ? true : null"
      (click)="onClick($event)"
      (keydown)="onKey($event)"
    >
      @if (loadState() === 'loading') {
        <span class="spinner" aria-hidden="true"></span>
      } @else {
        <span class="icon" aria-hidden="true">+</span>
      }
      <span class="label">{{ buttonText() }}</span>
      @if (remainingLabel(); as r) {
        <span class="meta">{{ r }}</span>
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
    .tv-load-more {
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
      color: var(--tv-accent);
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      box-sizing: border-box;
    }

    /* Smooth transitions for load-more state changes */
    :host-context(.tv-animate) .tv-load-more {
      transition: background var(--tv-anim-duration) var(--tv-anim-easing),
                  color var(--tv-anim-duration) var(--tv-anim-easing),
                  box-shadow var(--tv-anim-duration) var(--tv-anim-easing);
    }

    .tv-load-more:hover {
      background: var(--tv-bg-hover);
    }
    .tv-load-more.is-loading {
      color: var(--tv-text-muted);
      cursor: progress;
    }
    .tv-load-more.has-error {
      color: var(--tv-text-error);
      background: var(--tv-bg-error);
    }
    .tv-load-more.is-active {
      box-shadow: inset 2px 0 0 var(--tv-accent);
      background: var(--tv-accent-soft);
    }
    .tv-load-more .icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--tv-icon-size);
      height: var(--tv-icon-size);
      border-radius: 50%;
      border: 1px solid currentColor;
      font-size: 0.8em;
      line-height: 1;
    }

    /* Smooth scale animation for the icon */
    :host-context(.tv-animate) .tv-load-more .icon {
      transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .tv-load-more:hover .icon {
      transform: scale(1.1);
    }

    .tv-load-more .label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tv-load-more .meta {
      font-size: var(--tv-meta-font);
      color: var(--tv-text-muted);
      font-weight: 400;
    }
    .tv-load-more .spinner {
      width: var(--tv-icon-size);
      height: var(--tv-icon-size);
      border: 2px solid var(--tv-border);
      border-top-color: var(--tv-accent);
      border-radius: 50%;
      animation: tv-spin 0.8s linear infinite;
    }
    @keyframes tv-spin {
      to { transform: rotate(360deg); }
    }
  `,
})
export class LoadMore {
  readonly node = input.required<LoadMoreNode>();
  readonly absoluteTop = input<number>(0);
  /** Visual depth used for indentation (`--tv-depth` CSS variable). */
  readonly depth = input<number>(0);

  private readonly navigation = inject(NavigationController);
  private readonly instance = inject(TreeViewInstance);

  protected readonly loadState = computed(() => this.node().loadState());

  protected readonly isActive = computed(() =>
    this.navigation.isActive(this.node()),
  );

  protected readonly domId = computed(() => this.instance.domIdFor(this.node().id));
  protected readonly level = computed(() => this.navigation.ariaLevel(this.node()));
  protected readonly posInSet = computed(
    () => this.navigation.ariaPosition(this.node())?.posInSet ?? null,
  );
  protected readonly setSize = computed(
    () => this.navigation.ariaPosition(this.node())?.setSize ?? null,
  );

  protected readonly buttonText = computed<string>(() => {
    const state = this.node().loadState();
    if (state === 'loading') return 'Loading…';
    if (state === 'error') return 'Failed — retry';
    return this.node().label();
  });

  /** Shows the remaining count when known; hidden when totalCount is infinite. */
  protected readonly remainingLabel = computed<string | null>(() => {
    const total = this.node().totalCount();
    if (!Number.isFinite(total)) return null;
    const remaining = Math.max(0, total - this.node().loadedCount());
    if (remaining === 0) return null;
    return `${remaining} more`;
  });

  protected onClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigation.setActive(this.node());
    if (this.node().loadState() === 'loading') return;
    this.node().load();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    this.navigation.setActive(this.node());
    if (this.node().loadState() === 'loading') return;
    this.node().load();
  }
}
