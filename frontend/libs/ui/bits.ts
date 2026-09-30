import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { statusOf } from '@gh/core';
import { IconComponent } from './icon';

@Component({
  selector: 'gh-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="'badge badge-' + def().tone"><span class="dot"></span>{{ def().label }}</span>`,
})
export class StatusBadgeComponent {
  readonly kind = input.required<string>();
  readonly value = input<string | null | undefined>();
  readonly audience = input<'candidate' | undefined>();
  protected readonly def = computed(() => statusOf(this.kind(), this.value(), this.audience()));
}

const HUES = ['#0A6BDB', '#7A5AF8', '#0E9384', '#C4320A', '#B54708', '#475467'];

@Component({
  selector: 'gh-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="avatar" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size() * 0.38"
      [style.background]="color()" [attr.aria-label]="label() || null" [attr.role]="label() ? 'img' : null"
      [attr.aria-hidden]="label() ? null : 'true'">{{ initials() }}</span>`,
})
export class AvatarComponent {
  readonly name = input<string | null | undefined>('');
  readonly seed = input<string | null | undefined>('');
  readonly size = input(40);
  readonly label = input<string | null>(null);
  protected readonly initials = computed(() => {
    const parts = (this.name() ?? '').replace(/[^A-Za-z .]/g, '').split(/[ .]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  });
  protected readonly color = computed(() => {
    const s = this.seed() || this.name() || '';
    let h = 0;
    for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[h % HUES.length];
  });
}

@Component({
  selector: 'gh-stat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="card card-tight stat">
      <div class="row between">
        <span class="label">{{ label() }}</span>
        @if (icon()) { <gh-icon [name]="icon()!" [size]="16" class="muted" /> }
      </div>
      <span class="value">{{ value() ?? '—' }}</span>
      @if (hint()) { <span class="caption">{{ hint() }}</span> }
    </div>`,
})
export class StatTileComponent {
  readonly label = input.required<string>();
  readonly value = input<string | number | null | undefined>();
  readonly hint = input<string | null>(null);
  readonly icon = input<string | null>(null);
}

@Component({
  selector: 'gh-credit-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meter" role="meter" [attr.aria-valuenow]="remaining()" aria-valuemin="0" [attr.aria-valuemax]="total()"
         [attr.aria-label]="'Profile view credits remaining'">
      <div class="row-sm between">
        <strong class="tabular">{{ remaining() }}</strong>
        <span class="caption">of {{ total() }} profile views left</span>
      </div>
      <div class="progress" [class.warn]="remaining() > 0 && remaining() <= 10" [class.danger]="remaining() === 0">
        <span [style.width.%]="pct()"></span>
      </div>
    </div>`,
  styles: `.meter { display: flex; flex-direction: column; gap: 6px; min-width: 180px; }`,
})
export class CreditMeterComponent {
  readonly remaining = input(0);
  readonly total = input(0);
  protected readonly pct = computed(() => (this.total() ? (this.remaining() / this.total()) * 100 : 0));
}

@Component({
  selector: 'gh-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="empty">
      <gh-icon [name]="icon()" [size]="44" [stroke]="1.5" />
      <h3>{{ title() }}</h3>
      @if (text()) { <p>{{ text() }}</p> }
      <div class="row" style="justify-content:center;margin-top:8px"><ng-content /></div>
    </div>`,
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly text = input<string | null>(null);
  readonly icon = input('inbox');
}

@Component({
  selector: 'gh-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('table') {
        <div class="table-wrap" aria-hidden="true">
          @for (r of rows(); track $index) {
            <div class="row" style="padding:14px 16px;border-bottom:1px solid var(--border)">
              <div class="skeleton" style="height:14px;width:28%"></div>
              <div class="skeleton" style="height:14px;width:18%"></div>
              <div class="skeleton" style="height:14px;width:14%;margin-left:auto"></div>
            </div>
          }
        </div>
      }
      @case ('cards') {
        <div class="grid-auto" aria-hidden="true">
          @for (r of rows(); track $index) {
            <div class="card stack-sm"><div class="skeleton" style="height:16px;width:60%"></div>
              <div class="skeleton" style="height:12px;width:40%"></div><div class="skeleton" style="height:12px;width:80%"></div></div>
          }
        </div>
      }
      @default {
        <div class="card stack" aria-hidden="true">
          <div class="skeleton" style="height:22px;width:40%"></div>
          @for (r of rows(); track $index) { <div class="skeleton" style="height:13px" [style.width.%]="90 - $index * 9"></div> }
        </div>
      }
    }`,
})
export class SkeletonComponent {
  readonly variant = input<'table' | 'cards' | 'detail'>('detail');
  readonly count = input(5);
  protected readonly rows = computed(() => Array.from({ length: this.count() }));
}
