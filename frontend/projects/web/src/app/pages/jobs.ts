import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, ApiError, AuthService, humanize, LabelPipe, OPTIONS, Page } from '@gh/core';
import { DrawerComponent, EmptyStateComponent, IconComponent, JobCardComponent, JobCardData, SkeletonComponent, ToastService } from '@gh/ui';
import { map } from 'rxjs';

type Filters = Record<'q' | 'city' | 'workMode' | 'employmentType' | 'expMax' | 'postedWithin' | 'salaryMin' | 'sort', string>;
const KEYS: (keyof Filters)[] = ['q', 'city', 'workMode', 'employmentType', 'expMax', 'postedWithin', 'salaryMin', 'sort'];

@Component({
  selector: 'app-jobs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, JobCardComponent, IconComponent, DrawerComponent, SkeletonComponent, EmptyStateComponent, LabelPipe],
  template: `
    <div class="container page-pad">
      <form class="searchbar card card-tight" role="search" (ngSubmit)="apply({ q: q, city: city })">
        <div class="field grow"><label class="sr-only" for="q">Keyword</label>
          <input id="q" class="input" name="q" [(ngModel)]="q" placeholder="Job title, skill or company" /></div>
        <div class="field city"><label class="sr-only" for="city">City</label>
          <input id="city" class="input" name="city" [(ngModel)]="city" placeholder="City" list="cities" />
          <datalist id="cities">@for (c of cities; track c) { <option [value]="c"></option> }</datalist></div>
        <button class="btn btn-primary" type="submit"><gh-icon name="search" [size]="16" />Search</button>
      </form>

      <div class="row filters" role="group" aria-label="Quick filters">
        @for (m of workModes; track m) {
          <button type="button" class="chip" [attr.aria-pressed]="f().workMode === m" (click)="apply({ workMode: f().workMode === m ? '' : m })">{{ m | label }}</button>
        }
        <button type="button" class="chip" [attr.aria-pressed]="f().expMax === '12'" (click)="apply({ expMax: f().expMax === '12' ? '' : '12' })">Fresher (0–1 yr)</button>
        <button type="button" class="chip" [attr.aria-pressed]="f().employmentType === 'INTERNSHIP'" (click)="apply({ employmentType: f().employmentType === 'INTERNSHIP' ? '' : 'INTERNSHIP' })">Internships</button>
        <button type="button" class="chip" (click)="drawer.set(true)"><gh-icon name="sliders" [size]="14" />All filters{{ extraCount() ? ' (' + extraCount() + ')' : '' }}</button>
        <div class="grow"></div>
        <label class="caption" for="sort">Sort</label>
        <select id="sort" class="select sort" [ngModel]="f().sort || 'relevance'" (ngModelChange)="apply({ sort: $event === 'relevance' ? '' : $event })">
          <option value="relevance">Most relevant</option><option value="recent">Most recent</option>
        </select>
      </div>

      @if (active().length) {
        <div class="row-sm" style="margin-bottom:16px">
          @for (a of active(); track a.key) {
            <span class="chip active">{{ a.label }}<button type="button" class="x" (click)="remove(a.key)" [attr.aria-label]="'Remove ' + a.label">×</button></span>
          }
          <button class="btn btn-link btn-sm" type="button" (click)="clear()">Clear all</button>
        </div>
      }

      <p class="caption count" aria-live="polite">
        @if (status() === 'ready' || status() === 'empty') { {{ total() }} job{{ total() === 1 ? '' : 's' }} found }
      </p>

      @switch (status()) {
        @case ('loading') { <gh-skeleton variant="cards" /> }
        @case ('error') { <div class="card"><gh-empty icon="alert" title="Couldn't load jobs" [text]="error()"><button class="btn btn-secondary" (click)="load()">Try again</button></gh-empty></div> }
        @case ('empty') {
          <div class="card"><gh-empty icon="search" title="No jobs found" text="Try removing a filter or searching a broader keyword.">
            @if (active().length) { <button class="btn btn-secondary" (click)="clear()">Clear filters</button> }</gh-empty></div>
        }
        @default {
          <div class="grid-auto">
            @for (j of jobs(); track j.id) {
              <gh-job-card [job]="j" [showSave]="auth.signedIn()" [saved]="saved().has(j.id)" (save)="toggleSave($event)" />
            }
          </div>
          @if (cursor()) {
            <div class="row" style="justify-content:center;margin-top:24px">
              <button class="btn btn-secondary" type="button" (click)="more()" [disabled]="loadingMore()">@if (loadingMore()) { <span class="spinner"></span> } Load more jobs</button>
            </div>
          }
        }
      }
    </div>

    <gh-drawer [open]="drawer()" title="All filters" (closed)="drawer.set(false)">
      <form class="stack" (ngSubmit)="applyDrawer()">
        <div class="field"><label for="et">Employment type</label>
          <select id="et" class="select" name="et" [(ngModel)]="d.employmentType"><option value="">Any</option>
            @for (t of types; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
        <div class="field"><label for="exp">Experience</label>
          <select id="exp" class="select" name="exp" [(ngModel)]="d.expMax"><option value="">Any</option>
            <option value="0">Fresher only</option><option value="12">Up to 1 year</option><option value="24">Up to 2 years</option><option value="36">Up to 3 years</option></select></div>
        <div class="field"><label for="sal">Minimum salary (LPA)</label>
          <select id="sal" class="select" name="sal" [(ngModel)]="d.salaryMin"><option value="">Any</option>
            @for (s of [2, 3, 4, 5, 6, 8, 10]; track s) { <option [value]="s * 10000000">{{ s }} LPA+</option> }</select></div>
        <div class="field"><label for="pw">Posted</label>
          <select id="pw" class="select" name="pw" [(ngModel)]="d.postedWithin"><option value="">Any time</option>
            <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></div>
        <div class="form-actions"><button class="btn btn-secondary" type="button" (click)="drawer.set(false)">Cancel</button>
          <button class="btn btn-primary" type="submit">Show results</button></div>
      </form>
    </gh-drawer>`,
  styles: `
    .page-pad { padding-top: 24px; }
    .searchbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
    .searchbar .city { width: 220px; }
    .filters { margin-bottom: 12px; }
    .sort { width: auto; min-height: 34px; padding: 4px 8px; font-size: var(--fs-body) !important; }
    .count { min-height: 18px; margin-bottom: 12px; }
    @media (max-width: 640px) { .searchbar { flex-wrap: wrap; } .searchbar .city { width: 100%; } .searchbar button { width: 100%; } }`,
})
export class JobsPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly cities = OPTIONS.cities;
  protected readonly workModes = OPTIONS.workMode;
  protected readonly types = OPTIONS.employmentType;

  protected readonly f = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((m) => Object.fromEntries(KEYS.map((k) => [k, m.get(k) ?? ''])) as Filters)),
    { requireSync: true },
  );
  protected q = '';
  protected city = '';
  protected d = { employmentType: '', expMax: '', salaryMin: '', postedWithin: '' };

  protected readonly jobs = signal<JobCardData[]>([]);
  protected readonly total = signal(0);
  protected readonly cursor = signal<string | null>(null);
  protected readonly status = signal<'loading' | 'ready' | 'empty' | 'error'>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly drawer = signal(false);
  protected readonly saved = signal(new Set<string>());

  protected readonly active = computed(() => {
    const f = this.f();
    const out: { key: keyof Filters; label: string }[] = [];
    if (f.q) out.push({ key: 'q', label: `"${f.q}"` });
    if (f.city) out.push({ key: 'city', label: f.city });
    if (f.workMode) out.push({ key: 'workMode', label: humanize(f.workMode) });
    if (f.employmentType) out.push({ key: 'employmentType', label: humanize(f.employmentType) });
    if (f.expMax) out.push({ key: 'expMax', label: f.expMax === '0' ? 'Fresher only' : `Up to ${+f.expMax / 12} yr` });
    if (f.salaryMin) out.push({ key: 'salaryMin', label: `${+f.salaryMin / 10000000}+ LPA` });
    if (f.postedWithin) out.push({ key: 'postedWithin', label: `Last ${f.postedWithin} day${f.postedWithin === '1' ? '' : 's'}` });
    return out;
  });
  protected readonly extraCount = computed(() => ['employmentType', 'salaryMin', 'postedWithin'].filter((k) => this.f()[k as keyof Filters]).length);

  constructor() {
    effect(() => {
      const f = this.f();
      this.q = f.q;
      this.city = f.city;
      this.d = { employmentType: f.employmentType, expMax: f.expMax, salaryMin: f.salaryMin, postedWithin: f.postedWithin };
      void this.load();
    });
    if (this.auth.signedIn()) {
      this.api.get<{ jobId: string }[]>('/candidate/saved-jobs').then((s) => this.saved.set(new Set(s.map((x) => x.jobId)))).catch(() => {});
    }
  }

  async load() {
    this.status.set('loading');
    try {
      const r = await this.api.get<Page<JobCardData>>('/jobs', { ...this.f(), limit: 20 });
      this.jobs.set(r.data);
      this.total.set(r.totalEstimate ?? r.data.length);
      this.cursor.set(r.page.nextCursor);
      this.status.set(r.data.length ? 'ready' : 'empty');
    } catch (e) {
      this.error.set(ApiError.from(e).message);
      this.status.set('error');
    }
  }

  async more() {
    this.loadingMore.set(true);
    try {
      const r = await this.api.get<Page<JobCardData>>('/jobs', { ...this.f(), limit: 20, cursor: this.cursor() });
      this.jobs.update((j) => [...j, ...r.data]);
      this.cursor.set(r.page.nextCursor);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loadingMore.set(false);
    }
  }

  apply(patch: Partial<Filters>) {
    const next = { ...this.f(), ...patch };
    const qp = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, (v as string)?.trim() || null]));
    void this.router.navigate([], { queryParams: qp });
  }
  remove(key: keyof Filters) {
    this.apply({ [key]: '' });
  }
  applyDrawer() {
    this.drawer.set(false);
    this.apply(this.d);
  }
  clear() {
    void this.router.navigate([], { queryParams: {} });
  }

  async toggleSave(id: string) {
    const isSaved = this.saved().has(id);
    try {
      if (isSaved) await this.api.delete(`/candidate/saved-jobs/${id}`);
      else await this.api.put(`/candidate/saved-jobs/${id}`);
      this.saved.update((s) => {
        const n = new Set(s);
        if (isSaved) n.delete(id);
        else n.add(id);
        return n;
      });
      this.toast.success(isSaved ? 'Removed from saved jobs' : 'Job saved');
    } catch (e) {
      this.toast.error(e);
    }
  }
}
