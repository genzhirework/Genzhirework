import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AgoPipe, Api, ApiError, DatePipe, isEmptyArray, LabelPipe, loader, lpaToPaise, OPTIONS, Page, paiseToLpa } from '@gh/core';
import {
  ConfirmService, CreditMeterComponent, IconComponent, PageStateComponent, SecuritySettingsComponent, Skill, SkillPickerComponent,
  StatusBadgeComponent, TagInputComponent, ToastService,
} from '@gh/ui';

// ============================================================ requirements

interface ReqRow {
  id: string;
  roleTitle: string;
  openings: number;
  status: string;
  fulfilmentMode: string;
  workMode: string;
  locations: string[];
  joiningTimeline: string;
  createdAt: string;
  submitted: number;
  joined: number;
}

@Component({
  selector: 'app-requirements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, IconComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Hiring requirements</h1><p>Tell us who you need — search yourself, or let GenZHire HR consultants source for you.</p></div>
        <a class="btn btn-primary" routerLink="/requirements/new"><gh-icon name="plus" [size]="16" />I need candidates</a></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No hiring requirements" emptyText="Raise a requirement and choose how you'd like it filled." emptyIcon="clipboard">
        <a empty class="btn btn-primary" routerLink="/requirements/new">I need candidates</a>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Role</th><th>Mode</th><th>Status</th><th class="num">Openings</th><th class="num">Submitted</th><th class="num">Joined</th><th>Raised</th></tr></thead>
          <tbody>@for (r of list.data(); track r.id) {
            <tr><td><a class="row-link" [routerLink]="['/requirements', r.id]">{{ r.roleTitle }}</a><div class="caption">{{ r.locations.join(', ') }} · {{ r.workMode | label }}</div></td>
              <td class="caption">{{ r.fulfilmentMode | label }}</td><td><gh-status kind="requirement" [value]="r.status" /></td>
              <td class="num">{{ r.openings }}</td><td class="num">{{ r.submitted }}</td><td class="num">{{ r.joined }}</td><td class="caption">{{ r.createdAt | ghDate }}</td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class RequirementsPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<ReqRow[]>('/employer/hiring-requirements'), isEmptyArray);
}

@Component({
  selector: 'app-requirement-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, SkillPickerComponent, TagInputComponent, IconComponent, LabelPipe],
  template: `
    <div class="page page-narrow">
      <nav class="breadcrumb"><a routerLink="/requirements">Hiring requirements</a> / New</nav>
      <div class="page-header"><div><h1>I need candidates</h1><p>Describe the role once. We'll help you fill it.</p></div></div>
      @if (error()) { <div class="alert alert-danger" role="alert" style="margin-bottom:16px"><gh-icon name="alert" [size]="16" />{{ error() }}</div> }
      <form class="stack" (ngSubmit)="submit()">
        <section class="card stack"><h3>The role</h3>
          <div class="form-grid">
            <div class="field span-2"><label for="rt" class="req">Role</label><input id="rt" class="input" name="rt" [(ngModel)]="f.roleTitle" placeholder="e.g. Graduate Engineer Trainee" maxlength="120" /></div>
            <div class="field"><label for="op" class="req">Number of openings</label><input id="op" class="input" type="number" min="1" name="op" [(ngModel)]="f.openings" /></div>
            <div class="field"><label for="wm" class="req">Work mode</label><select id="wm" class="select" name="wm" [(ngModel)]="f.workMode">@for (w of o.workMode; track w) { <option [value]="w">{{ w | label }}</option> }</select></div>
            <div class="field span-2"><label class="req" for="sk">Required skills</label><gh-skill-picker inputId="sk" [value]="skills()" (valueChange)="skills.set($event)" /></div>
            <div class="field"><label for="ql">Qualification</label><input id="ql" class="input" name="ql" [(ngModel)]="f.qualification" placeholder="e.g. B.E./B.Tech (CSE, IT, ECE)" /></div>
            <div class="field"><label for="ed">Minimum education</label><select id="ed" class="select" name="ed" [(ngModel)]="f.minEducationLevel"><option value="">Any</option>@for (l of o.educationLevel; track l) { <option [value]="l">{{ l | label }}</option> }</select></div>
            <div class="field"><label>Experience (months)</label><div class="row" style="flex-wrap:nowrap"><input class="input" type="number" min="0" name="emin" [(ngModel)]="f.expMin" aria-label="Minimum experience" /><span>to</span><input class="input" type="number" min="0" name="emax" [(ngModel)]="f.expMax" aria-label="Maximum experience" /></div></div>
            <div class="field"><label for="jt" class="req">Joining timeline</label><select id="jt" class="select" name="jt" [(ngModel)]="f.joiningTimeline">@for (j of o.joiningTimeline; track j) { <option [value]="j">{{ j | label }}</option> }</select></div>
            <div class="field span-2"><label class="req" for="loc">Locations</label><gh-tag-input inputId="loc" [(value)]="f.locations" [suggestions]="o.cities" placeholder="Add city" [max]="5" /></div>
            <div class="field"><label for="cmin">CTC from (LPA)</label><input id="cmin" class="input" type="number" step="0.5" name="cmin" [(ngModel)]="f.ctcMin" /></div>
            <div class="field"><label for="cmax">CTC up to (LPA)</label><input id="cmax" class="input" type="number" step="0.5" name="cmax" [(ngModel)]="f.ctcMax" /></div>
            <div class="field span-2"><label for="nt">Anything else?</label><textarea id="nt" class="textarea" name="nt" [(ngModel)]="f.notes" maxlength="2000"></textarea></div>
          </div>
        </section>
        <section class="card stack"><h3>How should we fill it?</h3>
          <div class="modes" role="radiogroup" aria-label="Fulfilment mode">
            @for (m of modes; track m.value) {
              <label class="card card-tight mode" [class.card-selected]="f.fulfilmentMode === m.value">
                <input type="radio" name="mode" class="sr-only" [value]="m.value" [(ngModel)]="f.fulfilmentMode" />
                <gh-icon [name]="m.icon" [size]="22" /><strong>{{ m.title }}</strong><span class="caption">{{ m.text }}</span></label>
            }
          </div>
          @if (f.fulfilmentMode !== 'DATABASE') {
            <div class="alert alert-info"><gh-icon name="info" [size]="16" /><span><strong>No upfront fee.</strong> If a candidate we source joins and completes 90 days, the consultant fee is 8.33% of their annual CTC (e.g. ₹49,980 on ₹6,00,000), per the recruitment agreement you'll confirm with our team.</span></div>
          }
        </section>
        <div class="form-actions"><a class="btn btn-ghost" routerLink="/requirements">Cancel</a>
          <button class="btn btn-primary" type="submit" [disabled]="busy()">@if (busy()) { <span class="spinner"></span> } Submit requirement</button></div>
      </form>
    </div>`,
  styles: `.modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .mode { display: flex; flex-direction: column; gap: 6px; cursor: pointer; } .mode gh-icon { color: var(--primary); }
    .mode:focus-within { box-shadow: var(--focus-ring); }
    @media (max-width: 767px) { .modes { grid-template-columns: 1fr; } }`,
})
export class RequirementFormPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly o = OPTIONS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly skills = signal<Skill[]>([]);
  protected readonly modes = [
    { value: 'DATABASE', icon: 'search', title: 'Candidate database', text: 'Search and unlock profiles yourself.' },
    { value: 'CONSULTANT', icon: 'users', title: 'HR consultant', text: 'Our recruiters source, screen and submit candidates.' },
    { value: 'BOTH', icon: 'sparkle', title: 'Both', text: 'Search yourself while our recruiters work in parallel.' },
  ];
  protected f = {
    roleTitle: '', openings: 1, workMode: 'ONSITE', qualification: '', minEducationLevel: 'UG', expMin: 0, expMax: 12 as number | null,
    joiningTimeline: 'WITHIN_30_DAYS', locations: [] as string[], ctcMin: null as number | null, ctcMax: null as number | null, notes: '', fulfilmentMode: 'CONSULTANT',
  };

  async submit() {
    const f = this.f;
    if (f.roleTitle.trim().length < 2 || !this.skills().length || !f.locations.length) return this.error.set('Add a role, at least one skill and at least one location.');
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.post<{ id: string; status: string }>('/employer/hiring-requirements', {
        roleTitle: f.roleTitle.trim(), openings: Number(f.openings), skillIds: this.skills().map((s) => s.id), qualification: f.qualification.trim() || undefined,
        minEducationLevel: f.minEducationLevel || undefined, experienceMinMonths: Number(f.expMin) || 0, experienceMaxMonths: f.expMax === null ? undefined : Number(f.expMax),
        locations: f.locations, workMode: f.workMode, ctcMinPaise: lpaToPaise(f.ctcMin), ctcMaxPaise: lpaToPaise(f.ctcMax),
        joiningTimeline: f.joiningTimeline, fulfilmentMode: f.fulfilmentMode, notes: f.notes.trim() || undefined,
      });
      this.toast.success(f.fulfilmentMode === 'DATABASE' ? 'Requirement saved — start searching the talent database.' : 'Requirement submitted — our team will be in touch.');
      await this.router.navigate(f.fulfilmentMode === 'DATABASE' ? ['/talent'] : ['/requirements', r.id]);
    } catch (e) {
      const err = ApiError.from(e);
      this.error.set(err.errors.length ? err.errors.map((x) => x.message).join('. ') : err.message);
    } finally {
      this.busy.set(false);
    }
  }
}

interface ReqDetail {
  id: string;
  roleTitle: string;
  openings: number;
  status: string;
  fulfilmentMode: string;
  workMode: string;
  locations: string[];
  joiningTimeline: string;
  ctcMinPaise: number | null;
  ctcMaxPaise: number | null;
  qualification: string | null;
  notes: string | null;
  createdAt: string;
  caseStatus: string | null;
  skills: { id: number; name: string }[];
  submissions: {
    id: string; candidateId: string; candidateName: string; headline: string | null; stage: string; semantic: string; submittedAt: string;
    employerDecision: string; employerFeedback: string | null; joiningId: string | null; joiningDate: string | null; trackingStatus: string | null;
    employerConfirmedAt: string | null; recruiterConfirmedAt: string | null; billingDueDate: string | null;
  }[];
}

@Component({
  selector: 'app-requirement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, IconComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/requirements">Hiring requirements</a> / Details</nav>
      <gh-page-state [state]="req">
        @if (req.data(); as r) {
          <div class="page-header"><div class="stack-sm"><div class="row"><h1 style="font-size:1.5rem">{{ r.roleTitle }}</h1><gh-status kind="requirement" [value]="r.status" /></div>
            <p>{{ r.openings }} opening{{ r.openings > 1 ? 's' : '' }} · {{ r.locations.join(', ') }} · {{ r.workMode | label }} · {{ r.fulfilmentMode | label }} · joining: {{ r.joiningTimeline | label }}</p></div>
            @if (!['FILLED', 'CLOSED', 'CANCELLED'].includes(r.status)) { <button class="btn btn-ghost" (click)="cancel(r)">Cancel requirement</button> }</div>
          @if (r.status === 'SUBMITTED') { <div class="alert alert-info" style="margin-bottom:16px"><gh-icon name="clock" [size]="16" />Our team is reviewing your requirement and will assign an HR consultant shortly.</div> }
          <section class="card card-flush">
            <div style="padding:16px 20px"><h3>Candidates submitted by GenZHire</h3><p class="caption">Review each candidate and confirm joinings to start the 90-day period.</p></div>
            <table class="table"><tbody>
              @for (s of r.submissions; track s.id) {
                <tr><td><a class="row-link" [routerLink]="['/talent/candidates', s.candidateId]">{{ s.candidateName }}</a><div class="caption">{{ s.headline }}</div></td>
                  <td><span class="badge">{{ s.stage }}</span></td><td class="caption">Submitted {{ s.submittedAt | ago }}</td>
                  <td>
                    @if (s.employerDecision === 'PENDING') {
                      <div class="row-sm"><button class="btn btn-primary btn-sm" (click)="decide(s.id, 'ACCEPTED')">Accept</button><button class="btn btn-secondary btn-sm" (click)="decide(s.id, 'REJECTED')">Reject</button></div>
                    } @else if (s.joiningId && !s.employerConfirmedAt) {
                      <button class="btn btn-primary btn-sm" (click)="confirmJoining(s)">Confirm joining on {{ s.joiningDate | ghDate }}</button>
                    } @else if (s.trackingStatus === 'TRACKING') {
                      <div class="row-sm"><span class="caption">90 days complete on {{ s.billingDueDate | ghDate }}</span><button class="btn btn-ghost btn-sm" (click)="left(s)">Report left</button></div>
                    } @else { <span class="caption">{{ s.employerDecision | label }}</span> }
                  </td></tr>
              } @empty { <tr><td class="caption" style="height:72px;padding-left:20px">No candidates submitted yet.</td></tr> }
            </tbody></table>
          </section>
          <section class="card stack-sm" style="margin-top:16px"><h3>Requirement</h3>
            <dl class="kv"><dt>Skills</dt><dd>{{ skillNames(r) }}</dd><dt>Qualification</dt><dd>{{ r.qualification || '—' }}</dd>
              <dt>CTC</dt><dd>{{ ctc(r) }}</dd><dt>Raised</dt><dd>{{ r.createdAt | ghDate }}</dd>@if (r.notes) { <dt>Notes</dt><dd class="pre-line">{{ r.notes }}</dd> }</dl>
          </section>
        }
      </gh-page-state>
    </div>`,
})
export class RequirementPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly id = input.required<string>();
  protected readonly req = loader(() => this.api.get<ReqDetail>(`/employer/hiring-requirements/${this.id()}`));
  protected skillNames = (r: ReqDetail) => r.skills.map((s) => s.name).join(', ');
  protected ctc = (r: ReqDetail) => (r.ctcMinPaise ? `${paiseToLpa(r.ctcMinPaise)}${r.ctcMaxPaise ? '–' + paiseToLpa(r.ctcMaxPaise) : ''} LPA` : '—');

  async decide(id: string, decision: string) {
    const r = await this.confirm.ask({ title: decision === 'ACCEPTED' ? 'Accept this candidate?' : 'Reject this candidate?', message: decision === 'ACCEPTED' ? 'Your recruiter will schedule interviews.' : 'Your recruiter will be notified.', confirmText: decision === 'ACCEPTED' ? 'Accept' : 'Reject', tone: decision === 'ACCEPTED' ? 'primary' : 'danger', reasonLabel: 'Feedback for the recruiter', reasonOptional: true });
    if (!r.ok) return;
    await this.run(() => this.api.post(`/employer/recruitment/submissions/${id}/decision`, { decision, feedback: r.reason.trim() || undefined }), 'Decision recorded');
  }
  async confirmJoining(s: ReqDetail['submissions'][number]) {
    if (!(await this.confirm.confirm({ title: `Confirm ${s.candidateName} joined?`, message: `Joining date ${new Date(s.joiningDate!).toLocaleDateString('en-IN')}. This starts the 90-day period in the recruitment agreement.`, confirmText: 'Confirm joining' }))) return;
    await this.run(() => this.api.post(`/employer/recruitment/joinings/${s.joiningId}/confirm`), 'Joining confirmed');
  }
  async left(s: ReqDetail['submissions'][number]) {
    const r = await this.confirm.ask({ title: `Report that ${s.candidateName} has left`, message: 'Tell us the reason. The leaving date is recorded as today.', confirmText: 'Report', tone: 'danger', reasonLabel: 'Reason' });
    if (!r.ok) return;
    await this.run(() => this.api.post(`/employer/recruitment/joinings/${s.joiningId}/left`, { leftOn: new Date().toISOString().slice(0, 10), reason: r.reason.trim() }), 'Recorded');
  }
  async cancel(r: ReqDetail) {
    if (!(await this.confirm.confirm({ title: `Cancel "${r.roleTitle}"?`, message: 'Recruiters will stop working on it.', confirmText: 'Cancel requirement', tone: 'danger' }))) return;
    await this.run(() => this.api.post(`/employer/hiring-requirements/${r.id}/cancel`), 'Requirement cancelled');
  }
  private async run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      this.toast.success(ok);
      await this.req.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

// ================================================================= usage

interface Bucket {
  id: string;
  entitlementType: string;
  source: string;
  totalQuantity: number;
  usedQuantity: number;
  remainingQuantity: number;
  validFrom: string;
  validUntil: string;
}
interface LedgerRow {
  id: number;
  delta: number;
  reason: string;
  createdAt: string;
  note: string | null;
  actorName: string | null;
  candidateId: string | null;
  candidateName: string | null;
}

@Component({
  selector: 'app-usage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, CreditMeterComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Usage & credits</h1><p>Profile view credits and exactly what used them.</p></div></div>
      <gh-page-state [state]="buckets" emptyTitle="No credits yet" emptyText="Verify your company to receive 50 free profile views." emptyIcon="unlock">
        <a empty class="btn btn-primary" routerLink="/company/verification">Verify your company</a>
        <div class="grid-auto" style="margin-bottom:16px">
          @for (b of buckets.data(); track b.id) {
            <div class="card stack-sm"><div class="row between"><strong>{{ b.source | label }}</strong><span class="caption">{{ b.entitlementType | label }}</span></div>
              <gh-credit-meter [remaining]="b.remainingQuantity" [total]="b.totalQuantity" />
              <span class="caption">Valid until {{ b.validUntil | ghDate }}</span></div>
          }
        </div>
      </gh-page-state>
      <section class="card stack-sm" style="margin-bottom:16px"><h3>What uses a credit?</h3>
        <ul class="secondary stack-sm" style="padding-left:1.2em">
          <li><strong>Uses 1 credit:</strong> choosing "View full profile" on a candidate your company hasn't unlocked in the last 90 days.</li>
          <li><strong>Free:</strong> search results, locked previews, re-opening an unlocked profile (any teammate, 90 days), candidates who applied to your jobs, and candidates submitted by your GenZHire recruiter.</li>
        </ul>
      </section>
      <section class="card card-flush">
        <div style="padding:16px 20px"><h3>Credit ledger</h3></div>
        <table class="table"><thead><tr><th>Date</th><th>Activity</th><th>Candidate</th><th>By</th><th class="num">Credits</th></tr></thead>
          <tbody>@for (l of ledger(); track l.id) {
            <tr><td class="caption">{{ l.createdAt | ghDate: true }}</td><td>{{ l.reason | label }}{{ l.note ? ' — ' + l.note : '' }}</td>
              <td>@if (l.candidateId) { <a [routerLink]="['/talent/candidates', l.candidateId]">{{ l.candidateName }}</a> } @else { — }</td>
              <td class="caption">{{ l.actorName || 'GenZHire' }}</td><td class="num" [style.color]="l.delta > 0 ? 'var(--success)' : null">{{ l.delta > 0 ? '+' : '' }}{{ l.delta }}</td></tr>
          } @empty { <tr><td colspan="5" class="caption" style="height:64px;text-align:center">{{ ledgerLoaded() ? 'No credit activity yet.' : 'Loading…' }}</td></tr> }</tbody></table>
        @if (cursor()) { <div style="padding:12px;text-align:center"><button class="btn btn-secondary btn-sm" (click)="more()">Load more</button></div> }
      </section>
    </div>`,
})
export class UsagePage {
  private readonly api = inject(Api);
  protected readonly buckets = loader(() => this.api.get<Bucket[]>('/employer/entitlements'), isEmptyArray);
  protected readonly ledger = signal<LedgerRow[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly ledgerLoaded = signal(false);
  constructor() {
    this.api.get<Page<LedgerRow>>('/employer/entitlements/ledger')
      .then((p) => { this.ledger.set(p.data); this.cursor.set(p.page.nextCursor); })
      .catch(() => {})
      .finally(() => this.ledgerLoaded.set(true));
  }
  async more() {
    const p = await this.api.get<Page<LedgerRow>>('/employer/entitlements/ledger', { cursor: this.cursor() });
    this.ledger.update((l) => [...l, ...p.data]);
    this.cursor.set(p.page.nextCursor);
  }
}

// =============================================================== company

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

@Component({
  selector: 'app-company',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatusBadgeComponent, IconComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page page-narrow">
      <div class="page-header"><div><h1>Company</h1><p>Your public company profile, verification and team.</p></div></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">
        <a class="tab" routerLink="/company" [class.active]="tab() === 'profile'">Profile</a>
        <a class="tab" routerLink="/company/verification" [class.active]="tab() === 'verification'">Verification</a>
        <a class="tab" routerLink="/company/team" [class.active]="tab() === 'team'">Team</a>
      </div>
      <gh-page-state [state]="company">
        @if (company.data(); as c) {
          @switch (tab()) {
            @case ('profile') {
              <form class="card stack" (ngSubmit)="saveProfile()">
                <div class="row">
                  @if (c['logoFileId']) { <img [src]="'/api/v1/files/' + c['logoFileId'] + '/logo'" alt="Company logo" width="64" height="64" class="logo" /> }
                  <label class="btn btn-secondary btn-sm"><gh-icon name="upload" [size]="14" />{{ c['logoFileId'] ? 'Change logo' : 'Upload logo' }}<input type="file" class="sr-only" accept="image/png,image/jpeg,image/webp" (change)="logo($event)" /></label>
                </div>
                <div class="form-grid">
                  <div class="field"><label for="dn" class="req">Display name</label><input id="dn" class="input" name="dn" [(ngModel)]="d['displayName']" /></div>
                  <div class="field"><label for="ln">Legal name</label><input id="ln" class="input" name="ln" [(ngModel)]="d['legalName']" /></div>
                  <div class="field"><label for="ws">Website</label><input id="ws" class="input" type="url" name="ws" [(ngModel)]="d['website']" placeholder="https://" /></div>
                  <div class="field"><label for="in">Industry</label><input id="in" class="input" name="in" [(ngModel)]="d['industry']" /></div>
                  <div class="field"><label for="sz">Company size</label><select id="sz" class="select" name="sz" [(ngModel)]="d['sizeBand']"><option [ngValue]="null">—</option>@for (s of o.sizeBand; track s) { <option [value]="s">{{ s | label }} employees</option> }</select></div>
                  <div class="field"><label for="fy">Founded</label><input id="fy" class="input" type="number" name="fy" [(ngModel)]="d['foundedYear']" /></div>
                  <div class="field"><label for="hc">Headquarters city</label><input id="hc" class="input" name="hc" [(ngModel)]="d['hqCity']" /></div>
                  <div class="field"><label for="hs">State</label><select id="hs" class="select" name="hs" [(ngModel)]="d['hqState']"><option [ngValue]="null">—</option>@for (s of o.states; track s) { <option [value]="s">{{ s }}</option> }</select></div>
                  <div class="field span-2"><label for="ds">About the company</label><textarea id="ds" class="textarea" rows="5" name="ds" [(ngModel)]="d['description']" maxlength="3000"></textarea><span class="hint">Shown on every job you post.</span></div>
                </div>
                <div class="form-actions"><button class="btn btn-primary" type="submit">Save profile</button></div>
              </form>
            }
            @case ('verification') {
              <div class="stack">
                @if (welcome()) { <div class="alert alert-success"><gh-icon name="check" [size]="16" />Account created. Verify your company to unlock talent search and 50 free profile views.</div> }
                <div class="card row between"><div><h3>Status</h3><p class="secondary">Verified companies get a badge on every job and can unlock candidate profiles.</p></div><gh-status kind="verification" [value]="c['verificationStatus']" /></div>
                @if (canSubmit(c)) {
                  <form class="card stack" (ngSubmit)="submitVerification(c)">
                    <h3>Submit verification</h3>
                    @if (vError()) { <div class="alert alert-danger" role="alert">{{ vError() }}</div> }
                    <div class="form-grid">
                      <div class="field"><label for="vw">Company website</label><input id="vw" class="input" type="url" name="vw" [(ngModel)]="v.website" placeholder="https://" /></div>
                      <div class="field"><label for="vo">Official email</label><input id="vo" class="input" type="email" name="vo" [(ngModel)]="v.officialEmail" [placeholder]="c['primaryDomain'] ? 'you@' + c['primaryDomain'] : 'hr@yourcompany.com'" /></div>
                      <div class="field"><label for="vt">Registration type</label><select id="vt" class="select" name="vt" [(ngModel)]="v.registrationType">@for (t of o.registrationType; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
                      <div class="field"><label for="vn">Registration number</label><input id="vn" class="input" name="vn" [(ngModel)]="v.registrationNumber" [placeholder]="v.registrationType === 'GSTIN' ? '33ABCDE1234F1Z5' : ''" /></div>
                      <div class="field"><label for="vc" class="req">Contact person</label><input id="vc" class="input" name="vc" [(ngModel)]="v.contactName" /></div>
                      <div class="field"><label for="vp" class="req">Contact phone</label><input id="vp" class="input" name="vp" [(ngModel)]="v.contactPhone" placeholder="+919812345678" /></div>
                      <div class="field span-2"><span class="label">Registration document {{ c['primaryDomain'] ? '(optional)' : '(required for personal-email accounts)' }}</span>
                        <div class="row"><label class="btn btn-secondary btn-sm"><gh-icon name="upload" [size]="14" />Upload PDF or image<input type="file" class="sr-only" accept=".pdf,image/png,image/jpeg" (change)="doc($event)" /></label>
                          @for (dname of docNames(); track dname) { <span class="tag">{{ dname }}</span> }</div></div>
                    </div>
                    <div class="form-actions"><button class="btn btn-primary" type="submit" [disabled]="vBusy()">Submit for verification</button></div>
                  </form>
                }
                <section class="card card-flush"><div style="padding:16px 20px"><h3>History</h3></div>
                  <table class="table"><tbody>@for (h of history(); track h['id']) {
                    <tr><td><gh-status kind="verification" [value]="h['status']" /></td><td class="caption">{{ h['registrationType'] | label }} {{ h['registrationNumber'] }}</td>
                      <td class="caption">{{ h['decisionReason'] }}</td><td class="caption">{{ h['createdAt'] | ghDate }}</td></tr>
                  } @empty { <tr><td class="caption" style="padding-left:20px">No submissions yet.</td></tr> }</tbody></table></section>
              </div>
            }
            @case ('team') {
              <section class="card card-flush"><table class="table"><thead><tr><th>Member</th><th>Role</th><th>Last sign-in</th></tr></thead><tbody>
                @for (m of team(); track m['id']) {
                  <tr><td><strong>{{ m['usersEmployerUsersUserIdTousers'].fullName }}</strong><div class="caption">{{ m['usersEmployerUsersUserIdTousers'].email }}</div></td>
                    <td>{{ m['companyRole'] | label }}{{ m['designation'] ? ' · ' + m['designation'] : '' }}</td><td class="caption">{{ m['usersEmployerUsersUserIdTousers'].lastLoginAt | ago }}</td></tr>
                }</tbody></table></section>
              <p class="caption" style="margin-top:12px">Team invitations are coming soon. Contact support@genzhire.work to add colleagues.</p>
            }
          }
        }
      </gh-page-state>
    </div>`,
  styles: `.logo { width: 64px; height: 64px; border-radius: 12px; object-fit: contain; border: 1px solid var(--border); background: var(--bg-subtle); }`,
})
export class CompanyPage implements OnInit {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  readonly tab = input<'profile' | 'verification' | 'team'>('profile');
  protected readonly o = OPTIONS;
  protected readonly company = loader(async () => {
    const c = await this.api.get<Row>('/employer/company');
    this.d = { displayName: c['displayName'], legalName: c['legalName'], website: c['website'], industry: c['industry'], sizeBand: c['sizeBand'], foundedYear: c['foundedYear'], description: c['description'], hqCity: c['hqCity'], hqState: c['hqState'] };
    this.v.website = c['website'] ?? '';
    return c;
  });
  protected readonly history = signal<Row[]>([]);
  protected readonly team = signal<Row[]>([]);
  protected readonly welcome = signal(false);
  protected readonly vBusy = signal(false);
  protected readonly vError = signal<string | null>(null);
  protected readonly docNames = signal<string[]>([]);
  protected d: Row = {};
  protected v = { website: '', officialEmail: '', registrationType: 'GSTIN', registrationNumber: '', contactName: '', contactPhone: '', documentFileIds: [] as string[] };

  ngOnInit() {
    this.welcome.set(this.route.snapshot.queryParamMap.has('welcome'));
    void this.loadSide();
  }
  private async loadSide() {
    this.history.set(await this.api.get('/employer/verification'));
    this.team.set(await this.api.get('/employer/team'));
  }
  protected canSubmit(c: Row) {
    return c['verificationStatus'] !== 'VERIFIED' && c['verificationStatus'] !== 'SUSPENDED' && !this.history().some((h) => ['SUBMITTED', 'IN_REVIEW'].includes(h['status']));
  }
  async saveProfile() {
    try {
      const body = Object.fromEntries(Object.entries(this.d).filter(([, x]) => x !== null && x !== '' && x !== undefined));
      if (body['foundedYear']) body['foundedYear'] = Number(body['foundedYear']);
      await this.api.patch('/employer/company', body);
      this.toast.success('Company profile saved');
      await this.company.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async logo(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const f = await this.api.upload(file, 'COMPANY_LOGO');
      await this.api.patch('/employer/company', { logoFileId: f.id });
      await this.company.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async doc(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const f = await this.api.upload(file, 'VERIFICATION_DOC');
      this.v.documentFileIds.push(f.id);
      this.docNames.update((n) => [...n, file.name]);
    } catch (e) {
      this.toast.error(e);
    }
  }
  async submitVerification(c: Row) {
    this.vError.set(null);
    if (this.v.contactName.trim().length < 2 || !/^\+?[1-9]\d{9,14}$/.test(this.v.contactPhone.replace(/\s/g, ''))) return this.vError.set('Add a contact name and a valid phone number (e.g. +919812345678).');
    if (!c['primaryDomain'] && !this.v.documentFileIds.length) return this.vError.set('Upload a registration document (GST certificate, incorporation certificate or Udyam).');
    this.vBusy.set(true);
    try {
      await this.api.post('/employer/verification', {
        website: this.v.website || undefined, officialEmail: this.v.officialEmail || undefined, registrationType: this.v.registrationType,
        registrationNumber: this.v.registrationNumber.trim() || undefined, contactName: this.v.contactName.trim(),
        contactPhone: this.v.contactPhone.replace(/\s/g, ''), documentFileIds: this.v.documentFileIds.length ? this.v.documentFileIds : undefined,
      });
      this.toast.success('Submitted. We usually review within 1 business day.');
      await this.loadSide();
    } catch (e) {
      const err = ApiError.from(e);
      this.vError.set(err.errors.length ? err.errors.map((x) => x.message).join('. ') : err.message);
    } finally {
      this.vBusy.set(false);
    }
  }
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecuritySettingsComponent],
  template: `<div class="page page-narrow"><div class="page-header"><div><h1>Settings</h1><p>Your account security.</p></div></div><gh-security-settings /></div>`,
})
export class SettingsPage {}

