import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, DatePipe, InrPipe, isEmptyArray, isEmptyPage, LabelPipe, loader, Page, salaryRange } from '@gh/core';
import { ConfirmService, IconComponent, ModalComponent, PageStateComponent, StatusBadgeComponent, ToastService } from '@gh/ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ------------------------------------------------------ employer verification

@Component({
  selector: 'app-verification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, IconComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Employer verification</h1><p>Approving grants the employer's one-time free profile views.</p></div></div>
      <div class="split">
        <gh-page-state [state]="queue" skeleton="table" emptyTitle="Queue is empty" emptyText="No verifications waiting for review." emptyIcon="shield">
          <div class="card card-flush list">
            @for (v of queue.data(); track v['id']) {
              <button class="item" [class.active]="sel()?.['id'] === v['id']" (click)="sel.set(v)">
                <div class="row between"><strong>{{ v['employerName'] }}</strong><gh-status kind="verification" [value]="v['status']" /></div>
                <span class="caption">{{ v['primaryDomain'] || 'personal email' }} · submitted {{ v['createdAt'] | ago }}</span></button>
            }
          </div>
        </gh-page-state>
        @if (sel(); as v) {
          <section class="card stack">
            <div class="row between"><h2>{{ v['employerName'] }}</h2><gh-status kind="verification" [value]="v['status']" /></div>
            <dl class="kv">
              <dt>Submitted by</dt><dd>{{ v['submittedByEmail'] }}</dd>
              <dt>Account domain</dt><dd>{{ v['primaryDomain'] || 'Free-mail (document required)' }}</dd>
              <dt>Website</dt><dd>@if (v['website'] || v['companyWebsite']) { <a [href]="v['website'] || v['companyWebsite']" target="_blank" rel="noopener noreferrer">{{ v['website'] || v['companyWebsite'] }} <gh-icon name="external" [size]="12" /></a> } @else { — }</dd>
              <dt>Official email</dt><dd>{{ v['officialEmail'] || '—' }}</dd>
              <dt>Registration</dt><dd>{{ v['registrationType'] | label }} <code>{{ v['registrationNumber'] || '—' }}</code></dd>
              <dt>Contact</dt><dd>{{ v['contactName'] }} · {{ v['contactPhoneE164'] }}</dd>
              <dt>Documents</dt><dd>{{ (v['documentFileIds'] ?? []).length }} uploaded</dd>
              <dt>Submitted</dt><dd>{{ v['createdAt'] | ghDate: true }}</dd>
            </dl>
            <div class="checklist card card-tight stack-sm"><strong>Checklist</strong>
              <span class="caption">□ Website resolves and matches the company name · □ Registration ID matches GST/MCA public search · □ Official email domain matches · □ No duplicate employer for this domain/ID</span></div>
            <div class="form-actions">
              @if (v['status'] === 'SUBMITTED') { <button class="btn btn-ghost" (click)="decide(v, 'start-review')">Start review</button> }
              <button class="btn btn-secondary" (click)="decide(v, 'request-info')">Request info</button>
              <button class="btn btn-danger" (click)="decide(v, 'reject')">Reject</button>
              <button class="btn btn-primary" (click)="decide(v, 'approve')"><gh-icon name="check" [size]="16" />Approve</button>
            </div>
          </section>
        } @else { <div class="card"><p class="secondary">Select a submission to review.</p></div> }
      </div>
    </div>`,
  styles: `.split { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 16px; align-items: start; }
    .list .item { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 12px 16px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text); text-align: left; cursor: pointer; }
    .list .item:hover { background: var(--surface-hover); } .list .item.active { background: var(--primary-tint); }
    @media (max-width: 1023px) { .split { grid-template-columns: 1fr; } }`,
})
export class VerificationPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly queue = loader(() => this.api.get<Row[]>('/admin/verifications'), isEmptyArray);
  protected readonly sel = signal<Row | null>(null);
  async decide(v: Row, d: 'approve' | 'reject' | 'request-info' | 'start-review') {
    let reason: string | undefined;
    if (d !== 'start-review') {
      const r = await this.confirm.ask({
        title: { approve: `Approve ${v['employerName']}?`, reject: `Reject ${v['employerName']}?`, 'request-info': 'Request more information' }[d],
        message: d === 'approve' ? 'The employer becomes Verified and receives its free profile-view credits.' : 'The employer sees this message.',
        confirmText: { approve: 'Approve', reject: 'Reject', 'request-info': 'Send request' }[d], tone: d === 'reject' ? 'danger' : 'primary',
        reasonLabel: d === 'approve' ? 'Note (optional)' : 'Message to employer', reasonOptional: d === 'approve',
      });
      if (!r.ok) return;
      reason = r.reason.trim() || undefined;
    }
    try {
      await this.api.post(`/admin/verifications/${v['id']}/${d}`, { reason });
      this.toast.success(d === 'approve' ? 'Employer verified — credits granted' : 'Updated');
      this.sel.set(null);
      await this.queue.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

// ------------------------------------------------------------ job moderation

@Component({
  selector: 'app-jobs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageStateComponent, StatusBadgeComponent, LabelPipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Job moderation</h1><p>Review new jobs for scams, payment requests and misleading content.</p></div>
        <select class="select" style="width:auto" [(ngModel)]="status" (ngModelChange)="jobs.reload()" aria-label="Status">
          <option value="PENDING_APPROVAL">Pending approval</option><option value="PUBLISHED">Published</option><option value="REJECTED">Rejected</option><option value="">All</option></select></div>
      <gh-page-state [state]="jobs" skeleton="table" emptyTitle="Nothing to moderate" emptyIcon="briefcase">
        <div class="stack-sm">
          @for (j of jobs.data(); track j['id']) {
            <article class="card stack-sm">
              <div class="row between"><div><strong>{{ j['title'] }}</strong> · {{ j['company'] }} <gh-status kind="verification" [value]="j['verificationStatus']" /></div><gh-status kind="job" [value]="j['status']" /></div>
              <p class="caption">{{ j['cities'].join(', ') }} · {{ j['workMode'] | label }} · {{ j['employmentType'] | label }} · {{ salary(j) }} · created {{ j['createdAt'] | ago }}
                @if (j['reports']) { · <strong style="color:var(--danger)">{{ j['reports'] }} report(s)</strong> }</p>
              <p class="secondary pre-line clamp">{{ j['descriptionPreview'] }}</p>
              @if (flags(j).length) { <div class="row-sm">@for (f of flags(j); track f) { <span class="badge badge-danger">⚠ {{ f }}</span> }</div> }
              <div class="form-actions">
                @if (j['status'] === 'PENDING_APPROVAL') { <button class="btn btn-danger btn-sm" (click)="reject(j)">Reject</button><button class="btn btn-primary btn-sm" (click)="approve(j)">Approve & publish</button> }
                @else if (j['status'] === 'PUBLISHED') { <button class="btn btn-danger btn-sm" (click)="reject(j)">Take down</button> }
              </div>
            </article>
          }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }`,
})
export class JobsPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected status = 'PENDING_APPROVAL';
  protected readonly jobs = loader(() => this.api.get<Row[]>('/admin/jobs', { status: this.status }), isEmptyArray);
  protected salary = (j: Row) => salaryRange(j['salaryMinPaise'], j['salaryMaxPaise']);
  /** Heuristic scam signals shown to moderators (docs/13-security.md §1). */
  protected flags(j: Row) {
    const t = `${j['title']} ${j['descriptionPreview']}`.toLowerCase();
    const out: string[] = [];
    if (/registration fee|security deposit|pay .*(fee|deposit)|training fee|processing fee/.test(t)) out.push('Mentions payment by candidate');
    if (/whatsapp|telegram/.test(t)) out.push('Off-platform contact');
    if (/guaranteed|100% placement|earn .* per day/.test(t)) out.push('Unrealistic promises');
    return out;
  }
  async approve(j: Row) {
    try {
      await this.api.post(`/admin/jobs/${j['id']}/approve`, {});
      this.toast.success('Job published');
      await this.jobs.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async reject(j: Row) {
    const r = await this.confirm.ask({ title: `${j['status'] === 'PUBLISHED' ? 'Take down' : 'Reject'} "${j['title']}"?`, message: 'The employer sees your reason.', confirmText: j['status'] === 'PUBLISHED' ? 'Take down' : 'Reject', tone: 'danger', reasonLabel: 'Reason' });
    if (!r.ok) return;
    try {
      await this.api.post(`/admin/jobs/${j['id']}/reject`, { reason: r.reason.trim() });
      await this.jobs.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-applications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Applications</h1><p>Read-only view across all employers.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No applications yet" emptyIcon="inbox">
        <div class="table-wrap"><table class="table table-compact"><thead><tr><th>Candidate</th><th>Job</th><th>Company</th><th>Status</th><th>Applied</th></tr></thead>
          <tbody>@for (a of list.data()?.data; track a['id']) {
            <tr><td>{{ a['candidate'] }}</td><td>{{ a['jobTitle'] }}</td><td>{{ a['company'] }}</td><td><gh-status kind="application" [value]="a['status']" /></td><td class="caption">{{ a['appliedAt'] | ghDate }}</td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class ApplicationsPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<Page<Row>>('/admin/applications'), isEmptyPage);
}

// ------------------------------------------------- requirements / recruitment

@Component({
  selector: 'app-requirements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageStateComponent, StatusBadgeComponent, ModalComponent, LabelPipe, DatePipe, InrPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Hiring requirements</h1><p>Open a recruitment case and assign recruiters for consultant requirements.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No hiring requirements" emptyIcon="clipboard">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Role</th><th>Company</th><th>Mode</th><th>Status</th><th>CTC</th><th>Recruiters</th><th>Raised</th><th></th></tr></thead>
          <tbody>@for (r of list.data(); track r['id']) {
            <tr><td><strong>{{ r['roleTitle'] }}</strong><div class="caption">{{ r['openings'] }} opening(s) · {{ r['locations'].join(', ') }}</div></td>
              <td>{{ r['company'] }}<div><gh-status kind="verification" [value]="r['verificationStatus']" /></div></td><td class="caption">{{ r['fulfilmentMode'] | label }}</td>
              <td><gh-status kind="requirement" [value]="r['status']" /></td><td class="caption">{{ r['ctcMinPaise'] | inr }}–{{ r['ctcMaxPaise'] | inr }}</td>
              <td class="caption">{{ r['recruiters'] || '—' }}</td><td class="caption">{{ r['createdAt'] | ghDate }}</td>
              <td>@if (!r['caseId'] && r['fulfilmentMode'] !== 'DATABASE' && !['CANCELLED', 'CLOSED'].includes(r['status'])) { <button class="btn btn-primary btn-sm" (click)="startOpen(r)">Open case</button> }</td></tr>
          }</tbody></table></div>
      </gh-page-state>
      <gh-modal [open]="!!target()" title="Open recruitment case" [subtitle]="target()?.['roleTitle'] + ' · ' + target()?.['company']" (closed)="target.set(null)">
        <div class="stack">
          <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label req">Assign recruiters</legend>
            @for (r of recruiters(); track r['id']) { <label class="check"><input type="checkbox" [checked]="picked().includes(r['id'])" (change)="toggle(r['id'])" />{{ r['displayName'] }} <span class="caption">({{ r['activeCases'] }}/{{ r['maxActiveCases'] }} active)</span></label> }
            @empty { <p class="caption">Create a recruiter first.</p> }</fieldset>
          <div class="form-grid">
            <div class="field"><label for="fee">Fee % (blank = agreement/default)</label><input id="fee" class="input" type="number" step="0.01" [(ngModel)]="fee" placeholder="8.33" /></div>
            <div class="field"><label for="days">Trigger days (blank = default)</label><input id="days" class="input" type="number" [(ngModel)]="days" placeholder="90" /></div>
          </div>
          <p class="caption">Leave blank to use the employer's active agreement, or create one from system defaults. Values are snapshotted onto each placement.</p>
        </div>
        <ng-container footer><button class="btn btn-secondary" (click)="target.set(null)">Cancel</button><button class="btn btn-primary" [disabled]="!picked().length" (click)="open()">Open case</button></ng-container>
      </gh-modal>
    </div>`,
})
export class RequirementsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<Row[]>('/admin/hiring-requirements'), isEmptyArray);
  protected readonly target = signal<Row | null>(null);
  protected readonly recruiters = signal<Row[]>([]);
  protected readonly picked = signal<string[]>([]);
  protected fee: number | null = null;
  protected days: number | null = null;
  async startOpen(r: Row) {
    this.recruiters.set((await this.api.get<Row[]>('/admin/recruiters')).filter((x) => x['status'] === 'ACTIVE'));
    this.picked.set([]);
    this.fee = null;
    this.days = null;
    this.target.set(r);
  }
  toggle(id: string) {
    this.picked.update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  async open() {
    try {
      await this.api.post(`/admin/hiring-requirements/${this.target()!['id']}/open-case`, {
        recruiterIds: this.picked(), feePercentage: this.fee ? Number(this.fee) : undefined, paymentTriggerDays: this.days ? Number(this.days) : undefined,
      });
      this.toast.success('Case opened and recruiters notified');
      this.target.set(null);
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-recruitment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Recruitment cases</h1></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No cases yet" emptyIcon="kanban">
        <div class="table-wrap"><table class="table"><thead><tr><th>Role</th><th>Company</th><th>Status</th><th>Terms</th><th class="num">Pipeline</th><th class="num">Submitted</th><th class="num">Joined</th><th>Recruiters</th><th>Opened</th></tr></thead>
          <tbody>@for (c of list.data(); track c['id']) {
            <tr><td><strong>{{ c['roleTitle'] }}</strong><div class="caption">{{ c['openings'] }} opening(s)</div></td><td>{{ c['company'] }}</td><td><gh-status kind="case" [value]="c['status']" /></td>
              <td class="caption">{{ c['feePercentage'] }}% · {{ c['paymentTriggerDays'] }}d</td><td class="num">{{ c['pipeline'] }}</td><td class="num">{{ c['submitted'] }}</td><td class="num">{{ c['joined'] }}</td>
              <td class="caption">{{ c['recruiters'] }}</td><td class="caption">{{ c['openedAt'] | ghDate }}</td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
})
export class RecruitmentPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<Row[]>('/admin/recruitment/cases'), isEmptyArray);
}

@Component({
  selector: 'app-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, DatePipe, InrPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Consultant billing</h1><p>Fee = annual CTC × agreement fee %, billable after the trigger period with a "still employed" confirmation.</p></div></div>
      <div class="grid-auto" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:16px">
        @for (s of summary(); track s.status) { <div class="card card-tight stat"><span class="label"><gh-status kind="billing" [value]="s.status" /></span><span class="value">{{ s.total | inr }}</span><span class="caption">{{ s.count }} placement(s)</span></div> }
      </div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No placements yet" emptyIcon="rupee">
        <div class="table-wrap"><table class="table"><thead><tr><th>Candidate</th><th>Company</th><th>Joined</th><th>Billable from</th><th class="num">Annual CTC</th><th class="num">Fee</th><th>Status</th><th></th></tr></thead>
          <tbody>@for (b of list.data(); track b['id']) {
            <tr><td>{{ b['candidateName'] }}<div class="caption">{{ b['roleTitle'] }}</div></td><td>{{ b['company'] }}</td><td class="caption">{{ b['joiningDate'] | ghDate }}</td>
              <td class="caption">{{ b['billingDueDate'] | ghDate }}</td><td class="num">{{ b['annualCtcPaise'] | inr }}</td><td class="num">{{ b['feeAmountPaise'] | inr }}<div class="caption">{{ b['feePercentage'] }}%</div></td>
              <td><gh-status kind="billing" [value]="b['status']" />@if (b['statusReason']) { <div class="caption">{{ b['statusReason'] }}</div> }</td>
              <td>@if (['PENDING_TRIGGER', 'BILLABLE'].includes(b['status'])) { <button class="btn btn-ghost btn-sm" (click)="waive(b)">Waive</button> }</td></tr>
          }</tbody></table></div>
        <p class="caption" style="margin-top:12px">Invoice generation (GST, gapless numbering, PDF) and payment recording are Phase 5 — see docs/15-roadmap.md.</p>
      </gh-page-state>
    </div>`,
})
export class BillingPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<Row[]>('/recruitment/billing'), isEmptyArray);
  protected readonly summary = computed(() => {
    const m = new Map<string, { status: string; total: number; count: number }>();
    for (const b of this.list.data() ?? []) {
      const e = m.get(b['status']) ?? { status: b['status'], total: 0, count: 0 };
      e.total += Number(b['feeAmountPaise']);
      e.count++;
      m.set(b['status'], e);
    }
    return [...m.values()];
  });
  async waive(b: Row) {
    const r = await this.confirm.ask({ title: 'Waive this consultant fee?', confirmText: 'Waive fee', tone: 'danger', reasonLabel: 'Reason (audited)' });
    if (!r.ok) return;
    try {
      await this.api.post(`/admin/billing/${b['id']}/waive`, { reason: r.reason.trim() });
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

// ------------------------------------------------------------------- logs

@Component({
  selector: 'app-access-logs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Profile access logs</h1><p>Every full-profile view, resume download and contact reveal (spec §24).</p></div></div>
      <form class="row card card-tight" style="margin-bottom:16px" (ngSubmit)="reload()">
        <select class="select" name="a" [(ngModel)]="action" style="width:auto" aria-label="Action"><option value="">All actions</option><option value="FULL_PROFILE_VIEW">Profile views</option><option value="RESUME_DOWNLOAD">Resume downloads</option><option value="CONTACT_REVEAL">Contact reveals</option></select>
        <input class="input" name="e" [(ngModel)]="employerId" placeholder="Employer ID (optional)" style="max-width:320px" aria-label="Employer ID" />
        <button class="btn btn-secondary" type="submit">Filter</button></form>
      <gh-page-state [state]="logs" skeleton="table" emptyTitle="No access recorded" emptyIcon="eye">
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>When</th><th>Employer / viewer</th><th>Candidate</th><th>Action</th><th>Basis</th><th class="num">Credits</th><th>IP / device</th></tr></thead>
          <tbody>@for (l of rows(); track l['id']) {
            <tr><td class="caption">{{ l['createdAt'] | ghDate: true }}</td>
              <td>@if (l['employerId']) { <a [routerLink]="['/employers', l['employerId']]">{{ l['employer'] }}</a> } @else { {{ l['viewerType'] | label }} }<div class="caption">{{ l['viewerEmail'] }}</div></td>
              <td><a [routerLink]="['/candidates', l['candidateId']]">{{ l['candidate'] }}</a></td><td class="caption">{{ l['action'] | label }}</td>
              <td class="caption">{{ l['accessBasis'] | label }}</td><td class="num">{{ l['creditsConsumed'] || '' }}</td>
              <td class="caption" [title]="l['userAgent'] || ''">{{ l['ip'] || '—' }}</td></tr>
          }</tbody></table></div>
        @if (cursor()) { <div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-secondary btn-sm" (click)="more()">Load more</button></div> }
      </gh-page-state>
    </div>`,
})
export class AccessLogsPage {
  private readonly api = inject(Api);
  protected action = '';
  protected employerId = '';
  protected readonly rows = signal<Row[]>([]);
  protected readonly cursor = signal<string | null>(null);
  private params = () => ({ action: this.action, employerId: this.employerId.trim() });
  protected readonly logs = loader(async () => {
    const p = await this.api.get<Page<Row>>('/admin/access-logs', this.params());
    this.rows.set(p.data);
    this.cursor.set(p.page.nextCursor);
    return p;
  }, isEmptyPage);
  reload() {
    void this.logs.reload();
  }
  async more() {
    const p = await this.api.get<Page<Row>>('/admin/access-logs', { ...this.params(), cursor: this.cursor() ?? '' });
    this.rows.update((r) => [...r, ...p.data]);
    this.cursor.set(p.page.nextCursor);
  }
}

@Component({
  selector: 'app-audit-logs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageStateComponent, IconComponent, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Audit log</h1><p>Append-only and hash-chained. Rows cannot be edited or deleted by the application.</p></div>
        <button class="btn btn-secondary" (click)="verify()" [disabled]="verifying()"><gh-icon name="shield" [size]="16" />Verify integrity</button></div>
      @if (chain(); as c) {
        <div class="alert" [class.alert-success]="c.ok" [class.alert-danger]="!c.ok" style="margin-bottom:16px" role="status">
          @if (c.ok) { Hash chain intact across {{ c.checked }} entries. } @else { Chain broken at entry #{{ c.brokenAt?.id }} ({{ c.brokenAt?.action }}). Investigate immediately. }</div>
      }
      <form class="row card card-tight" style="margin-bottom:16px" (ngSubmit)="logs.reload()">
        <input class="input" name="a" [(ngModel)]="action" placeholder="Action prefix, e.g. candidate." style="max-width:260px" aria-label="Action" />
        <input class="input" name="t" [(ngModel)]="entityType" placeholder="Entity type" style="max-width:180px" aria-label="Entity type" />
        <input class="input" name="i" [(ngModel)]="entityId" placeholder="Entity ID" style="max-width:320px" aria-label="Entity ID" />
        <button class="btn btn-secondary" type="submit">Filter</button></form>
      <gh-page-state [state]="logs" skeleton="table" emptyTitle="No audit entries" emptyIcon="hash">
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>Hash</th></tr></thead>
          <tbody>@for (l of logs.data()?.data; track l['id']) {
            <tr><td class="caption">{{ l['createdAt'] | ghDate: true }}</td><td>{{ l['actorEmail'] || 'System' }}<div class="caption">{{ l['actorApp'] }}</div></td>
              <td><code>{{ l['action'] }}</code></td><td class="caption">{{ l['entityType'] }}<br /><code class="id">{{ l['entityId'] }}</code></td>
              <td class="caption"><code class="meta">{{ meta(l['metadata']) }}</code></td><td class="caption"><code>{{ l['hash']?.slice(0, 10) }}…</code></td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
  styles: `code { font-size: 12px; } .id { word-break: break-all; } .meta { display: inline-block; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
})
export class AuditLogsPage {
  private readonly api = inject(Api);
  protected action = '';
  protected entityType = '';
  protected entityId = '';
  protected readonly logs = loader(() => this.api.get<Page<Row>>('/admin/audit-logs', { action: this.action.trim(), entityType: this.entityType.trim(), entityId: this.entityId.trim() }), isEmptyPage);
  protected readonly chain = signal<{ ok: boolean; checked: number; brokenAt?: { id: number; action: string } } | null>(null);
  protected readonly verifying = signal(false);
  protected meta = (m: unknown) => (m && Object.keys(m as object).length ? JSON.stringify(m) : '');
  async verify() {
    this.verifying.set(true);
    try {
      this.chain.set(await this.api.get('/admin/audit-logs/verify'));
    } finally {
      this.verifying.set(false);
    }
  }
}

// ---------------------------------------------------------- trust & safety

@Component({
  selector: 'app-security',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Trust & safety</h1><p>Security alerts from automated detectors, and abuse reports from users.</p></div></div>
      <h2 style="margin-bottom:12px">Security alerts</h2>
      <gh-page-state [state]="alerts" skeleton="table" emptyTitle="No open alerts" emptyIcon="shield">
        <div class="table-wrap"><table class="table table-compact"><thead><tr><th>When</th><th>Type</th><th>Severity</th><th>Details</th><th>Auto action</th><th></th></tr></thead>
          <tbody>@for (a of alerts.data(); track a['id']) {
            <tr><td class="caption">{{ a['createdAt'] | ghDate: true }}</td><td>{{ a['type'] | label }}</td>
              <td><span class="badge" [class.badge-danger]="['HIGH', 'CRITICAL'].includes(a['severity'])" [class.badge-warning]="a['severity'] === 'MEDIUM'">{{ a['severity'] }}</span></td>
              <td class="caption"><code>{{ json(a['details']) }}</code></td><td class="caption">{{ a['autoAction'] | label }}</td>
              <td><div class="row-sm"><button class="btn btn-ghost btn-sm" (click)="resolveAlert(a, 'RESOLVED')">Resolve</button><button class="btn btn-ghost btn-sm" (click)="resolveAlert(a, 'FALSE_POSITIVE')">False positive</button></div></td></tr>
          }</tbody></table></div>
      </gh-page-state>
      <h2 style="margin:24px 0 12px">Abuse reports</h2>
      <gh-page-state [state]="reports" skeleton="table" emptyTitle="No reports" emptyIcon="alert">
        <div class="table-wrap"><table class="table table-compact"><thead><tr><th>When</th><th>Target</th><th>Reason</th><th>Details</th><th>Status</th><th></th></tr></thead>
          <tbody>@for (r of reports.data(); track r['id']) {
            <tr><td class="caption">{{ r['createdAt'] | ghDate }}</td><td>{{ r['targetType'] | label }}: {{ r['targetLabel'] || r['targetId'] }}</td><td>{{ r['reason'] | label }}</td>
              <td class="caption">{{ r['details'] }}<div>{{ r['reporterEmail'] }}</div></td><td><gh-status kind="alert" [value]="r['status']" /></td>
              <td>@if (['OPEN', 'INVESTIGATING'].includes(r['status'])) { <div class="row-sm"><button class="btn btn-ghost btn-sm" (click)="actReport(r, 'ACTIONED')">Actioned</button><button class="btn btn-ghost btn-sm" (click)="actReport(r, 'DISMISSED')">Dismiss</button></div> }</td></tr>
          }</tbody></table></div>
      </gh-page-state>
    </div>`,
  styles: `code { font-size: 11px; }`,
})
export class SecurityPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected readonly alerts = loader(() => this.api.get<Row[]>('/admin/security-alerts'), isEmptyArray);
  protected readonly reports = loader(() => this.api.get<Row[]>('/admin/abuse-reports'), isEmptyArray);
  protected json = (d: unknown) => JSON.stringify(d);
  async resolveAlert(a: Row, status: string) {
    await this.api.post(`/admin/security-alerts/${a['id']}/resolve`, { status });
    this.toast.success('Alert updated');
    await this.alerts.reload();
  }
  async actReport(r: Row, status: string) {
    await this.api.post(`/admin/abuse-reports/${r['id']}/action`, { status, resolution: status === 'ACTIONED' ? 'Actioned by admin' : 'Dismissed' });
    await this.reports.reload();
  }
}

// ---------------------------------------------------------------- settings

@Component({
  selector: 'app-system',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageStateComponent, ModalComponent, IconComponent, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>System settings</h1><p>Business rules read these values — nothing is hard-coded. Every change needs a reason and is audited.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No settings" emptyIcon="sliders">
        @for (g of groups(); track g.name) {
          <h3 style="margin:16px 0 8px">{{ g.name }}</h3>
          <div class="table-wrap"><table class="table">
            <tbody>@for (s of g.items; track s['key']) {
              <tr><td style="width:40%"><code>{{ s['key'] }}</code><div class="caption">{{ s['description'] }}</div></td>
                <td><strong>{{ show(s['value']) }}</strong></td><td class="caption">{{ s['updatedAt'] | ghDate }}</td>
                <td><div class="row-sm" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" (click)="history(s)">History</button><button class="btn btn-secondary btn-sm" (click)="edit(s)"><gh-icon name="edit" [size]="14" />Edit</button></div></td></tr>
            }</tbody></table></div>
        }
      </gh-page-state>
      <gh-modal [open]="!!editing()" [title]="'Edit ' + editing()?.['key']" [subtitle]="editing()?.['description']" (closed)="editing.set(null)">
        @if (editing(); as s) {
          <div class="stack">
            @if (s['schema'].enum) { <div class="field"><label for="v">Value</label><select id="v" class="select" [(ngModel)]="value">@for (o of s['schema'].enum; track o) { <option [value]="o">{{ o }}</option> }</select></div> }
            @else if (s['schema'].type === 'boolean') { <label class="check"><input type="checkbox" [(ngModel)]="value" />Enabled</label> }
            @else { <div class="field"><label for="v">Value {{ s['schema'].type === 'array' ? '(comma-separated numbers)' : '' }}</label><input id="v" class="input" [(ngModel)]="value" /></div> }
            <div class="field"><label for="r" class="req">Reason for change</label><input id="r" class="input" [(ngModel)]="reason" placeholder="e.g. Commercial terms updated per agreement v2" /></div>
            @if (err()) { <div class="alert alert-danger" role="alert">{{ err() }}</div> }
            <p class="caption">Billing values only apply to new recruitment agreements — existing placements keep the values snapshotted at the time.</p>
          </div>
        }
        <ng-container footer><button class="btn btn-secondary" (click)="editing.set(null)">Cancel</button><button class="btn btn-primary" [disabled]="reason.trim().length < 3" (click)="save()">Save</button></ng-container>
      </gh-modal>
      <gh-modal [open]="!!hist()" title="Change history" (closed)="hist.set(null)" size="lg">
        <table class="table table-compact"><thead><tr><th>When</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
          <tbody>@for (h of hist() ?? []; track h['id']) { <tr><td class="caption">{{ h['changedAt'] | ghDate: true }}</td><td>{{ show(h['oldValue']) }}</td><td>{{ show(h['newValue']) }}</td><td class="caption">{{ h['reason'] }}</td></tr> }
            @empty { <tr><td class="caption">No changes yet.</td></tr> }</tbody></table>
      </gh-modal>
    </div>`,
})
export class SystemPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<Row[]>('/admin/settings'), isEmptyArray);
  protected readonly groups = computed(() => {
    const g = new Map<string, Row[]>();
    for (const s of this.list.data() ?? []) {
      const k = { billing: 'Billing', entitlements: 'Entitlements', talent: 'Talent database', jobs: 'Jobs', contact_requests: 'Contact requests' }[s['key'].split('.')[0] as 'billing'] ?? 'Other';
      g.set(k, [...(g.get(k) ?? []), s]);
    }
    return [...g.entries()].map(([name, items]) => ({ name, items }));
  });
  protected readonly editing = signal<Row | null>(null);
  protected readonly hist = signal<Row[] | null>(null);
  protected readonly err = signal<string | null>(null);
  protected value: unknown = '';
  protected reason = '';
  protected show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));
  edit(s: Row) {
    this.value = Array.isArray(s['value']) ? s['value'].join(', ') : s['value'];
    this.reason = '';
    this.err.set(null);
    this.editing.set(s);
  }
  async history(s: Row) {
    this.hist.set(await this.api.get<Row[]>(`/admin/settings/${s['key']}/history`));
  }
  async save() {
    const s = this.editing()!;
    const t = s['schema'].type;
    let v: unknown = this.value;
    if (t === 'number' || t === 'integer') v = Number(this.value);
    if (t === 'array') v = String(this.value).split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
    try {
      await this.api.put(`/admin/settings/${s['key']}`, { value: v, reason: this.reason.trim() });
      this.toast.success('Setting updated');
      this.editing.set(null);
      await this.list.reload();
    } catch (e) {
      this.err.set((e as Error).message);
    }
  }
}
