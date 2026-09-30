import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, DatePipe, isEmptyArray, LabelPipe, loader, lpaToPaise, OPTIONS, paiseToLpa } from '@gh/core';
import {
  ConfirmService, IconComponent, JobCardComponent, JobCardData, PageStateComponent, Skill, SkillPickerComponent, StatusBadgeComponent,
  ToastService,
} from '@gh/ui';

interface JobRow {
  id: string;
  title: string;
  status: string;
  workMode: string;
  employmentType: string;
  openings: number;
  publishedAt: string | null;
  createdAt: string;
  applicationDeadline: string | null;
  moderationReason: string | null;
  cities: string[];
  applicants: number;
  newApplicants: number;
}

const ACTIONS: Record<string, { action: string; label: string }[]> = {
  DRAFT: [{ action: 'submit', label: 'Submit for publishing' }, { action: 'close', label: 'Close' }],
  REJECTED: [{ action: 'submit', label: 'Resubmit' }],
  PENDING_APPROVAL: [{ action: 'close', label: 'Close' }],
  PUBLISHED: [{ action: 'pause', label: 'Pause' }, { action: 'close', label: 'Close' }],
  PAUSED: [{ action: 'resume', label: 'Resume' }, { action: 'close', label: 'Close' }],
  CLOSED: [],
};

@Component({
  selector: 'app-jobs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, IconComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Jobs</h1><p>Post and manage your openings.</p></div>
        <a class="btn btn-primary" routerLink="/jobs/new"><gh-icon name="plus" [size]="16" />Post a job</a></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">
        @for (t of tabs; track t.key) {
          <button class="tab" role="tab" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}<span class="count">{{ count(t.key) }}</span></button>
        }
      </div>
      <gh-page-state [state]="jobs" skeleton="table" emptyTitle="No jobs yet" emptyText="Post your first job to start receiving applications." emptyIcon="briefcase">
        <a empty class="btn btn-primary" routerLink="/jobs/new">Post a job</a>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Job</th><th>Status</th><th class="num">Applicants</th><th>Posted</th><th>Deadline</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              @for (j of filtered(); track j.id) {
                <tr>
                  <td><a class="row-link" [routerLink]="['/jobs', j.id, 'applications']">{{ j.title }}</a>
                    <div class="caption">{{ j.cities.join(', ') }} · {{ j.workMode | label }} · {{ j.employmentType | label }}</div>
                    @if (j.moderationReason && j.status === 'REJECTED') { <div class="caption" style="color:var(--danger)">{{ j.moderationReason }}</div> }</td>
                  <td><gh-status kind="job" [value]="j.status" /></td>
                  <td class="num"><a [routerLink]="['/jobs', j.id, 'applications']">{{ j.applicants }}</a>@if (j.newApplicants) { <span class="badge badge-primary" style="margin-left:6px">{{ j.newApplicants }} new</span> }</td>
                  <td class="caption">{{ j.publishedAt | ghDate }}</td>
                  <td class="caption">{{ j.applicationDeadline | ghDate }}</td>
                  <td><div class="row-sm" style="justify-content:flex-end">
                    @if (j.status !== 'CLOSED') { <a class="btn btn-ghost btn-sm" [routerLink]="['/jobs', j.id, 'edit']">Edit</a> }
                    @for (a of actions(j.status); track a.action) { <button class="btn btn-ghost btn-sm" type="button" (click)="act(j, a.action)">{{ a.label }}</button> }
                  </div></td>
                </tr>
              } @empty { <tr><td colspan="6" class="caption" style="height:72px;text-align:center">No jobs with this status.</td></tr> }
            </tbody>
          </table>
        </div>
      </gh-page-state>
    </div>`,
})
export class JobsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly jobs = loader(() => this.api.get<JobRow[]>('/employer/jobs'), isEmptyArray);
  protected readonly tab = signal('ALL');
  protected readonly tabs = [
    { key: 'ALL', label: 'All' }, { key: 'PUBLISHED', label: 'Published' }, { key: 'PENDING_APPROVAL', label: 'Pending' },
    { key: 'DRAFT', label: 'Drafts' }, { key: 'PAUSED', label: 'Paused' }, { key: 'CLOSED', label: 'Closed' },
  ];
  protected readonly filtered = computed(() => (this.jobs.data() ?? []).filter((j) => this.tab() === 'ALL' || j.status === this.tab() || (this.tab() === 'DRAFT' && j.status === 'REJECTED')));
  protected count = (k: string) => (this.jobs.data() ?? []).filter((j) => k === 'ALL' || j.status === k).length;
  protected actions = (s: string) => ACTIONS[s] ?? [];

  async act(j: JobRow, action: string) {
    if (action === 'close' && !(await this.confirm.confirm({ title: `Close "${j.title}"?`, message: 'Candidates will no longer be able to apply. Existing applications stay available.', confirmText: 'Close job', tone: 'danger' }))) return;
    try {
      const r = await this.api.post<{ status: string }>(`/employer/jobs/${j.id}/${action}`);
      this.toast.success(r.status === 'PENDING_APPROVAL' ? 'Submitted — our team reviews new jobs quickly.' : `Job ${r.status.toLowerCase().replace('_', ' ')}`);
      await this.jobs.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

interface JobForm {
  title: string;
  department: string;
  description: string;
  responsibilities: string;
  requirements: string;
  minEducationLevel: string;
  experienceMinMonths: number;
  experienceMaxMonths: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryVisible: boolean;
  workMode: string;
  employmentType: string;
  openings: number;
  applicationDeadline: string;
  locations: { city: string; state: string }[];
}

@Component({
  selector: 'app-job-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, SkillPickerComponent, JobCardComponent, IconComponent, LabelPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/jobs">Jobs</a> / {{ id() ? 'Edit job' : 'New job' }}</nav>
      <div class="page-header"><div><h1>{{ id() ? 'Edit job' : 'Post a job' }}</h1><p>Clear, specific jobs get more relevant applicants.</p></div></div>
      @if (error()) { <div class="alert alert-danger" role="alert" style="margin-bottom:16px"><gh-icon name="alert" [size]="16" /><span>{{ error() }}</span></div> }
      <div class="layout">
        <form class="stack" (ngSubmit)="save(true)">
          <section class="card stack"><h3>Basics</h3>
            <div class="form-grid">
              <div class="field span-2"><label for="t" class="req">Job title</label><input id="t" class="input" name="t" [(ngModel)]="f.title" maxlength="120" placeholder="e.g. Junior Data Analyst" (ngModelChange)="touch()" /></div>
              <div class="field"><label for="dep">Department</label><input id="dep" class="input" name="dep" [(ngModel)]="f.department" maxlength="80" /></div>
              <div class="field"><label for="op" class="req">Openings</label><input id="op" class="input" type="number" name="op" min="1" [(ngModel)]="f.openings" /></div>
              <div class="field"><label for="et" class="req">Employment type</label><select id="et" class="select" name="et" [(ngModel)]="f.employmentType" (ngModelChange)="touch()">@for (t of o.employmentType; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
              <div class="field"><label for="wm" class="req">Work mode</label><select id="wm" class="select" name="wm" [(ngModel)]="f.workMode" (ngModelChange)="touch()">@for (t of o.workMode; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
            </div>
          </section>
          <section class="card stack"><h3>Description</h3>
            <div class="field"><label for="d" class="req">About the role</label><textarea id="d" class="textarea" rows="6" name="d" [(ngModel)]="f.description" maxlength="10000" placeholder="What will this person do, and why is it a great first job?"></textarea>
              <span class="hint">{{ f.description.length }} characters · minimum 50</span></div>
            <div class="field"><label for="r">Responsibilities</label><textarea id="r" class="textarea" name="r" [(ngModel)]="f.responsibilities" maxlength="5000" placeholder="One per line"></textarea></div>
            <div class="field"><label for="q">Requirements</label><textarea id="q" class="textarea" name="q" [(ngModel)]="f.requirements" maxlength="5000" placeholder="e.g. B.Tech / B.Sc (2025–2026 batch)"></textarea></div>
          </section>
          <section class="card stack"><h3>Skills & qualification</h3>
            <div class="field"><label class="req" for="sk">Required skills</label><gh-skill-picker inputId="sk" [value]="skills()" (valueChange)="skills.set($event); touch()" /></div>
            <div class="form-grid">
              <div class="field"><label for="ed">Minimum education</label><select id="ed" class="select" name="ed" [(ngModel)]="f.minEducationLevel"><option value="">Any</option>@for (t of o.educationLevel; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
              <div class="field"><label>Experience (months)</label>
                <div class="row" style="flex-wrap:nowrap"><input class="input" type="number" min="0" name="emin" [(ngModel)]="f.experienceMinMonths" aria-label="Minimum experience in months" (ngModelChange)="touch()" /><span>to</span>
                  <input class="input" type="number" min="0" name="emax" [(ngModel)]="f.experienceMaxMonths" aria-label="Maximum experience in months" (ngModelChange)="touch()" /></div>
                <span class="hint">0 to 12 = fresher-friendly</span></div>
            </div>
          </section>
          <section class="card stack"><h3>Compensation & location</h3>
            <div class="form-grid">
              <div class="field"><label for="smin">Salary from (LPA)</label><input id="smin" class="input" type="number" step="0.5" min="0" name="smin" [(ngModel)]="f.salaryMin" (ngModelChange)="touch()" /></div>
              <div class="field"><label for="smax">Salary up to (LPA)</label><input id="smax" class="input" type="number" step="0.5" min="0" name="smax" [(ngModel)]="f.salaryMax" (ngModelChange)="touch()" /></div>
              <label class="check span-2"><input type="checkbox" name="sv" [(ngModel)]="f.salaryVisible" (ngModelChange)="touch()" />Show salary to candidates (jobs with salary get more applicants)</label>
            </div>
            <div class="stack-sm"><span class="label req">Locations</span>
              @for (l of f.locations; track $index; let i = $index) {
                <div class="row" style="flex-wrap:nowrap">
                  <input class="input" [name]="'city' + i" [(ngModel)]="l.city" placeholder="City" list="cities" [attr.aria-label]="'City ' + (i + 1)" (ngModelChange)="touch()" />
                  <select class="select" [name]="'state' + i" [(ngModel)]="l.state" [attr.aria-label]="'State ' + (i + 1)"><option value="">State</option>@for (s of o.states; track s) { <option [value]="s">{{ s }}</option> }</select>
                  @if (f.locations.length > 1) { <button type="button" class="btn btn-ghost btn-icon" (click)="f.locations.splice(i, 1); touch()" aria-label="Remove location"><gh-icon name="trash" [size]="14" /></button> }
                </div>
              }
              <datalist id="cities">@for (c of o.cities; track c) { <option [value]="c"></option> }</datalist>
              @if (f.locations.length < 5) { <button type="button" class="btn btn-secondary btn-sm" style="align-self:flex-start" (click)="f.locations.push({ city: '', state: '' })"><gh-icon name="plus" [size]="14" />Add location</button> }
            </div>
            <div class="field" style="max-width:260px"><label for="dl">Application deadline</label><input id="dl" class="input" type="date" name="dl" [(ngModel)]="f.applicationDeadline" /></div>
          </section>
          <div class="form-actions">
            <a class="btn btn-ghost" routerLink="/jobs">Cancel</a>
            <button class="btn btn-secondary" type="button" [disabled]="busy()" (click)="save(false)">Save draft</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy()">@if (busy()) { <span class="spinner"></span> } {{ id() ? 'Save changes' : 'Save & submit' }}</button>
          </div>
        </form>
        <aside class="preview"><span class="overline">Candidate preview</span><gh-job-card [job]="preview()" /></aside>
      </div>
    </div>`,
  styles: `.layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
    .preview { position: sticky; top: 72px; display: flex; flex-direction: column; gap: 8px; }
    @media (max-width: 1023px) { .layout { grid-template-columns: minmax(0, 1fr); } .preview { position: static; } }`,
})
export class JobFormPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly id = input<string>();
  protected readonly o = OPTIONS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly skills = signal<Skill[]>([]);
  private readonly version = signal(0);
  private status = 'DRAFT';
  protected f: JobForm = {
    title: '', department: '', description: '', responsibilities: '', requirements: '', minEducationLevel: 'UG', experienceMinMonths: 0,
    experienceMaxMonths: 12, salaryMin: null, salaryMax: null, salaryVisible: true, workMode: 'ONSITE', employmentType: 'FULL_TIME',
    openings: 1, applicationDeadline: '', locations: [{ city: '', state: '' }],
  };

  protected readonly preview = computed<JobCardData>(() => {
    this.version();
    return {
      id: 'preview', title: this.f.title || 'Job title', workMode: this.f.workMode, employmentType: this.f.employmentType,
      experienceMinMonths: Number(this.f.experienceMinMonths) || 0, experienceMaxMonths: this.f.experienceMaxMonths === null ? null : Number(this.f.experienceMaxMonths),
      salaryMinPaise: this.f.salaryVisible ? lpaToPaise(this.f.salaryMin) ?? null : null, salaryMaxPaise: this.f.salaryVisible ? lpaToPaise(this.f.salaryMax) ?? null : null,
      publishedAt: new Date().toISOString(), company: { name: 'Your company', slug: 'you', verified: true },
      cities: this.f.locations.map((l) => l.city).filter(Boolean), skills: this.skills().map((s) => s.name),
    };
  });
  touch() {
    this.version.update((v) => v + 1);
  }

  async ngOnInit() {
    if (!this.id()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = await this.api.get<any>(`/employer/jobs/${this.id()}`);
    this.status = j.status;
    this.f = {
      title: j.title, department: j.department ?? '', description: j.description, responsibilities: j.responsibilities ?? '',
      requirements: j.requirements ?? '', minEducationLevel: j.minEducationLevel ?? '', experienceMinMonths: j.experienceMinMonths,
      experienceMaxMonths: j.experienceMaxMonths, salaryMin: paiseToLpa(j.salaryMinPaise), salaryMax: paiseToLpa(j.salaryMaxPaise),
      salaryVisible: j.salaryVisible, workMode: j.workMode, employmentType: j.employmentType, openings: j.openings,
      applicationDeadline: j.applicationDeadline?.slice(0, 10) ?? '', locations: j.locations.map((l: { city: string; state: string }) => ({ city: l.city, state: l.state })),
    };
    this.skills.set(j.skills);
    this.touch();
  }

  async save(submit: boolean) {
    const f = this.f;
    const problems: string[] = [];
    if (f.title.trim().length < 3) problems.push('a job title');
    if (f.description.trim().length < 50) problems.push('a description of at least 50 characters');
    if (!this.skills().length) problems.push('at least one skill');
    if (!f.locations.every((l) => l.city.trim() && l.state)) problems.push('a city and state for each location');
    if (problems.length) return this.error.set(`Please add ${problems.join(', ')}.`);
    this.error.set(null);
    this.busy.set(true);
    const body = {
      title: f.title.trim(), department: f.department.trim() || undefined, description: f.description.trim(),
      responsibilities: f.responsibilities.trim() || undefined, requirements: f.requirements.trim() || undefined,
      minEducationLevel: f.minEducationLevel || undefined, experienceMinMonths: Number(f.experienceMinMonths) || 0,
      experienceMaxMonths: f.experienceMaxMonths === null || (f.experienceMaxMonths as unknown) === '' ? undefined : Number(f.experienceMaxMonths),
      salaryMinPaise: lpaToPaise(f.salaryMin), salaryMaxPaise: lpaToPaise(f.salaryMax), salaryVisible: f.salaryVisible,
      workMode: f.workMode, employmentType: f.employmentType, openings: Number(f.openings) || 1,
      applicationDeadline: f.applicationDeadline || undefined, locations: f.locations.map((l) => ({ city: l.city.trim(), state: l.state })),
      skillIds: this.skills().map((s) => s.id),
    };
    try {
      let id = this.id();
      let status = this.status;
      if (id) status = (await this.api.patch<{ status: string }>(`/employer/jobs/${id}`, body)).status;
      else id = (await this.api.post<{ id: string }>('/employer/jobs', body)).id;
      if (submit && ['DRAFT', 'REJECTED'].includes(status)) status = (await this.api.post<{ status: string }>(`/employer/jobs/${id}/submit`)).status;
      this.toast.success(status === 'PUBLISHED' ? 'Job is live' : status === 'PENDING_APPROVAL' ? 'Submitted for review — we\'ll notify you when it\'s live' : 'Saved');
      await this.router.navigateByUrl('/jobs');
    } catch (e) {
      const err = ApiError.from(e);
      this.error.set(err.errors.length ? err.errors.map((x) => x.message).join('. ') : err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
