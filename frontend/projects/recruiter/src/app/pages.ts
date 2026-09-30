import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AgoPipe, Api, AuthService, DatePipe, InrPipe, isEmptyArray, LabelPipe, loader, lpaToPaise, paiseToLpa } from '@gh/core';
import {
  AppShellComponent, AvatarComponent, CandidateCardComponent, CandidateCardData, CandidateProfileComponent, ConfirmService, IconComponent,
  LoginFormComponent, ModalComponent, NavGroup, PageStateComponent, SecuritySettingsComponent, StatTileComponent,
  StatusBadgeComponent, TimelineComponent, ToastService,
} from '@gh/ui';

// ------------------------------------------------------------------- shell

@Component({
  selector: 'app-recruiter-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AppShellComponent],
  template: `<gh-app-shell appName="Recruiter" [nav]="nav"><router-outlet /></gh-app-shell>`,
})
export class RecruiterShell {
  protected readonly nav: NavGroup[] = [
    { items: [{ label: 'Dashboard', link: '/dashboard', icon: 'home' }] },
    {
      label: 'Recruitment',
      items: [
        { label: 'Requirements', link: '/requirements', icon: 'clipboard' },
        { label: 'Find candidates', link: '/candidates', icon: 'search' },
        { label: 'Interviews', link: '/interviews', icon: 'calendar' },
      ],
    },
    {
      label: 'Placements',
      items: [
        { label: '90-day tracking', link: '/tracking', icon: 'clock' },
        { label: 'Billing', link: '/billing', icon: 'rupee' },
      ],
    },
    { label: 'Account', items: [{ label: 'Settings', link: '/settings', icon: 'settings' }] },
  ];
}

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginFormComponent],
  template: `
    <gh-login-form title="Recruiter sign in" subtitle="GenZHire HR consultants only. Accounts are created by your administrator." home="/dashboard" [showForgot]="false">
      <p class="caption" style="margin-top:20px;text-align:center">Forgot your password? Ask a GenZHire administrator to reset it.</p>
    </gh-login-form>`,
  styles: `:host { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }`,
})
export class LoginPage {}

// --------------------------------------------------------------- dashboard

interface Dash {
  openCases: number;
  activeCandidates: number;
  awaitingFeedback: number;
  inTracking: number;
  interviews: { id: string; roundName: string; mode: string; scheduledStart: string; candidateName: string; roleTitle: string; company: string; recruitmentCandidateId: string }[];
  trackingDue: { id: string; candidateName: string; company: string; billingDueDate: string; daysRemaining: number; trackingStatus: string; caseId: string }[];
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatTileComponent, StatusBadgeComponent, DatePipe, LabelPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Good day, {{ auth.firstName() }}</h1><p>Your recruitment pipeline at a glance.</p></div></div>
      <gh-page-state [state]="dash">
        @if (dash.data(); as d) {
          <div class="grid-auto" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
            <gh-stat label="Open cases" [value]="d.openCases" icon="clipboard" />
            <gh-stat label="Active candidates" [value]="d.activeCandidates" icon="users" />
            <gh-stat label="Awaiting employer feedback" [value]="d.awaitingFeedback" icon="clock" />
            <gh-stat label="In 90-day tracking" [value]="d.inTracking" icon="activity" />
          </div>
          <div class="grid-2" style="margin-top:16px;align-items:start">
            <section class="card card-flush"><div style="padding:16px 20px" class="row between"><h3>Upcoming interviews</h3><a routerLink="/interviews" class="caption">All</a></div>
              <table class="table"><tbody>@for (i of d.interviews; track i.id) {
                <tr><td><a class="row-link" [routerLink]="['/pipeline', i.recruitmentCandidateId]">{{ i.candidateName }}</a><div class="caption">{{ i.roleTitle }} · {{ i.company }}</div></td>
                  <td class="caption">{{ i.roundName }} · {{ i.mode | label }}</td><td class="caption">{{ i.scheduledStart | ghDate: true }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:20px;height:64px">No interviews in the next 7 days.</td></tr> }</tbody></table></section>
            <section class="card card-flush"><div style="padding:16px 20px" class="row between"><h3>90-day checkpoints due</h3><a routerLink="/tracking" class="caption">Tracker</a></div>
              <table class="table"><tbody>@for (t of d.trackingDue; track t.id) {
                <tr><td><strong>{{ t.candidateName }}</strong><div class="caption">{{ t.company }}</div></td>
                  <td><gh-status kind="tracking" [value]="t.trackingStatus" /></td>
                  <td class="caption" [style.color]="t.daysRemaining <= 5 ? 'var(--warning)' : null">{{ t.daysRemaining > 0 ? t.daysRemaining + ' days left' : 'Due' }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:20px;height:64px">Nothing due in the next 3 weeks.</td></tr> }</tbody></table></section>
          </div>
        }
      </gh-page-state>
    </div>`,
})
export class DashboardPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthService);
  protected readonly dash = loader(() => this.api.get<Dash>('/recruitment/dashboard'));
}

// ------------------------------------------------------------------- cases

interface CaseRow {
  id: string;
  status: string;
  openedAt: string;
  roleTitle: string;
  openings: number;
  locations: string[];
  workMode: string;
  joiningTimeline: string;
  company: string;
  feePercentage: number;
  pipelineCount: number;
  submitted: number;
  joined: number;
  recruiters: string;
}

@Component({
  selector: 'app-cases',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Requirements</h1><p>Recruitment cases assigned to you.</p></div></div>
      <gh-page-state [state]="cases" skeleton="table" emptyTitle="No cases assigned" emptyText="An administrator assigns hiring requirements to recruiters." emptyIcon="clipboard">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Role</th><th>Company</th><th>Status</th><th class="num">Openings</th><th class="num">Pipeline</th><th class="num">Submitted</th><th class="num">Joined</th><th>Opened</th></tr></thead>
          <tbody>@for (c of cases.data(); track c.id) {
            <tr><td><a class="row-link" [routerLink]="['/requirements', c.id]">{{ c.roleTitle }}</a><div class="caption">{{ c.locations.join(', ') }} · {{ c.workMode | label }} · join {{ c.joiningTimeline | label }}</div></td>
              <td>{{ c.company }}</td><td><gh-status kind="case" [value]="c.status" /></td><td class="num">{{ c.openings }}</td><td class="num">{{ c.pipelineCount }}</td>
              <td class="num">{{ c.submitted }}</td><td class="num">{{ c.joined }}</td><td class="caption">{{ c.openedAt | ghDate }}</td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class CasesPage {
  private readonly api = inject(Api);
  protected readonly cases = loader(() => this.api.get<CaseRow[]>('/recruitment/cases'), isEmptyArray);
}

interface Stage {
  id: number;
  code: string;
  label: string;
  semantic: string;
  sortOrder: number;
  isTerminal: boolean;
}
interface PipeRow {
  id: string;
  candidateId: string;
  stageId: number;
  semantic: string;
  stageLabel: string;
  candidateName: string;
  city: string | null;
  headline: string | null;
  source: string;
  submittedAt: string | null;
  employerDecision: string | null;
  interviews: number;
  updatedAt: string;
}
interface CaseDetail {
  id: string;
  status: string;
  openedAt: string;
  agreement: { referenceNo: string; feePercentage: number; paymentTriggerDays: number };
  requirement: {
    roleTitle: string; openings: number; qualification: string | null; minEducationLevel: string | null; experienceMinMonths: number; experienceMaxMonths: number | null;
    locations: string[]; workMode: string; ctcMinPaise: number | null; ctcMaxPaise: number | null; joiningTimeline: string; notes: string | null;
    company: { displayName: string; website: string | null }; skills: { id: number; name: string }[];
  };
  pipeline: PipeRow[];
}

const SYSTEM = new Set(['SUBMITTED', 'OFFER', 'JOINED', 'TRACKING', 'BILLABLE', 'INVOICED', 'PAID']);
const NEEDS_REASON = new Set(['REJECTED', 'WITHDRAWN', 'DROPPED']);
const BOARD = ['SOURCING', 'SCREENING', 'SHORTLISTED', 'SUBMITTED', 'INTERVIEW', 'SELECTED', 'OFFER', 'JOINED', 'TRACKING'];

@Component({
  selector: 'app-case',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, PageStateComponent, StatusBadgeComponent, AvatarComponent, IconComponent, ModalComponent, CandidateCardComponent, LabelPipe, AgoPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/requirements">Requirements</a> / Case</nav>
      <gh-page-state [state]="data">
        @if (data.data(); as c) {
          <div class="page-header">
            <div class="stack-sm"><div class="row"><h1 style="font-size:1.5rem">{{ c.requirement.roleTitle }}</h1><gh-status kind="case" [value]="c.status" /></div>
              <p>{{ c.requirement.company.displayName }} · {{ c.requirement.openings }} opening(s) · {{ c.requirement.locations.join(', ') }} · {{ c.requirement.workMode | label }}</p></div>
            <button class="btn btn-primary" type="button" (click)="addOpen.set(true); searchCands()"><gh-icon name="plus" [size]="16" />Add candidate</button>
          </div>
          <div class="tabs" style="margin-bottom:16px">
            <button class="tab" [class.active]="tab() === 'pipeline'" (click)="tab.set('pipeline')">Pipeline<span class="count">{{ c.pipeline.length }}</span></button>
            <button class="tab" [class.active]="tab() === 'brief'" (click)="tab.set('brief')">Brief</button>
            <button class="tab" [class.active]="tab() === 'closed'" (click)="tab.set('closed')">Closed<span class="count">{{ closed().length }}</span></button>
          </div>
          @switch (tab()) {
            @case ('pipeline') {
              <p class="caption" style="margin-bottom:8px">Drag to move between manual stages. Submit, offer and joining happen from the candidate page.</p>
              <div class="kanban" cdkDropListGroup>
                @for (s of boardStages(); track s.id) {
                  <div class="kanban-col" [class.system]="isSystem(s)">
                    <div class="kanban-col-head"><span>{{ s.label }}</span><span class="badge">{{ col(s.id).length }}</span></div>
                    <div class="kanban-list" cdkDropList [cdkDropListData]="s" (cdkDropListDropped)="drop($event)">
                      @for (p of col(s.id); track p.id) {
                        <div class="kanban-card" cdkDrag [cdkDragData]="p" [cdkDragDisabled]="isSystem(s)">
                          <div class="row-sm" style="flex-wrap:nowrap"><gh-avatar [name]="p.candidateName" [seed]="p.candidateId" [size]="26" />
                            <a class="row-link truncate" [routerLink]="['/pipeline', p.id]">{{ p.candidateName }}</a></div>
                          <p class="caption truncate" style="margin-top:6px">{{ p.headline || p.city }}</p>
                          <div class="row between caption" style="margin-top:6px"><span>{{ p.source | label }}</span>
                            @if (p.employerDecision === 'PENDING') { <span class="badge badge-warning">Awaiting employer</span> }
                            @else if (p.employerDecision === 'ACCEPTED') { <span class="badge badge-success">Accepted</span> }
                            @else { <span>{{ p.updatedAt | ago }}</span> }</div>
                        </div>
                      }
                    </div>
                  </div>
                }
                <div class="kanban-col drop-out">
                  <div class="kanban-col-head"><span>Drop / reject</span></div>
                  <div class="kanban-list" cdkDropList [cdkDropListData]="dropStage()!" (cdkDropListDropped)="drop($event)"><p class="caption" style="padding:8px">Drag here to reject or drop a candidate (reason required).</p></div>
                </div>
              </div>
            }
            @case ('brief') {
              <div class="grid-2" style="align-items:start">
                <section class="card stack-sm"><h3>Requirement</h3>
                  <dl class="kv"><dt>Skills</dt><dd>{{ skillNames(c) }}</dd><dt>Qualification</dt><dd>{{ c.requirement.qualification || (c.requirement.minEducationLevel | label) }}</dd>
                    <dt>Experience</dt><dd>{{ c.requirement.experienceMinMonths }}–{{ c.requirement.experienceMaxMonths ?? '∞' }} months</dd>
                    <dt>CTC</dt><dd>{{ ctc(c) }}</dd><dt>Joining</dt><dd>{{ c.requirement.joiningTimeline | label }}</dd>
                    @if (c.requirement.notes) { <dt>Notes</dt><dd class="pre-line">{{ c.requirement.notes }}</dd> }</dl></section>
                <section class="card stack-sm"><h3>Agreement</h3>
                  <dl class="kv"><dt>Reference</dt><dd>{{ c.agreement.referenceNo }}</dd><dt>Fee</dt><dd>{{ c.agreement.feePercentage }}% of annual CTC</dd>
                    <dt>Billable after</dt><dd>{{ c.agreement.paymentTriggerDays }} days from joining</dd></dl>
                  @if (c.requirement.company.website) { <a [href]="c.requirement.company.website" target="_blank" rel="noopener noreferrer">{{ c.requirement.company.website }}</a> }</section>
              </div>
            }
            @case ('closed') {
              <div class="table-wrap"><table class="table"><tbody>@for (p of closed(); track p.id) {
                <tr><td><a class="row-link" [routerLink]="['/pipeline', p.id]">{{ p.candidateName }}</a></td><td><span class="badge">{{ p.stageLabel }}</span></td><td class="caption">{{ p.updatedAt | ago }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:16px">No closed candidates.</td></tr> }</tbody></table></div>
            }
          }

          <gh-modal [open]="addOpen()" title="Add candidate to this case" subtitle="Searches the GenZHire database (consented, searchable profiles only)." size="lg" (closed)="addOpen.set(false)">
            <form class="row" style="flex-wrap:nowrap;margin-bottom:12px" (ngSubmit)="searchCands()">
              <input class="input" name="q" [(ngModel)]="q" placeholder="Skill, role or keyword" aria-label="Search candidates" />
              <button class="btn btn-secondary" type="submit">Search</button></form>
            <div class="stack-sm" style="max-height:420px;overflow:auto">
              @for (r of results(); track r.candidateId) {
                <gh-candidate-card [candidate]="r"><button actions class="btn btn-primary btn-sm" type="button" (click)="add(r)">Add</button></gh-candidate-card>
              } @empty { <p class="caption">No matching candidates.</p> }
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="addOpen.set(false)">Done</button></ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
  styles: `.system .kanban-col-head { color: var(--text-muted); } .drop-out { border-style: dashed; min-height: 120px; }`,
})
export class CasePage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly id = input.required<string>();
  protected readonly tab = signal<'pipeline' | 'brief' | 'closed'>('pipeline');
  protected readonly stages = signal<Stage[]>([]);
  protected readonly data = loader(() => this.api.get<CaseDetail>(`/recruitment/cases/${this.id()}`));
  protected readonly addOpen = signal(false);
  protected readonly results = signal<CandidateCardData[]>([]);
  protected q = '';
  protected readonly boardStages = computed(() => this.stages().filter((s) => BOARD.includes(s.semantic)));
  protected readonly dropStage = computed(() => this.stages().find((s) => s.semantic === 'DROPPED'));
  protected readonly closed = computed(() => (this.data.data()?.pipeline ?? []).filter((p) => !BOARD.includes(p.semantic)));
  protected isSystem = (s: Stage) => SYSTEM.has(s.semantic);
  protected col = (stageId: number) => (this.data.data()?.pipeline ?? []).filter((p) => p.stageId === stageId);
  protected skillNames = (c: CaseDetail) => c.requirement.skills.map((s) => s.name).join(', ');
  protected ctc = (c: CaseDetail) => (c.requirement.ctcMinPaise ? `${paiseToLpa(c.requirement.ctcMinPaise)}–${paiseToLpa(c.requirement.ctcMaxPaise) ?? ''} LPA` : '—');

  constructor() {
    this.api.get<Stage[]>('/recruitment/stages').then((s) => this.stages.set(s)).catch(() => {});
  }

  async drop(e: CdkDragDrop<Stage>) {
    const to = e.container.data;
    const p = e.item.data as PipeRow;
    if (!to || e.previousContainer === e.container || to.id === p.stageId) return;
    if (SYSTEM.has(to.semantic)) return this.toast.info(`Open the candidate to ${to.semantic === 'SUBMITTED' ? 'submit them to the employer' : 'record the ' + to.label.toLowerCase()}.`);
    let note: string | undefined;
    if (NEEDS_REASON.has(to.semantic)) {
      const r = await this.confirm.ask({ title: `Move ${p.candidateName} to ${to.label}?`, confirmText: to.label, tone: 'danger', reasonLabel: 'Reason' });
      if (!r.ok) return;
      note = r.reason.trim();
    }
    try {
      await this.api.post(`/recruitment/pipeline/${p.id}/move`, { toStageId: to.id, note });
      await this.data.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }

  async searchCands() {
    try {
      const r = await this.api.post<{ data: CandidateCardData[] }>('/search/candidates', { q: this.q.trim() || undefined, limit: 25 });
      this.results.set(r.data);
    } catch (e) {
      this.toast.error(e);
    }
  }
  async add(c: CandidateCardData) {
    try {
      await this.api.post(`/recruitment/cases/${this.id()}/candidates`, { candidateId: c.candidateId, source: 'DATABASE' });
      this.toast.success(`${c.displayName} added to Sourcing`);
      this.results.update((r) => r.filter((x) => x.candidateId !== c.candidateId));
      await this.data.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

// --------------------------------------------------------- pipeline candidate

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
interface RcDetail {
  id: string;
  caseId: string;
  stage: Stage;
  source: string;
  screeningNotes: string | null;
  submittedAt: string | null;
  employerDecision: string | null;
  employerFeedback: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
  history: { stage: string; note: string | null; at: string; by: string }[];
  interviews: Row[];
  offers: Row[];
  joining: Row | null;
}

@Component({
  selector: 'app-pipeline-candidate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageStateComponent, CandidateProfileComponent, TimelineComponent, StatusBadgeComponent, ModalComponent, LabelPipe, DatePipe, InrPipe],
  template: `
    <div class="page">
      <gh-page-state [state]="rc">
        @if (rc.data(); as r) {
          <nav class="breadcrumb"><a routerLink="/requirements">Requirements</a> / <a [routerLink]="['/requirements', r.caseId]">Case</a> / {{ r.profile.displayName }}</nav>
          <div class="page-header">
            <div class="row"><h1 style="font-size:1.5rem">{{ r.profile.displayName }}</h1><span class="badge badge-primary">{{ r.stage.label }}</span>
              @if (r.employerDecision) { <span class="badge" [class.badge-success]="r.employerDecision === 'ACCEPTED'" [class.badge-danger]="r.employerDecision === 'REJECTED'" [class.badge-warning]="r.employerDecision === 'PENDING'">Employer: {{ r.employerDecision | label }}</span> }</div>
            <div class="row">
              @switch (r.stage.semantic) {
                @case ('SOURCING') { <button class="btn btn-primary" (click)="move(r, 'SCREENING')">Start screening</button> }
                @case ('SCREENING') { <button class="btn btn-secondary" (click)="move(r, 'SHORTLISTED')">Shortlist</button><button class="btn btn-primary" (click)="submit(r)">Submit to employer</button> }
                @case ('SHORTLISTED') { <button class="btn btn-primary" (click)="submit(r)">Submit to employer</button> }
                @case ('SUBMITTED') { @if (r.employerDecision === 'ACCEPTED') { <button class="btn btn-primary" (click)="ivOpen.set(true)">Schedule interview</button> } }
                @case ('INTERVIEW') { <button class="btn btn-secondary" (click)="ivOpen.set(true)">Add interview round</button><button class="btn btn-primary" (click)="move(r, 'SELECTED')">Mark selected</button> }
                @case ('SELECTED') { <button class="btn btn-primary" (click)="offerOpen.set(true)">Record offer</button> }
                @case ('OFFER') {
                  @if (latestOffer(r)?.['status'] === 'EXTENDED') { <button class="btn btn-secondary" (click)="offerStatus(r, 'DECLINED')">Offer declined</button><button class="btn btn-primary" (click)="offerStatus(r, 'ACCEPTED')">Offer accepted</button> }
                  @else if (latestOffer(r)?.['status'] === 'ACCEPTED') { <button class="btn btn-primary" (click)="joinOpen.set(true)">Record joining</button> }
                }
              }
              @if (!r.stage.isTerminal && !r.joining) { <button class="btn btn-ghost" (click)="drop(r)">Drop / reject</button> }
            </div>
          </div>

          <gh-candidate-profile [profile]="r.profile" level="CONTACT">
            <div aside class="stack">
              @if (r.joining; as j) {
                <section class="card stack-sm"><h3>Joining</h3>
                  <dl class="kv" style="grid-template-columns:110px 1fr"><dt>Joined</dt><dd>{{ j['joiningDate'] | ghDate }}</dd><dt>CTC</dt><dd>{{ j['annualCtcPaise'] | inr }}</dd>
                    <dt>Billable on</dt><dd>{{ j['billingDueDate'] | ghDate }}</dd><dt>Status</dt><dd><gh-status kind="tracking" [value]="j['trackingStatus']" /></dd>
                    <dt>Employer</dt><dd>{{ j['employerConfirmedAt'] ? 'Confirmed' : 'Awaiting confirmation' }}</dd></dl></section>
              }
              @if (r.offers.length) {
                <section class="card stack-sm"><h3>Offers</h3>
                  @for (o of r.offers; track o['id']) { <div><strong>{{ o['designation'] }}</strong> · {{ o['annualCtcPaise'] | inr }}<div class="caption">{{ o['status'] | label }} · joining {{ o['expectedJoiningDate'] | ghDate }}</div></div> }</section>
              }
              @if (r.interviews.length) {
                <section class="card stack-sm"><h3>Interviews</h3>
                  @for (i of r.interviews; track i['id']) {
                    <div class="iv"><div class="row between"><strong>Round {{ i['roundNo'] }}: {{ i['roundName'] }}</strong><gh-status kind="interview" [value]="i['status']" /></div>
                      <div class="caption">{{ i['scheduledStart'] | ghDate: true }} · {{ i['mode'] | label }}{{ i['outcome'] !== 'PENDING' ? ' · ' + (i['outcome'] | label) : '' }}</div>
                      @if (i['status'] === 'SCHEDULED' || i['status'] === 'RESCHEDULED') {
                        <div class="row-sm" style="margin-top:6px"><button class="btn btn-ghost btn-sm" (click)="outcome(i, 'PASSED')">Passed</button><button class="btn btn-ghost btn-sm" (click)="outcome(i, 'FAILED')">Failed</button><button class="btn btn-ghost btn-sm" (click)="noShow(i)">No-show</button></div>
                      }</div>
                  }</section>
              }
              @if (r.employerFeedback) { <section class="card stack-sm"><h3>Employer feedback</h3><p class="pre-line">{{ r.employerFeedback }}</p></section> }
              <section class="card"><h3 style="margin-bottom:12px">History</h3><gh-timeline [items]="history(r)" /></section>
            </div>
          </gh-candidate-profile>

          <gh-modal [open]="ivOpen()" title="Schedule interview" (closed)="ivOpen.set(false)">
            <div class="form-grid">
              <div class="field span-2"><label for="rn">Round</label><input id="rn" class="input" [(ngModel)]="iv.roundName" placeholder="e.g. Technical, HR" /></div>
              <div class="field"><label for="md">Mode</label><select id="md" class="select" [(ngModel)]="iv.mode"><option value="VIDEO">Video</option><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option></select></div>
              <div class="field"><label for="dt">Date & time</label><input id="dt" class="input" type="datetime-local" [(ngModel)]="iv.start" /></div>
              <div class="field"><label for="du">Duration (minutes)</label><input id="du" class="input" type="number" [(ngModel)]="iv.duration" /></div>
              <div class="field"><label for="ll">Location / link</label><input id="ll" class="input" [(ngModel)]="iv.locationOrLink" /></div>
              <div class="field span-2"><label for="iw">Interviewers</label><input id="iw" class="input" [(ngModel)]="iv.interviewerNames" /></div>
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="ivOpen.set(false)">Cancel</button><button class="btn btn-primary" (click)="schedule(r)">Schedule</button></ng-container>
          </gh-modal>
          <gh-modal [open]="offerOpen()" title="Record offer" subtitle="The annual CTC here drives the consultant fee." (closed)="offerOpen.set(false)">
            <div class="form-grid">
              <div class="field span-2"><label for="og">Designation</label><input id="og" class="input" [(ngModel)]="offer.designation" /></div>
              <div class="field"><label for="oc">Annual CTC (LPA)</label><input id="oc" class="input" type="number" step="0.1" [(ngModel)]="offer.ctc" /></div>
              <div class="field"><label for="od">Offer date</label><input id="od" class="input" type="date" [(ngModel)]="offer.offerDate" /></div>
              <div class="field span-2"><label for="oj">Expected joining date</label><input id="oj" class="input" type="date" [(ngModel)]="offer.joiningDate" /></div>
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="offerOpen.set(false)">Cancel</button><button class="btn btn-primary" (click)="saveOffer(r)">Save offer</button></ng-container>
          </gh-modal>
          <gh-modal [open]="joinOpen()" title="Record joining" subtitle="The employer must also confirm before 90-day tracking starts." size="sm" (closed)="joinOpen.set(false)">
            <div class="field"><label for="jd">Joining date</label><input id="jd" class="input" type="date" [(ngModel)]="joiningDate" /></div>
            <ng-container footer><button class="btn btn-secondary" (click)="joinOpen.set(false)">Cancel</button><button class="btn btn-primary" [disabled]="!joiningDate" (click)="saveJoining(r)">Confirm joining</button></ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
  styles: `.iv { padding: 8px 0; border-top: 1px solid var(--border); } .iv:first-of-type { border-top: 0; }`,
})
export class PipelineCandidatePage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  readonly id = input.required<string>();
  protected readonly rc = loader(() => this.api.get<RcDetail>(`/recruitment/pipeline/${this.id()}`));
  private stages: Stage[] = [];
  protected readonly ivOpen = signal(false);
  protected readonly offerOpen = signal(false);
  protected readonly joinOpen = signal(false);
  protected iv = { roundName: 'Technical', mode: 'VIDEO', start: '', duration: 45, locationOrLink: '', interviewerNames: '' };
  protected offer = { designation: '', ctc: null as number | null, offerDate: new Date().toISOString().slice(0, 10), joiningDate: '' };
  protected joiningDate = '';

  constructor() {
    this.api.get<Stage[]>('/recruitment/stages').then((s) => (this.stages = s)).catch(() => {});
  }
  protected latestOffer = (r: RcDetail) => r.offers[0] as Row | undefined;
  protected history = (r: RcDetail) => r.history.map((h) => ({ label: h.stage, at: h.at, note: h.note, by: h.by }));

  private async run(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      this.toast.success(ok);
      await this.rc.reload();
      return true;
    } catch (e) {
      this.toast.error(e);
      return false;
    }
  }
  async move(r: RcDetail, semantic: string) {
    const s = this.stages.find((x) => x.semantic === semantic);
    if (s) await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/move`, { toStageId: s.id }), `Moved to ${s.label}`);
  }
  async submit(r: RcDetail) {
    if (!(await this.confirm.confirm({ title: `Submit ${r.profile.displayName} to the employer?`, message: 'The employer will see the full profile and contact details.', confirmText: 'Submit candidate' }))) return;
    await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/submit`), 'Submitted to employer');
  }
  async drop(r: RcDetail) {
    const res = await this.confirm.ask({ title: `Drop ${r.profile.displayName}?`, confirmText: 'Drop candidate', tone: 'danger', reasonLabel: 'Reason' });
    const s = this.stages.find((x) => x.semantic === 'DROPPED');
    if (res.ok && s) await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/move`, { toStageId: s.id, note: res.reason.trim() }), 'Candidate dropped');
  }
  async schedule(r: RcDetail) {
    if (!this.iv.start) return this.toast.error('Pick a date and time');
    const start = new Date(this.iv.start);
    const end = new Date(start.getTime() + (Number(this.iv.duration) || 45) * 60000);
    if (await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/interviews`, {
      roundName: this.iv.roundName, mode: this.iv.mode, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(),
      locationOrLink: this.iv.locationOrLink || undefined, interviewerNames: this.iv.interviewerNames || undefined,
    }), 'Interview scheduled')) this.ivOpen.set(false);
  }
  async outcome(i: Row, outcome: string) {
    await this.run(() => this.api.patch(`/recruitment/interviews/${i['id']}`, { status: 'COMPLETED', outcome }), 'Interview updated');
  }
  async noShow(i: Row) {
    await this.run(() => this.api.patch(`/recruitment/interviews/${i['id']}`, { status: 'NO_SHOW' }), 'Marked as no-show');
  }
  async saveOffer(r: RcDetail) {
    if (!this.offer.designation || !this.offer.ctc || !this.offer.joiningDate) return this.toast.error('Fill in designation, CTC and joining date');
    if (await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/offer`, {
      designation: this.offer.designation, annualCtcPaise: lpaToPaise(this.offer.ctc), offerDate: this.offer.offerDate, expectedJoiningDate: this.offer.joiningDate,
    }), 'Offer recorded')) this.offerOpen.set(false);
  }
  async offerStatus(r: RcDetail, status: string) {
    const o = this.latestOffer(r);
    if (o) await this.run(() => this.api.patch(`/recruitment/offers/${o['id']}`, { status }), `Offer ${status.toLowerCase()}`);
  }
  async saveJoining(r: RcDetail) {
    if (await this.run(() => this.api.post(`/recruitment/pipeline/${r.id}/joining`, { joiningDate: this.joiningDate }), 'Joining recorded — awaiting employer confirmation')) this.joinOpen.set(false);
  }
}

// ----------------------------------------------------- find candidates / lists

@Component({
  selector: 'app-find',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CandidateCardComponent, IconComponent, ModalComponent],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Find candidates</h1><p>Search consented profiles and add them to one of your cases.</p></div></div>
      <form class="card card-tight row" style="flex-wrap:nowrap;margin-bottom:16px" (ngSubmit)="search()">
        <input class="input" name="q" [(ngModel)]="q" placeholder="Skill, role or keyword" aria-label="Search" />
        <input class="input" name="city" [(ngModel)]="city" placeholder="City" style="max-width:200px" aria-label="City" />
        <button class="btn btn-primary" type="submit"><gh-icon name="search" [size]="16" />Search</button>
      </form>
      <p class="caption" style="margin-bottom:12px">{{ total() }} candidates</p>
      <div class="stack-sm">@for (c of results(); track c.candidateId) {
        <gh-candidate-card [candidate]="c"><button actions class="btn btn-secondary btn-sm" type="button" (click)="pick.set(c)">Add to case</button></gh-candidate-card>
      }</div>
      <gh-modal [open]="!!pick()" title="Add to which case?" size="sm" (closed)="pick.set(null)">
        <div class="stack-sm">@for (c of cases(); track c.id) { <button class="btn btn-secondary btn-block" style="justify-content:flex-start" (click)="add(c.id)">{{ c.roleTitle }} · {{ c.company }}</button> }
          @empty { <p class="caption">You have no open cases.</p> }</div>
      </gh-modal>
    </div>`,
})
export class FindPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected q = '';
  protected city = '';
  protected readonly results = signal<CandidateCardData[]>([]);
  protected readonly total = signal(0);
  protected readonly cases = signal<{ id: string; roleTitle: string; company: string; status: string }[]>([]);
  protected readonly pick = signal<CandidateCardData | null>(null);
  constructor() {
    void this.search();
    this.api.get<{ id: string; roleTitle: string; company: string; status: string }[]>('/recruitment/cases').then((c) => this.cases.set(c.filter((x) => x.status === 'OPEN'))).catch(() => {});
  }
  async search() {
    const r = await this.api.post<{ data: CandidateCardData[]; totalEstimate: number }>('/search/candidates', { q: this.q.trim() || undefined, cities: this.city.trim() ? [this.city.trim()] : undefined, limit: 25 });
    this.results.set(r.data);
    this.total.set(r.totalEstimate);
  }
  async add(caseId: string) {
    const c = this.pick();
    if (!c) return;
    try {
      await this.api.post(`/recruitment/cases/${caseId}/candidates`, { candidateId: c.candidateId, source: 'DATABASE' });
      this.toast.success(`${c.displayName} added to the case`);
    } catch (e) {
      this.toast.error(e);
    }
    this.pick.set(null);
  }
}

interface InterviewRow {
  id: string;
  roundName: string;
  mode: string;
  scheduledStart: string;
  status: string;
  recruitmentCandidateId: string;
  candidateName: string;
  roleTitle: string;
  company: string;
}

@Component({
  selector: 'app-interviews',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Interviews</h1><p>Scheduled in the next 30 days across your cases.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No upcoming interviews" emptyIcon="calendar">
        <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Candidate</th><th>Role</th><th>Round</th><th>Status</th></tr></thead>
          <tbody>@for (i of list.data(); track i.id) {
            <tr><td>{{ i.scheduledStart | ghDate: true }}</td><td><a class="row-link" [routerLink]="['/pipeline', i.recruitmentCandidateId]">{{ i.candidateName }}</a></td>
              <td>{{ i.roleTitle }}<div class="caption">{{ i.company }}</div></td><td class="caption">{{ i.roundName }} · {{ i.mode | label }}</td><td><gh-status kind="interview" [value]="i.status" /></td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class InterviewsPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<InterviewRow[]>('/recruitment/interviews'), isEmptyArray);
}

interface TrackRow {
  id: string;
  joiningDate: string;
  billingDueDate: string;
  paymentTriggerDays: number;
  trackingStatus: string;
  annualCtcPaise: number;
  stillEmployedConfirmedAt: string | null;
  employerConfirmedAt: string | null;
  daysRemaining: number;
  daysElapsed: number;
  candidateName: string;
  roleTitle: string;
  company: string;
  caseId: string;
  billingStatus: string | null;
  feeAmountPaise: number | null;
  feePercentage: number | null;
  reminders: { dayOffset: number; dueOn: string; sent: boolean }[] | null;
}

@Component({
  selector: 'app-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, DatePipe, InrPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>90-day tracking</h1><p>Confirm placements are still employed. Billing starts only after a confirmation near the end of the period.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No placements yet" emptyIcon="clock">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Candidate</th><th>Joined</th><th>Progress</th><th>Checkpoints</th><th>Fee</th><th>Status</th><th></th></tr></thead>
          <tbody>@for (t of list.data(); track t.id) {
            <tr>
              <td><strong>{{ t.candidateName }}</strong><div class="caption">{{ t.roleTitle }} · {{ t.company }}</div></td>
              <td class="caption">{{ t.joiningDate | ghDate }}</td>
              <td style="min-width:160px"><div class="progress" [class.warn]="t.trackingStatus === 'TRACKING' && t.daysRemaining <= 5"><span [style.width.%]="pct(t)"></span></div>
                <span class="caption">{{ t.trackingStatus === 'TRACKING' ? (t.daysRemaining > 0 ? t.daysRemaining + ' days left · due ' : 'Due ') + (t.billingDueDate | ghDate) : '' }}</span></td>
              <td><div class="dots">@for (r of t.reminders ?? []; track r.dayOffset) { <span class="dot" [class.done]="r.sent" [title]="'Day ' + r.dayOffset + ' · ' + r.dueOn"></span> }</div></td>
              <td class="caption">{{ t.feeAmountPaise | inr }}<br />{{ t.feePercentage }}% of {{ t.annualCtcPaise | inr }}</td>
              <td><gh-status kind="tracking" [value]="t.trackingStatus" />@if (t.billingStatus) { <div style="margin-top:4px"><gh-status kind="billing" [value]="t.billingStatus" /></div> }</td>
              <td>@if (t.trackingStatus === 'TRACKING') {
                <div class="stack-sm" style="gap:4px"><button class="btn btn-secondary btn-sm" (click)="still(t)">Still employed</button><button class="btn btn-ghost btn-sm" (click)="left(t)">Left early</button>
                  @if (t.stillEmployedConfirmedAt) { <span class="caption">Confirmed {{ t.stillEmployedConfirmedAt | ghDate }}</span> }</div>
              } @else if (t.trackingStatus === 'AWAITING_CONFIRMATION') { <span class="caption">Awaiting employer</span> }</td>
            </tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
  styles: `.dots { display: flex; gap: 4px; } .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--border-strong); } .dot.done { background: var(--primary); border-color: var(--primary); }`,
})
export class TrackingPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly list = loader(() => this.api.get<TrackRow[]>('/recruitment/tracking'), isEmptyArray);
  protected pct = (t: TrackRow) => Math.max(0, Math.min(100, (t.daysElapsed / t.paymentTriggerDays) * 100));
  async still(t: TrackRow) {
    try {
      await this.api.post(`/recruitment/joinings/${t.id}/still-employed`);
      this.toast.success('Confirmed still employed');
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async left(t: TrackRow) {
    const r = await this.confirm.ask({ title: `Record that ${t.candidateName} left?`, message: 'The consultant fee will be cancelled per the agreement. Leaving date is recorded as today.', confirmText: 'Record exit', tone: 'danger', reasonLabel: 'Reason' });
    if (!r.ok) return;
    try {
      await this.api.post(`/recruitment/joinings/${t.id}/left`, { leftOn: new Date().toISOString().slice(0, 10), reason: r.reason.trim() });
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, DatePipe, InrPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Billing</h1><p>Consultant fees for your placements (read-only).</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No billing records yet" emptyText="A record is created when a joining is confirmed by both sides." emptyIcon="rupee">
        <div class="table-wrap"><table class="table"><thead><tr><th>Candidate</th><th>Company</th><th>Joined</th><th>Billable from</th><th class="num">Annual CTC</th><th class="num">Fee</th><th>Status</th></tr></thead>
          <tbody>@for (b of list.data(); track b['id']) {
            <tr><td>{{ b['candidateName'] }}<div class="caption">{{ b['roleTitle'] }}</div></td><td>{{ b['company'] }}</td><td class="caption">{{ b['joiningDate'] | ghDate }}</td>
              <td class="caption">{{ b['billingDueDate'] | ghDate }}</td><td class="num">{{ b['annualCtcPaise'] | inr }}</td>
              <td class="num">{{ b['feeAmountPaise'] | inr }}<div class="caption">{{ b['feePercentage'] }}%</div></td><td><gh-status kind="billing" [value]="b['status']" /></td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class BillingPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<Row[]>('/recruitment/billing'), isEmptyArray);
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecuritySettingsComponent],
  template: `<div class="page page-narrow"><div class="page-header"><div><h1>Settings</h1><p>Change the temporary password you were given on first sign-in.</p></div></div><gh-security-settings /></div>`,
})
export class SettingsPage {}

