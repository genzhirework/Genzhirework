import { CdkDrag, CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, ApiError, DatePipe, isEmptyArray, loader, statusOf } from '@gh/core';
import {
  AvatarComponent, CandidateProfileComponent, ConfirmService, IconComponent, PageStateComponent, StatusBadgeComponent, TimelineComponent,
  ToastService,
} from '@gh/ui';

interface AppRow {
  id: string;
  status: string;
  appliedAt: string;
  statusChangedAt: string;
  matchScore: number | null;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  candidateName: string;
  city: string | null;
  headline: string | null;
  education: { degree: string | null; graduationYear: number | null } | null;
  skills: { name: string }[] | null;
}

const ORDER = ['APPLIED', 'VIEWED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED'];
const COLUMNS = [
  { key: 'NEW', label: 'Applied', statuses: ['APPLIED', 'VIEWED'], target: null },
  { key: 'SCREENING', label: 'Screening', statuses: ['SCREENING'], target: 'SCREENING' },
  { key: 'SHORTLISTED', label: 'Shortlisted', statuses: ['SHORTLISTED'], target: 'SHORTLISTED' },
  { key: 'INTERVIEW', label: 'Interview', statuses: ['INTERVIEW'], target: 'INTERVIEW' },
  { key: 'SELECTED', label: 'Selected', statuses: ['SELECTED'], target: 'SELECTED' },
  { key: 'REJECTED', label: 'Rejected', statuses: ['REJECTED'], target: 'REJECTED' },
];
const NEEDS_CONFIRM = new Set(['SELECTED', 'REJECTED']);

/** Shared status-change flow (confirmation for irreversible moves — spec §26). */
async function changeStatus(api: Api, confirm: ConfirmService, toast: ToastService, a: { id: string; status: string; candidateName: string }, to: string) {
  const backward = ORDER.indexOf(to) >= 0 && ORDER.indexOf(to) < ORDER.indexOf(a.status);
  let note: string | undefined;
  if (NEEDS_CONFIRM.has(to) || backward || a.status === 'REJECTED') {
    const r = await confirm.ask({
      title: to === 'REJECTED' ? `Reject ${a.candidateName}?` : to === 'SELECTED' ? `Mark ${a.candidateName} as selected?` : `Move ${a.candidateName} back to ${statusOf('application', to).label}?`,
      message: to === 'REJECTED' ? 'The candidate will be told they were not selected.' : to === 'SELECTED' ? 'The candidate will be notified that they were selected.' : 'Backward moves are not shown to the candidate.',
      confirmText: to === 'REJECTED' ? 'Reject candidate' : to === 'SELECTED' ? 'Mark as selected' : 'Move back',
      tone: to === 'REJECTED' ? 'danger' : 'primary',
      reasonLabel: 'Internal note (optional)',
      reasonOptional: true,
    });
    if (!r.ok) return false;
    note = r.reason.trim() || undefined;
  }
  try {
    await api.post(`/employer/applications/${a.id}/status`, { toStatus: to, note, confirm: true });
    toast.success(`Moved to ${statusOf('application', to).label}`);
    return true;
  } catch (e) {
    toast.error(e);
    return false;
  }
}

@Component({
  selector: 'app-applications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, PageStateComponent, StatusBadgeComponent, AvatarComponent, IconComponent, AgoPipe],
  template: `
    <div class="page">
      @if (jobId()) { <nav class="breadcrumb"><a routerLink="/jobs">Jobs</a> / {{ jobTitle() }}</nav> }
      <div class="page-header">
        <div><h1>{{ jobId() ? jobTitle() || 'Applicants' : 'Applications' }}</h1><p>{{ (list.data() ?? []).length }} applicant{{ (list.data() ?? []).length === 1 ? '' : 's' }}</p></div>
        <div class="row">
          @if (jobId()) {
            <div class="row-sm" role="group" aria-label="View">
              <button class="btn btn-sm" [class.btn-secondary]="view() === 'board'" [class.btn-ghost]="view() !== 'board'" (click)="view.set('board')"><gh-icon name="kanban" [size]="14" />Board</button>
              <button class="btn btn-sm" [class.btn-secondary]="view() === 'table'" [class.btn-ghost]="view() !== 'table'" (click)="view.set('table')"><gh-icon name="list" [size]="14" />Table</button>
            </div>
            <a class="btn btn-ghost btn-sm" [routerLink]="['/jobs', jobId(), 'edit']">Edit job</a>
          }
        </div>
      </div>
      <gh-page-state [state]="list" [skeleton]="view() === 'board' ? 'cards' : 'table'" emptyTitle="No applicants yet" emptyText="Share your job link, or search the talent database for candidates." emptyIcon="inbox">
        <a empty class="btn btn-primary" routerLink="/talent">Find talent</a>
        @if (view() === 'board') {
          <p class="caption" style="margin-bottom:8px">Drag cards forward to progress candidates. To move back, use the status menu on the card.</p>
          <div class="kanban" cdkDropListGroup>
            @for (c of columns; track c.key) {
              <div class="kanban-col">
                <div class="kanban-col-head"><span>{{ c.label }}</span><span class="badge">{{ byColumn()[c.key].length }}</span></div>
                <div class="kanban-list" cdkDropList [cdkDropListData]="c" (cdkDropListDropped)="drop($event)" [id]="c.key">
                  @for (a of byColumn()[c.key]; track a.id) {
                    <div class="kanban-card" cdkDrag [cdkDragData]="a">
                      <div class="row-sm" style="flex-wrap:nowrap"><gh-avatar [name]="a.candidateName" [seed]="a.candidateId" [size]="28" />
                        <a class="row-link truncate" [routerLink]="['/applications', a.id]">{{ a.candidateName }}</a></div>
                      <p class="caption truncate" style="margin-top:6px">{{ a.headline || (a.education?.degree ?? '') + (a.education?.graduationYear ? ' · ' + a.education.graduationYear : '') }}</p>
                      <div class="row between" style="margin-top:8px">
                        @if (a.matchScore !== null) { <span class="caption">{{ a.matchScore }}% match</span> } @else { <span></span> }
                        <select class="select mini" [ngModel]="a.status" (ngModelChange)="move(a, $event)" [attr.aria-label]="'Status for ' + a.candidateName" (mousedown)="$event.stopPropagation()">
                          @for (s of statuses; track s) { <option [value]="s" [disabled]="s === 'APPLIED' || s === 'VIEWED'">{{ label(s) }}</option> }</select>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Candidate</th>@if (!jobId()) { <th>Job</th> }<th>Education</th><th>Match</th><th>Status</th><th>Applied</th></tr></thead>
              <tbody>
                @for (a of list.data(); track a.id) {
                  <tr>
                    <td><div class="row" style="flex-wrap:nowrap"><gh-avatar [name]="a.candidateName" [seed]="a.candidateId" [size]="28" />
                      <div><a class="row-link" [routerLink]="['/applications', a.id]">{{ a.candidateName }}</a><div class="caption">{{ a.city }}</div></div></div></td>
                    @if (!jobId()) { <td><a [routerLink]="['/jobs', a.jobId, 'applications']">{{ a.jobTitle }}</a></td> }
                    <td class="caption">{{ a.education?.degree }}{{ a.education?.graduationYear ? ' · ' + a.education.graduationYear : '' }}</td>
                    <td class="caption">{{ a.matchScore !== null ? a.matchScore + '%' : '—' }}</td>
                    <td><gh-status kind="application" [value]="a.status" /></td>
                    <td class="caption">{{ a.appliedAt | ago }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </gh-page-state>
    </div>`,
  styles: `.mini { width: auto; min-height: 28px; padding: 2px 6px; font-size: var(--fs-caption) !important; }`,
})
export class ApplicationsPage implements OnInit {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  readonly id = input<string>();
  protected readonly jobId = computed(() => this.id());
  protected readonly view = signal<'board' | 'table'>('board');
  protected readonly columns = COLUMNS;
  protected readonly statuses = ['APPLIED', 'VIEWED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'];
  protected readonly list = loader(() => this.api.get<AppRow[]>('/employer/applications', { jobId: this.jobId() }), isEmptyArray);
  protected readonly jobTitle = computed(() => this.list.data()?.[0]?.jobTitle ?? '');
  protected readonly byColumn = computed(() => {
    const out: Record<string, AppRow[]> = Object.fromEntries(COLUMNS.map((c) => [c.key, []]));
    for (const a of this.list.data() ?? []) out[COLUMNS.find((c) => c.statuses.includes(a.status))?.key ?? 'NEW'].push(a);
    return out;
  });
  protected label = (s: string) => statusOf('application', s).label;

  ngOnInit() {
    if (!this.id()) this.view.set('table');
  }

  async drop(e: CdkDragDrop<(typeof COLUMNS)[number]>) {
    if (e.previousContainer === e.container) return;
    const a = e.item.data as AppRow;
    const target = e.container.data.target;
    if (!target) return;
    const backward = ORDER.indexOf(target) >= 0 && ORDER.indexOf(target) < ORDER.indexOf(a.status);
    if (backward || a.status === 'REJECTED') {
      this.toast.info('To move a candidate back, use the status menu on their card.');
      return;
    }
    await this.move(a, target);
  }

  async move(a: AppRow, to: string) {
    if (to === a.status) return;
    await changeStatus(this.api, this.confirm, this.toast, a, to);
    await this.list.reload();
  }
}

interface AppDetail {
  id: string;
  status: string;
  appliedAt: string;
  coverNote: string | null;
  matchScore: number | null;
  job: { id: string; title: string };
  history: { fromStatus: string | null; toStatus: string; note: string | null; createdAt: string; users: { fullName: string | null } | null }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  candidate: any;
  allowedTransitions: Record<string, unknown>;
}

@Component({
  selector: 'app-application-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageStateComponent, CandidateProfileComponent, StatusBadgeComponent, TimelineComponent, IconComponent, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <gh-page-state [state]="app">
        @if (app.data(); as a) {
          <nav class="breadcrumb"><a routerLink="/applications">Applications</a> / <a [routerLink]="['/jobs', a.job.id, 'applications']">{{ a.job.title }}</a> / {{ a.candidate.displayName }}</nav>
          <div class="page-header">
            <div class="row"><h1 style="font-size:1.5rem">{{ a.candidate.displayName }}</h1><gh-status kind="application" [value]="a.status" /></div>
            <div class="row">
              <button class="btn btn-secondary" type="button" (click)="resume()"><gh-icon name="download" [size]="16" />Resume</button>
              @for (t of transitions(a); track t) {
                <button class="btn" [class.btn-danger]="t === 'REJECTED'" [class.btn-primary]="t !== 'REJECTED' && t !== 'SCREENING'" [class.btn-secondary]="t === 'SCREENING'" type="button" (click)="move(a, t)">{{ label(t) }}</button>
              }
            </div>
          </div>
          <gh-candidate-profile [profile]="a.candidate" level="CONTACT">
            <div aside class="stack">
              <section class="card stack-sm"><h3>Application</h3>
                <p class="caption">Applied {{ a.appliedAt | ghDate: true }} for <a [routerLink]="['/jobs', a.job.id, 'applications']">{{ a.job.title }}</a></p>
                @if (a.matchScore !== null) { <p><strong>{{ a.matchScore }}%</strong>&ngsp;<span class="caption">of the job's skills are on this profile</span></p> }
                @if (a.coverNote) { <div class="note"><span class="overline">Cover note</span><p class="pre-line">{{ a.coverNote }}</p></div> }
              </section>
              <section class="card"><h3 style="margin-bottom:12px">History</h3><gh-timeline [items]="timeline(a)" /></section>
              <section class="card stack-sm"><h3>Team notes</h3>
                <p class="caption">Private to your company. The candidate never sees these.</p>
                <textarea class="textarea" [(ngModel)]="noteText" placeholder="Add a note…" aria-label="New note" maxlength="4000"></textarea>
                <button class="btn btn-secondary btn-sm" style="align-self:flex-end" type="button" [disabled]="!noteText.trim()" (click)="addNote(a)">Add note</button>
                @for (n of notes(); track n.id) { <div class="note"><p class="pre-line">{{ n.body }}</p><span class="caption">{{ n.users?.fullName }} · {{ n.createdAt | ago }}</span></div> }
              </section>
            </div>
          </gh-candidate-profile>
        }
      </gh-page-state>
    </div>`,
  styles: `.note { padding: 10px 12px; background: var(--bg-subtle); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; }`,
})
export class ApplicationDetailPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  protected readonly app = loader(async () => {
    const a = await this.api.get<AppDetail>(`/employer/applications/${this.id()}`);
    void this.loadNotes(a.candidate.candidateId);
    return a;
  });
  protected readonly notes = signal<{ id: string; body: string; createdAt: string; users: { fullName: string } | null }[]>([]);
  protected noteText = '';
  protected label = (s: string) => ({ SCREENING: 'Move to screening', SHORTLISTED: 'Shortlist', INTERVIEW: 'Move to interview', SELECTED: 'Select', REJECTED: 'Reject' })[s] ?? statusOf('application', s).label;
  protected transitions = (a: AppDetail) => Object.keys(a.allowedTransitions);
  protected timeline = (a: AppDetail) => a.history.map((h) => ({ label: statusOf('application', h.toStatus).label, at: h.createdAt, note: h.note, by: h.users?.fullName ?? (h.toStatus === 'VIEWED' ? 'Automatic' : null) }));

  private async loadNotes(candidateId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = await this.api.get<any>(`/candidates/${candidateId}`).catch(() => null);
    this.notes.set(v?.notes ?? []);
  }
  async move(a: AppDetail, to: string) {
    if (await changeStatus(this.api, this.confirm, this.toast, { id: a.id, status: a.status, candidateName: a.candidate.displayName }, to)) await this.app.reload();
  }
  resume() {
    void this.api.download(`/employer/applications/${this.id()}/resume`, 'resume.pdf').catch((e) => this.toast.error(ApiError.from(e).code === 'NOT_FOUND' ? 'Resume not available' : e));
  }
  async addNote(a: AppDetail) {
    try {
      await this.api.post(`/employer/candidates/${a.candidate.candidateId}/notes`, { body: this.noteText.trim() });
      this.noteText = '';
      await this.loadNotes(a.candidate.candidateId);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
