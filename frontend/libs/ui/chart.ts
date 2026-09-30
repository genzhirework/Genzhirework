import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface ChartPoint {
  label: string;
  value: number;
}

/**
 * Minimal SVG bar chart (DataChart). No chart library: dashboards stay fast and
 * every chart has a "View as table" fallback for screen readers and exports.
 */
@Component({
  selector: 'gh-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart card">
      <div class="row between" style="margin-bottom:12px">
        <div><h4>{{ title() }}</h4><span class="caption">Total {{ total() }}</span></div>
        <button class="btn btn-ghost btn-sm" type="button" (click)="asTable.update((v) => !v)">{{ asTable() ? 'View as chart' : 'View as table' }}</button>
      </div>
      @if (asTable()) {
        <div class="table-wrap" style="max-height:220px;overflow:auto">
          <table class="table table-compact"><thead><tr><th>Date</th><th class="num">{{ title() }}</th></tr></thead>
            <tbody>@for (p of data(); track p.label) { <tr><td>{{ p.label }}</td><td class="num">{{ p.value }}</td></tr> }</tbody></table>
        </div>
      } @else {
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" role="img" [attr.aria-label]="summary()" class="svg">
          @for (t of ticks(); track t) {
            <line [attr.x1]="0" [attr.x2]="W" [attr.y1]="y(t)" [attr.y2]="y(t)" class="grid" />
          }
          @for (p of data(); track p.label; let i = $index) {
            <rect [attr.x]="i * step() + step() * 0.18" [attr.width]="step() * 0.64" [attr.y]="y(p.value)" [attr.height]="H - y(p.value)" rx="2" class="bar">
              <title>{{ p.label }}: {{ p.value }}</title>
            </rect>
          }
        </svg>
        <div class="row between caption axis"><span>{{ data()[0]?.label }}</span><span>max {{ max() }}</span><span>{{ data()[data().length - 1]?.label }}</span></div>
      }
    </div>`,
  styles: `
    .svg { width: 100%; height: 160px; display: block; }
    .bar { fill: var(--electric); opacity: 0.9; } .bar:hover { opacity: 1; fill: var(--highlight); }
    .grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .axis { margin-top: 6px; }`,
})
export class BarChartComponent {
  readonly title = input.required<string>();
  readonly data = input<ChartPoint[]>([]);
  protected readonly W = 600;
  protected readonly H = 160;
  protected readonly asTable = signal(false);
  protected readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));
  protected readonly total = computed(() => this.data().reduce((s, d) => s + d.value, 0));
  protected readonly step = computed(() => this.W / Math.max(1, this.data().length));
  protected readonly ticks = computed(() => [0.25, 0.5, 0.75, 1].map((f) => Math.round(this.max() * f)));
  protected readonly summary = computed(() => `${this.title()}: total ${this.total()}, peak ${this.max()} over ${this.data().length} days`);
  protected y(v: number) {
    return this.H - (v / this.max()) * (this.H - 8);
  }
}
