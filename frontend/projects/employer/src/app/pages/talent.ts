import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, ApiError, humanize, isEmptyArray, LabelPipe, loader, lpaToPaise, OPTIONS } from '@gh/core';
import { CreditsState } from '../credits';
import {
  CandidateCardComponent, CandidateCardData, CandidateProfileComponent, ConfirmService, CreditMeterComponent, EmptyStateComponent,
  IconComponent, ModalComponent, PageStateComponent, Skill, SkillPickerComponent, SkeletonComponent, StatusBadgeComponent,
  TagInputComponent, ToastService,
} from '@gh/ui';

interface SearchResult {
  data: CandidateCardData[];
  page: { nextCursor: string | null };
  totalEstimate: number;
  depthLimitReached?: boolean;
  credits?: { remaining: number; total: number };
}

interface Filters {
  q: string;
  skills: Skill[];
  cities: string[];
  educationLevels: string[];
  degrees: string[];
  gradMin: number | null;
  gradMax: number | null;
  expMax: number | null;
  ctcMax: number | null;
  availability: string[];
  workModes: string[];
  employmentStatus: string[];
  certification: string;
  excludeUnlocked: boolean;
  sort: string;
}

const EMPTY: Filters = {
  q: '', skills: [], cities: [], educationLevels: [], degrees: [], gradMin: null, gradMax: null, expMax: null, ctcMax: null,
  availability: [], workModes: [], employmentStatus: [], certification: '', excludeUnlocked: false, sort: 'relevance',
};

/** Session-scoped so returning from a profile keeps the search (not persisted anywhere). */
let lastFilters: Filters = structuredClone(EMPTY);

@Component({
  selector: 'app-talent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, CandidateCardComponent, SkillPickerComponent, TagInputComponent, CreditMeterComponent, IconComponent, SkeletonComponent, EmptyStateComponent, LabelPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Find talent</h1><p>Search early-career candidates. Cards are free; opening a full profile uses a credit.</p></div>
        @if (credits(); as c) { @if (c.total) { <gh-credit-meter [remaining]="c.remaining" [total]="c.total" /> } }</div>

      @if (!verified()) {
        <div class="alert alert-warning" style="margin-bottom:16px"><gh-icon name="shield" [size]="16" /><span class="grow">You can browse candidate cards now. <strong>Verify your company</strong> to unlock full profiles and get 50 free views.</span>
          <a class="btn btn-primary btn-sm" routerLink="/company/verification">Verify</a></div>
      }

      <form class="toolbar card card-tight" role="search" (ngSubmit)="search()">
        <div class="row" style="flex-wrap:nowrap">
          <input class="input grow" name="q" [(ngModel)]="f.q" placeholder="Role, skill or keyword — e.g. data analyst" aria-label="Search candidates" />
          <button class="btn btn-primary" type="submit"><gh-icon name="search" [size]="16" />Search</button>
          <button class="btn btn-ghost show-mobile" type="button" (click)="filtersOpen.update((v) => !v)"><gh-icon name="filter" [size]="16" />Filters</button>
        </div>
      </form>

      <div class="layout">
        <aside class="filters card stack" [class.open]="filtersOpen()" aria-label="Filters">
          <div class="row between"><h3>Filters</h3><button class="btn btn-link btn-sm" type="button" (click)="reset()">Reset</button></div>
          <div class="field"><label for="fs">Skills (all of)</label><gh-skill-picker inputId="fs" [value]="f.skills" (valueChange)="f.skills = $event" [max]="10" placeholder="e.g. Python" /></div>
          <div class="field"><label for="fc">City</label><gh-tag-input inputId="fc" [(value)]="f.cities" [suggestions]="o.cities" placeholder="Add city" /></div>
          <fieldset class="field"><legend class="label">Education</legend>
            <div class="row-sm">@for (l of ['UG', 'PG', 'DIPLOMA', 'HIGHER_SECONDARY']; track l) { <button type="button" class="chip" [attr.aria-pressed]="f.educationLevels.includes(l)" (click)="toggle(f.educationLevels, l)">{{ l | label }}</button> }</div></fieldset>
          <div class="field"><label for="fd">Degree</label><gh-tag-input inputId="fd" [(value)]="f.degrees" [suggestions]="degreeHints" placeholder="e.g. B.Tech" /></div>
          <div class="field"><label>Graduation year</label>
            <div class="row" style="flex-wrap:nowrap"><input class="input" type="number" name="gmin" [(ngModel)]="f.gradMin" placeholder="From" aria-label="Graduation year from" />
              <input class="input" type="number" name="gmax" [(ngModel)]="f.gradMax" placeholder="To" aria-label="Graduation year to" /></div></div>
          <div class="field"><label for="fe">Max experience</label>
            <select id="fe" class="select" name="fe" [(ngModel)]="f.expMax"><option [ngValue]="null">Any</option><option [ngValue]="0">Fresher</option><option [ngValue]="12">Up to 1 year</option><option [ngValue]="24">Up to 2 years</option></select></div>
          <div class="field"><label for="fctc">Expected CTC up to (LPA)</label><input id="fctc" class="input" type="number" step="0.5" name="fctc" [(ngModel)]="f.ctcMax" /></div>
          <fieldset class="field"><legend class="label">Availability</legend>
            <div class="row-sm">@for (a of o.availability; track a) { <button type="button" class="chip" [attr.aria-pressed]="f.availability.includes(a)" (click)="toggle(f.availability, a)">{{ a | label }}</button> }</div></fieldset>
          <fieldset class="field"><legend class="label">Work mode</legend>
            <div class="row-sm">@for (a of o.workMode; track a) { <button type="button" class="chip" [attr.aria-pressed]="f.workModes.includes(a)" (click)="toggle(f.workModes, a)">{{ a | label }}</button> }</div></fieldset>
          <fieldset class="field"><legend class="label">Status</legend>
            <div class="row-sm">@for (a of o.employmentStatus; track a) { <button type="button" class="chip" [attr.aria-pressed]="f.employmentStatus.includes(a)" (click)="toggle(f.employmentStatus, a)">{{ a | label }}</button> }</div></fieldset>
          <div class="field"><label for="fcert">Certification</label><input id="fcert" class="input" name="fcert" [(ngModel)]="f.certification" placeholder="e.g. AWS" /></div>
          <label class="check"><input type="checkbox" name="ex" [(ngModel)]="f.excludeUnlocked" />Hide candidates I've already unlocked</label>
          <button class="btn btn-primary btn-block" type="button" (click)="search()">Apply filters</button>
        </aside>

        <section class="results">
          <div class="row between" style="margin-bottom:12px">
            <p aria-live="polite"><strong class="tabular">{{ total() }}</strong>&ngsp;<span class="secondary">candidates found</span></p>
            <div class="row-sm"><label for="sort" class="caption">Sort</label>
              <select id="sort" class="select mini" [(ngModel)]="f.sort" (ngModelChange)="search()"><option value="relevance">Relevance</option><option value="recently_active">Recently active</option><option value="graduation_year">Graduation year</option></select></div>
          </div>
          @switch (status()) {
            @case ('loading') { <gh-skeleton variant="table" /> }
            @case ('error') { <div class="card"><gh-empty icon="alert" title="Search failed" [text]="error()"><button class="btn btn-secondary" (click)="search()">Try again</button></gh-empty></div> }
            @case ('empty') { <div class="card"><gh-empty icon="users" title="No candidates match these filters" text="Try fewer skills, a broader city list, or a wider graduation year range."><button class="btn btn-secondary" (click)="reset()">Reset filters</button></gh-empty></div> }
            @default {
              <div class="stack-sm">@for (c of results(); track c.candidateId) { <gh-candidate-card [candidate]="c" [link]="['/talent/candidates', c.candidateId]" /> }</div>
              @if (cursor()) { <div class="row" style="justify-content:center;margin-top:16px"><button class="btn btn-secondary" (click)="more()" [disabled]="loadingMore()">Load more</button></div> }
              @if (depthLimit()) { <p class="caption" style="text-align:center;margin-top:16px">You've reached the end of browsable results. Refine your filters to see different candidates.</p> }
            }
          }
        </section>
      </div>
    </div>`,
  styles: `
    .toolbar { position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 5; margin-bottom: 16px; }
    .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    .filters { position: sticky; top: 140px; max-height: calc(100vh - 160px); overflow: auto; }
    fieldset { border: 0; padding: 0; margin: 0; }
    .mini { width: auto; min-height: 32px; padding: 4px 8px; }
    @media (max-width: 1023px) { .layout { grid-template-columns: minmax(0, 1fr); } .filters { display: none; position: static; max-height: none; } .filters.open { display: flex; } }`,
})
export class TalentPage {
  private readonly api = inject(Api);
  protected readonly o = OPTIONS;
  protected readonly degreeHints = ['B.Tech', 'B.E.', 'B.Sc', 'B.Com', 'BCA', 'BBA', 'B.A.', 'MBA', 'MCA', 'M.Tech', 'M.Sc', 'Diploma'];
  protected f: Filters = structuredClone(lastFilters);
  protected readonly results = signal<CandidateCardData[]>([]);
  protected readonly total = signal(0);
  protected readonly cursor = signal<string | null>(null);
  protected readonly depthLimit = signal(false);
  protected readonly credits = signal<{ remaining: number; total: number } | null>(null);
  protected readonly verified = signal(true);
  protected readonly status = signal<'loading' | 'ready' | 'empty' | 'error'>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly filtersOpen = signal(false);

  constructor() {
    void this.search();
    this.api.get<{ verificationStatus: string }>('/employer/company').then((c) => this.verified.set(c.verificationStatus === 'VERIFIED')).catch(() => {});
  }

  toggle(arr: string[], v: string) {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(v);
  }

  private body() {
    const f = this.f;
    return {
      q: f.q.trim() || undefined,
      skillsAll: f.skills.length ? f.skills.map((s) => s.id) : undefined,
      cities: f.cities.length ? f.cities : undefined,
      educationLevels: f.educationLevels.length ? f.educationLevels : undefined,
      degrees: f.degrees.length ? f.degrees : undefined,
      graduationYearMin: f.gradMin ? Number(f.gradMin) : undefined,
      graduationYearMax: f.gradMax ? Number(f.gradMax) : undefined,
      experienceMonthsMax: f.expMax ?? undefined,
      expectedCtcMaxPaise: f.ctcMax ? lpaToPaise(f.ctcMax) : undefined,
      availability: f.availability.length ? f.availability : undefined,
      workModes: f.workModes.length ? f.workModes : undefined,
      employmentStatus: f.employmentStatus.length ? f.employmentStatus : undefined,
      certification: f.certification.trim() || undefined,
      excludeUnlocked: f.excludeUnlocked || undefined,
      sort: f.sort,
      limit: 25,
    };
  }

  async search() {
    lastFilters = structuredClone(this.f);
    this.status.set('loading');
    this.filtersOpen.set(false);
    try {
      const r = await this.api.post<SearchResult>('/search/candidates', this.body());
      this.results.set(r.data);
      this.total.set(r.totalEstimate);
      this.cursor.set(r.page.nextCursor);
      this.depthLimit.set(!!r.depthLimitReached);
      if (r.credits) this.credits.set(r.credits);
      this.status.set(r.data.length ? 'ready' : 'empty');
    } catch (e) {
      this.error.set(ApiError.from(e).message);
      this.status.set('error');
    }
  }
  async more() {
    this.loadingMore.set(true);
    try {
      const r = await this.api.post<SearchResult>('/search/candidates', { ...this.body(), cursor: this.cursor() });
      this.results.update((x) => [...x, ...r.data]);
      this.cursor.set(r.page.nextCursor);
      this.depthLimit.set(!r.page.nextCursor && !!r.depthLimitReached);
    } finally {
      this.loadingMore.set(false);
    }
  }
  reset() {
    this.f = structuredClone(EMPTY);
    void this.search();
  }
}

interface CandidateView {
  access: { level: 'LOCKED' | 'FULL' | 'CONTACT'; basis?: string; canUnlock?: boolean; reason?: string | null; creditsRemaining: number | null; unlockExpiresAt?: string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  saved?: { saved: boolean; folderIds: string[] };
  notes?: { id: string; body: string; createdAt: string; users: { fullName: string } | null }[];
  contactRequest?: { status: string; createdAt: string } | null;
}

@Component({
  selector: 'app-candidate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, CandidateProfileComponent, IconComponent, ModalComponent, AgoPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/talent">Find talent</a> / Candidate</nav>
      <gh-page-state [state]="view">
        @if (view.data(); as v) {
          <gh-candidate-profile [profile]="v.profile" [level]="v.access.level">
            <div head-actions class="stack-sm" style="align-items:flex-end">
              @if (v.access.level !== 'LOCKED') {
                <div class="row-sm">
                  <button class="btn btn-secondary btn-sm" type="button" (click)="saveOpen.set(true)"><gh-icon name="bookmark" [size]="14" />{{ v.saved?.saved ? 'Saved' : 'Save' }}</button>
                  @if (v.profile.hasResume) { <button class="btn btn-secondary btn-sm" type="button" (click)="resume()"><gh-icon name="download" [size]="14" />Resume</button> }
                  @if (v.access.level === 'FULL') {
                    @if (v.contactRequest?.status === 'PENDING') { <span class="badge badge-warning">Contact request pending</span> }
                    @else { <button class="btn btn-primary btn-sm" type="button" (click)="contactOpen.set(true)"><gh-icon name="mail" [size]="14" />Request contact</button> }
                  }
                </div>
                <span class="caption">{{ basis(v) }}</span>
              }
            </div>
            <div unlock class="stack-sm" style="align-items:center">
              @if (v.access.canUnlock) {
                <button class="btn btn-primary btn-lg" type="button" (click)="unlock()" [disabled]="unlocking()">@if (unlocking()) { <span class="spinner"></span> }<gh-icon name="unlock" [size]="16" />View full profile · uses 1 credit</button>
                <span class="caption">{{ v.access.creditsRemaining ?? 0 }} credits left · re-opening within 90 days is free for your whole team</span>
              } @else if (v.access.reason === 'EMPLOYER_NOT_VERIFIED') {
                <a class="btn btn-primary" routerLink="/company/verification">Verify your company to unlock</a>
              }
            </div>
            <div aside class="stack">
              @if (v.access.level !== 'LOCKED') {
                <section class="card stack-sm"><h3>Team notes</h3>
                  <textarea class="textarea" [(ngModel)]="noteText" placeholder="Add a private note…" aria-label="New note" maxlength="4000"></textarea>
                  <button class="btn btn-secondary btn-sm" style="align-self:flex-end" type="button" [disabled]="!noteText.trim()" (click)="addNote()">Add note</button>
                  @for (n of v.notes ?? []; track n.id) { <div class="note"><p class="pre-line">{{ n.body }}</p><span class="caption">{{ n.users?.fullName }} · {{ n.createdAt | ago }}</span></div> }
                </section>
              }
            </div>
          </gh-candidate-profile>

          <gh-modal [open]="contactOpen()" title="Request contact details" subtitle="The candidate decides whether to share their phone and email." (closed)="contactOpen.set(false)">
            <div class="stack">
              <div class="field"><label for="msg" class="req">Message</label>
                <textarea id="msg" class="textarea" rows="5" [(ngModel)]="message" maxlength="1000" placeholder="Introduce your company and the role. Be specific — candidates accept clear, genuine requests."></textarea>
                <span class="hint">{{ message.length }}/1000 · at least 20 characters</span></div>
              <div class="field"><label for="job">Related job <span class="muted">(optional)</span></label>
                <select id="job" class="select" [(ngModel)]="jobId"><option value="">None</option>@for (j of jobs(); track j.id) { <option [value]="j.id">{{ j.title }}</option> }</select></div>
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="contactOpen.set(false)">Cancel</button>
              <button class="btn btn-primary" [disabled]="message.trim().length < 20" (click)="sendContact()">Send request</button></ng-container>
          </gh-modal>

          <gh-modal [open]="saveOpen()" title="Save candidate" (closed)="saveOpen.set(false)" size="sm">
            <div class="stack-sm">
              <label class="check card card-tight"><input type="radio" name="folder" value="" [(ngModel)]="folderId" />No folder</label>
              @for (fd of folders(); track fd.id) { <label class="check card card-tight"><input type="radio" name="folder" [value]="fd.id" [(ngModel)]="folderId" />{{ fd.name }}</label> }
              <div class="row" style="flex-wrap:nowrap"><input class="input" [(ngModel)]="newFolder" placeholder="New folder name" aria-label="New folder name" />
                <button class="btn btn-secondary" type="button" [disabled]="!newFolder.trim()" (click)="createFolder()">Create</button></div>
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="saveOpen.set(false)">Cancel</button><button class="btn btn-primary" (click)="save()">Save</button></ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
  styles: `.note { padding: 10px 12px; background: var(--bg-subtle); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; }`,
})
export class CandidatePage {
  private readonly api = inject(Api);
  private readonly creditsState = inject(CreditsState);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly id = input.required<string>();
  protected readonly view = loader(() => this.api.get<CandidateView>(`/candidates/${this.id()}`));
  protected readonly unlocking = signal(false);
  protected readonly contactOpen = signal(false);
  protected readonly saveOpen = signal(false);
  protected readonly jobs = signal<{ id: string; title: string }[]>([]);
  protected readonly folders = signal<{ id: string; name: string }[]>([]);
  protected message = '';
  protected jobId = '';
  protected folderId = '';
  protected newFolder = '';
  protected noteText = '';

  constructor() {
    this.api.get<{ id: string; title: string; status: string }[]>('/employer/jobs', { status: 'PUBLISHED' }).then((j) => this.jobs.set(j)).catch(() => {});
    void this.loadFolders();
  }
  private async loadFolders() {
    this.folders.set(await this.api.get<{ id: string; name: string }[]>('/employer/folders').catch(() => []));
  }
  protected basis(v: CandidateView) {
    const b = v.access.basis;
    if (b === 'APPLICATION') return 'Applied to your job — contact shared';
    if (b === 'RECRUITER_SUBMISSION') return 'Submitted by your GenZHire recruiter';
    if (v.access.unlockExpiresAt) return `Unlocked until ${new Date(v.access.unlockExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return humanize(b);
  }

  async unlock() {
    const remaining = this.view.data()?.access.creditsRemaining ?? 0;
    const ok = await this.confirm.confirm({
      title: 'View full profile?',
      message: `This uses 1 profile view credit (${remaining} left). Anyone on your team can re-open this profile free for 90 days.`,
      confirmText: 'Use 1 credit',
    });
    if (!ok) return;
    this.unlocking.set(true);
    try {
      const r = await this.api.post<CandidateView>(`/candidates/${this.id()}/unlock`);
      this.view.data.set(r);
      this.creditsState.setRemaining(r.access.creditsRemaining);
      this.toast.success(r.access.basis === 'CREDIT' ? `Profile unlocked · ${r.access.creditsRemaining} credits left` : 'Profile already unlocked — no credit used');
    } catch (e) {
      const err = ApiError.from(e);
      this.toast.error(err.code === 'NO_CREDITS' ? "You've used all your profile view credits. Unlocked profiles stay available until they expire." : err.message);
    } finally {
      this.unlocking.set(false);
    }
  }
  resume() {
    void this.api.download(`/candidates/${this.id()}/resume`, 'resume.pdf').catch((e) => this.toast.error(e));
  }
  async sendContact() {
    try {
      await this.api.post(`/candidates/${this.id()}/contact-requests`, { message: this.message.trim(), jobId: this.jobId || undefined });
      this.contactOpen.set(false);
      this.toast.success('Request sent. You will be notified when the candidate responds.');
      await this.view.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async createFolder() {
    try {
      const f = await this.api.post<{ id: string }>('/employer/folders', { name: this.newFolder.trim() });
      this.newFolder = '';
      await this.loadFolders();
      this.folderId = f.id;
    } catch (e) {
      this.toast.error(e);
    }
  }
  async save() {
    try {
      await this.api.post(`/employer/saved-candidates/${this.id()}`, { folderId: this.folderId || undefined });
      this.saveOpen.set(false);
      this.toast.success('Candidate saved');
      await this.view.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async addNote() {
    try {
      await this.api.post(`/employer/candidates/${this.id()}/notes`, { body: this.noteText.trim() });
      this.noteText = '';
      await this.view.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

interface SavedRow {
  candidateId: string;
  name: string;
  city: string | null;
  headline: string | null;
  targetRole: string | null;
  highestDegree: string | null;
  graduationYear: number | null;
  skills: string[] | null;
  savedAt: string;
  savedBy: string | null;
  folderIds: string[] | null;
}

@Component({
  selector: 'app-saved',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, IconComponent, AgoPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Saved candidates</h1><p>Candidates you've saved, organised into folders.</p></div></div>
      <div class="layout">
        <nav class="card card-tight stack-sm" aria-label="Folders">
          <button class="folder" [class.active]="!folder()" (click)="pick(null)"><gh-icon name="bookmark" [size]="16" />All saved</button>
          @for (f of folders(); track f.id) {
            <div class="row" style="flex-wrap:nowrap"><button class="folder grow" [class.active]="folder() === f.id" (click)="pick(f.id)"><gh-icon name="folder" [size]="16" />{{ f.name }}<span class="caption" style="margin-left:auto">{{ f.count }}</span></button>
              <button class="btn btn-ghost btn-icon btn-sm" (click)="deleteFolder(f)" [attr.aria-label]="'Delete folder ' + f.name"><gh-icon name="trash" [size]="13" /></button></div>
          }
          <div class="row" style="flex-wrap:nowrap;margin-top:8px"><input class="input" [(ngModel)]="newFolder" placeholder="New folder" aria-label="New folder name" />
            <button class="btn btn-secondary btn-icon" (click)="create()" [disabled]="!newFolder.trim()" aria-label="Create folder"><gh-icon name="plus" [size]="16" /></button></div>
        </nav>
        <gh-page-state [state]="list" skeleton="table" emptyTitle="No saved candidates" emptyText="Save candidates from their profile to build shortlists." emptyIcon="bookmark">
          <a empty class="btn btn-primary" routerLink="/talent">Find talent</a>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Candidate</th><th>Education</th><th>Skills</th><th>Saved</th><th></th></tr></thead>
              <tbody>
                @for (c of list.data(); track c.candidateId) {
                  <tr><td><a class="row-link" [routerLink]="['/talent/candidates', c.candidateId]">{{ c.name }}</a><div class="caption">{{ c.headline || c.targetRole }}{{ c.city ? ' · ' + c.city : '' }}</div></td>
                    <td class="caption">{{ c.highestDegree }}{{ c.graduationYear ? ' · ' + c.graduationYear : '' }}</td>
                    <td class="caption">{{ (c.skills ?? []).slice(0, 4).join(', ') }}</td>
                    <td class="caption">{{ c.savedAt | ago }}{{ c.savedBy ? ' by ' + c.savedBy : '' }}</td>
                    <td><button class="btn btn-ghost btn-sm" (click)="unsave(c)">Remove</button></td></tr>
                }
              </tbody>
            </table>
          </div>
        </gh-page-state>
      </div>
    </div>`,
  styles: `.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; align-items: start; }
    .folder { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-secondary); cursor: pointer; text-align: left; }
    .folder:hover { background: var(--surface-hover); color: var(--text); } .folder.active { background: var(--primary-tint); color: var(--text); }
    @media (max-width: 1023px) { .layout { grid-template-columns: minmax(0, 1fr); } }`,
})
export class SavedPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly folder = signal<string | null>(null);
  protected readonly folders = signal<{ id: string; name: string; count: number }[]>([]);
  protected readonly list = loader(() => this.api.get<SavedRow[]>('/employer/saved-candidates', { folderId: this.folder() }), isEmptyArray);
  protected newFolder = '';

  constructor() {
    void this.loadFolders();
  }
  async loadFolders() {
    this.folders.set(await this.api.get('/employer/folders'));
  }
  pick(id: string | null) {
    this.folder.set(id);
    void this.list.reload();
  }
  async create() {
    try {
      await this.api.post('/employer/folders', { name: this.newFolder.trim() });
      this.newFolder = '';
      await this.loadFolders();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async deleteFolder(f: { id: string; name: string }) {
    if (!(await this.confirm.confirm({ title: `Delete folder "${f.name}"?`, message: 'Candidates stay saved; only the folder is removed.', confirmText: 'Delete folder', tone: 'danger' }))) return;
    await this.api.delete(`/employer/folders/${f.id}`);
    if (this.folder() === f.id) this.folder.set(null);
    await Promise.all([this.loadFolders(), this.list.reload()]);
  }
  async unsave(c: SavedRow) {
    await this.api.delete(`/employer/saved-candidates/${c.candidateId}${this.folder() ? '?folderId=' + this.folder() : ''}`);
    await Promise.all([this.loadFolders(), this.list.reload()]);
  }
}

