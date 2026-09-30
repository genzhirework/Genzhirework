import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, DatePipe, isEmptyPage, isEmptyArray, LabelPipe, loader, Page } from '@gh/core';
import { CandidateProfileComponent, ConfirmService, IconComponent, ModalComponent, PageStateComponent, StatusBadgeComponent, ToastService } from '@gh/ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cursor-paged admin table state shared by the people lists. */
function pagedList(api: Api, path: string, params: () => Record<string, string>) {
  const rows = signal<Row[]>([]);
  const cursor = signal<string | null>(null);
  const l = loader(async () => {
    const p = await api.get<Page<Row>>(path, params());
    rows.set(p.data);
    cursor.set(p.page.nextCursor);
    return p;
  }, isEmptyPage);
  const more = async () => {
    const p = await api.get<Page<Row>>(path, { ...params(), cursor: cursor() ?? '' });
    rows.update((r) => [...r, ...p.data]);
    cursor.set(p.page.nextCursor);
  };
  return { l, rows, cursor, more };
}

@Component({
  selector: 'app-users',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Users</h1><p>Every identity on the platform.</p></div></div>
      <form class="row card card-tight" style="margin-bottom:16px" (ngSubmit)="list.l.reload()">
        <input class="input grow" name="q" [(ngModel)]="q" placeholder="Search email or name" aria-label="Search users" style="max-width:360px" />
        <select class="select" name="role" [(ngModel)]="role" style="width:auto" aria-label="Role"><option value="">All roles</option>@for (r of roles; track r) { <option [value]="r">{{ r | label }}</option> }</select>
        <select class="select" name="st" [(ngModel)]="status" style="width:auto" aria-label="Status"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="PENDING_VERIFICATION">Unverified</option></select>
        <button class="btn btn-secondary" type="submit">Filter</button>
      </form>
      <gh-page-state [state]="list.l" skeleton="table" emptyTitle="No users match" emptyIcon="users">
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Joined</th><th>Last sign-in</th></tr></thead>
          <tbody>@for (u of list.rows(); track u['id']) {
            <tr><td><a class="row-link" [routerLink]="['/users', u['id']]">{{ u['fullName'] || u['email'] }}</a><div class="caption">{{ u['email'] }}</div></td>
              <td class="caption">{{ (u['roles'] ?? []) | label }}</td><td><gh-status kind="user" [value]="u['status']" /></td>
              <td class="caption">{{ u['createdAt'] | ghDate }}</td><td class="caption">{{ u['lastLoginAt'] | ago }}</td></tr>
          }</tbody></table></div>
        @if (list.cursor()) { <div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-secondary btn-sm" (click)="list.more()">Load more</button></div> }
      </gh-page-state>
    </div>`,
})
export class UsersPage {
  private readonly api = inject(Api);
  protected q = '';
  protected role = '';
  protected status = '';
  protected readonly roles = ['JOBSEEKER', 'EMPLOYER', 'RECRUITER', 'ADMIN'];
  protected readonly list = pagedList(this.api, '/admin/users', () => ({ q: this.q.trim(), role: this.role, status: this.status }));
}

@Component({
  selector: 'app-user',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/users">Users</a> / Detail</nav>
      <gh-page-state [state]="u">
        @if (u.data(); as x) {
          <div class="page-header"><div class="stack-sm"><div class="row"><h1 style="font-size:1.5rem">{{ x['fullName'] || x['email'] }}</h1><gh-status kind="user" [value]="x['status']" /></div>
            <p>{{ x['email'] }} · {{ x['roles'] | label }} · joined {{ x['createdAt'] | ghDate }}</p></div>
            @if (x['status'] === 'SUSPENDED') { <button class="btn btn-secondary" (click)="setStatus(x, 'reactivate')">Reactivate</button> }
            @else { <button class="btn btn-danger" (click)="setStatus(x, 'suspend')">Suspend</button> }</div>
          @if (x['statusReason']) { <div class="alert alert-warning" style="margin-bottom:16px">Reason: {{ x['statusReason'] }}</div> }
          <div class="grid-2" style="align-items:start">
            <section class="card card-flush"><div style="padding:16px 20px"><h3>Sign-in history</h3></div>
              <table class="table table-compact"><tbody>@for (l of x['logins']; track $index) {
                <tr><td>@if (l.success) { <span class="badge badge-success">Success</span> } @else { <span class="badge badge-danger">{{ l.failureReason | label }}</span> }</td>
                  <td class="caption">{{ l.app | label }}</td><td class="caption">{{ l.ipAddress }}</td><td class="caption">{{ l.createdAt | ghDate: true }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:20px">No sign-ins.</td></tr> }</tbody></table></section>
            <div class="stack">
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Active sessions</h3></div>
                <table class="table table-compact"><tbody>@for (s of x['sessions']; track s.id) {
                  <tr><td>{{ s.app | label }}</td><td class="caption">{{ s.ipAddress }}</td><td class="caption">{{ s.lastUsedAt | ago }}</td></tr>
                } @empty { <tr><td class="caption" style="padding-left:20px">None.</td></tr> }</tbody></table></section>
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Recent activity</h3></div>
                <table class="table table-compact"><tbody>@for (a of x['activity']; track $index) {
                  <tr><td><code>{{ a.action }}</code></td><td class="caption">{{ a.entityType }}</td><td class="caption">{{ a.createdAt | ago }}</td></tr>
                } @empty { <tr><td class="caption" style="padding-left:20px">No audited actions.</td></tr> }</tbody></table></section>
            </div>
          </div>
        }
      </gh-page-state>
    </div>`,
})
export class UserPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  protected readonly u = loader(() => this.api.get<Row>(`/admin/users/${this.id()}`));
  async setStatus(x: Row, action: 'suspend' | 'reactivate') {
    const r = await this.confirm.ask({
      title: action === 'suspend' ? `Suspend ${x['email']}?` : `Reactivate ${x['email']}?`,
      message: action === 'suspend' ? 'All their sessions are revoked immediately.' : undefined,
      confirmText: action === 'suspend' ? 'Suspend user' : 'Reactivate', tone: action === 'suspend' ? 'danger' : 'primary', reasonLabel: 'Reason (recorded in the audit log)',
    });
    if (!r.ok) return;
    try {
      await this.api.post(`/admin/users/${x['id']}/${action}`, { reason: r.reason.trim() });
      this.toast.success(action === 'suspend' ? 'User suspended' : 'User reactivated');
      await this.u.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-candidates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatusBadgeComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Candidates</h1><p>Opening a candidate is logged in their access history.</p></div></div>
      <form class="row card card-tight" style="margin-bottom:16px" (ngSubmit)="list.l.reload()">
        <input class="input" name="q" [(ngModel)]="q" placeholder="Search name or email" aria-label="Search candidates" style="max-width:360px" /><button class="btn btn-secondary" type="submit">Search</button></form>
      <gh-page-state [state]="list.l" skeleton="table" emptyTitle="No candidates" emptyIcon="user">
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>Candidate</th><th>City</th><th>Visibility</th><th class="num">Complete</th><th class="num">Applications</th><th class="num">Access events</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>@for (c of list.rows(); track c['id']) {
            <tr><td><a class="row-link" [routerLink]="['/candidates', c['id']]">{{ c['name'] }}</a><div class="caption">{{ c['email'] }}</div></td><td class="caption">{{ c['city'] }}</td>
              <td class="caption">{{ c['visibility'] | label }}@if (c['isSearchable']) { <span class="badge badge-primary" style="margin-left:4px">Searchable</span> }</td>
              <td class="num">{{ c['profileCompletion'] }}%</td><td class="num">{{ c['applications'] }}</td><td class="num">{{ c['accessEvents'] }}</td>
              <td><gh-status kind="user" [value]="c['status']" /></td><td class="caption">{{ c['createdAt'] | ghDate }}</td></tr>
          }</tbody></table></div>
        @if (list.cursor()) { <div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-secondary btn-sm" (click)="list.more()">Load more</button></div> }
      </gh-page-state>
    </div>`,
})
export class CandidatesPage {
  private readonly api = inject(Api);
  protected q = '';
  protected readonly list = pagedList(this.api, '/admin/candidates', () => ({ q: this.q.trim() }));
}

@Component({
  selector: 'app-candidate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, CandidateProfileComponent, StatusBadgeComponent, LabelPipe, DatePipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/candidates">Candidates</a> / Detail</nav>
      <gh-page-state [state]="c">
        @if (c.data(); as x) {
          <div class="alert alert-info" style="margin-bottom:16px">This view was recorded in the candidate's access log (basis: Admin).</div>
          <gh-candidate-profile [profile]="x['profile']" level="CONTACT">
            <div aside class="stack">
              <section class="card stack-sm"><h3>Account</h3><dl class="kv" style="grid-template-columns:100px 1fr"><dt>Status</dt><dd><gh-status kind="user" [value]="x['userStatus']" /></dd>
                <dt>Visibility</dt><dd>{{ x['visibility']?.level | label }}</dd></dl></section>
              <section class="card stack-sm"><h3>Consents</h3>
                @for (k of x['consents']; track $index) { <div class="row between caption"><span>{{ k.purpose | label }}</span><span>{{ k.granted ? 'Granted' : 'Withdrawn' }} · {{ k.createdAt | ghDate }}</span></div> }</section>
            </div>
          </gh-candidate-profile>
          <div class="grid-2" style="margin-top:16px;align-items:start">
            <section class="card card-flush"><div style="padding:16px 20px"><h3>Who accessed this profile</h3></div>
              <table class="table table-compact"><tbody>@for (a of x['access']; track $index) {
                <tr><td>{{ a.employer || (a.viewerType | label) }}<div class="caption">{{ a.viewer }}</div></td><td class="caption">{{ a.action | label }} · {{ a.accessBasis | label }}</td>
                  <td class="num">{{ a.creditsConsumed || '' }}</td><td class="caption">{{ a.createdAt | ghDate: true }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:20px">No access yet.</td></tr> }</tbody></table></section>
            <section class="card card-flush"><div style="padding:16px 20px"><h3>Applications</h3></div>
              <table class="table table-compact"><tbody>@for (a of x['applications']; track a.id) {
                <tr><td>{{ a.jobs.title }}<div class="caption">{{ a.jobs.companies.displayName }}</div></td><td><gh-status kind="application" [value]="a.status" /></td><td class="caption">{{ a.appliedAt | ghDate }}</td></tr>
              } @empty { <tr><td class="caption" style="padding-left:20px">None.</td></tr> }</tbody></table></section>
          </div>
        }
      </gh-page-state>
    </div>`,
})
export class CandidatePage {
  private readonly api = inject(Api);
  readonly id = input.required<string>();
  protected readonly c = loader(() => this.api.get<Row>(`/admin/candidates/${this.id()}`));
}

@Component({
  selector: 'app-employers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatusBadgeComponent, DatePipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Employers</h1></div></div>
      <form class="row card card-tight" style="margin-bottom:16px" (ngSubmit)="list.l.reload()">
        <input class="input" name="q" [(ngModel)]="q" placeholder="Company or domain" aria-label="Search employers" style="max-width:320px" />
        <select class="select" name="v" [(ngModel)]="v" style="width:auto" aria-label="Verification"><option value="">All</option><option value="PENDING">Not verified</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option><option value="SUSPENDED">Suspended</option></select>
        <button class="btn btn-secondary" type="submit">Filter</button></form>
      <gh-page-state [state]="list.l" skeleton="table" emptyTitle="No employers" emptyIcon="building">
        <div class="table-wrap"><table class="table table-compact">
          <thead><tr><th>Employer</th><th>Verification</th><th class="num">Active jobs</th><th class="num">Members</th><th class="num">Credits left</th><th>Created</th></tr></thead>
          <tbody>@for (e of list.rows(); track e['id']) {
            <tr><td><a class="row-link" [routerLink]="['/employers', e['id']]">{{ e['name'] }}</a><div class="caption">{{ e['primaryDomain'] || 'personal email' }}</div></td>
              <td><gh-status kind="verification" [value]="e['verificationStatus']" /></td><td class="num">{{ e['activeJobs'] }}</td><td class="num">{{ e['members'] }}</td>
              <td class="num">{{ e['creditsRemaining'] }}</td><td class="caption">{{ e['createdAt'] | ghDate }}</td></tr>
          }</tbody></table></div>
        @if (list.cursor()) { <div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-secondary btn-sm" (click)="list.more()">Load more</button></div> }
      </gh-page-state>
    </div>`,
})
export class EmployersPage {
  private readonly api = inject(Api);
  protected q = '';
  protected v = '';
  protected readonly list = pagedList(this.api, '/admin/employers', () => ({ q: this.q.trim(), verification: this.v }));
}

@Component({
  selector: 'app-employer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatusBadgeComponent, ModalComponent, IconComponent, LabelPipe, DatePipe, AgoPipe],
  template: `
    <div class="page">
      <nav class="breadcrumb"><a routerLink="/employers">Employers</a> / Detail</nav>
      <gh-page-state [state]="e">
        @if (e.data(); as x) {
          <div class="page-header"><div class="stack-sm"><div class="row"><h1 style="font-size:1.5rem">{{ x['name'] }}</h1><gh-status kind="verification" [value]="x['verificationStatus']" /><gh-status kind="user" [value]="x['status']" /></div>
            <p>{{ x['primaryDomain'] || 'Personal-email account' }} · created {{ x['createdAt'] | ghDate }}</p></div>
            <div class="row"><button class="btn btn-secondary" (click)="grantOpen.set(true)"><gh-icon name="plus" [size]="16" />Grant credits</button>
              @if (x['status'] === 'SUSPENDED') { <button class="btn btn-secondary" (click)="status(x, 'reinstate')">Reinstate</button> }
              @else { <button class="btn btn-danger" (click)="status(x, 'suspend')">Suspend employer</button> }</div></div>
          <div class="grid-2" style="align-items:start">
            <div class="stack">
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Credit buckets</h3></div>
                <table class="table table-compact"><thead><tr><th>Source</th><th class="num">Used / total</th><th>Valid until</th></tr></thead><tbody>@for (b of x['entitlements']; track b.id) {
                  <tr><td>{{ b.source | label }}</td><td class="num">{{ b.usedQuantity }} / {{ b.totalQuantity }}</td><td class="caption">{{ b.validUntil | ghDate }}</td></tr>
                } @empty { <tr><td colspan="3" class="caption" style="padding-left:20px">No credits.</td></tr> }</tbody></table></section>
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Team</h3></div>
                <table class="table table-compact"><tbody>@for (m of x['team']; track $index) {
                  <tr><td>{{ m.usersEmployerUsersUserIdTousers.fullName }}<div class="caption">{{ m.usersEmployerUsersUserIdTousers.email }}</div></td><td class="caption">{{ m.companyRole | label }}</td><td class="caption">{{ m.usersEmployerUsersUserIdTousers.lastLoginAt | ago }}</td></tr>
                }</tbody></table></section>
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Verification history</h3></div>
                <table class="table table-compact"><tbody>@for (v of x['verifications']; track v.id) {
                  <tr><td><gh-status kind="verification" [value]="v.status" /></td><td class="caption">{{ v.registrationType | label }} {{ v.registrationNumber }}</td><td class="caption">{{ v.createdAt | ghDate }}</td></tr>
                } @empty { <tr><td class="caption" style="padding-left:20px">None submitted.</td></tr> }</tbody></table></section>
            </div>
            <div class="stack">
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Candidate access</h3></div>
                <table class="table table-compact"><tbody>@for (a of x['access']; track $index) {
                  <tr><td>{{ a.candidateName }}<div class="caption">{{ a.viewer }}</div></td><td class="caption">{{ a.action | label }} · {{ a.accessBasis | label }}</td><td class="caption">{{ a.createdAt | ago }}</td></tr>
                } @empty { <tr><td class="caption" style="padding-left:20px">No access yet.</td></tr> }</tbody></table></section>
              <section class="card card-flush"><div style="padding:16px 20px"><h3>Jobs</h3></div>
                <table class="table table-compact"><tbody>@for (j of x['jobs']; track j.id) {
                  <tr><td>{{ j.title }}</td><td><gh-status kind="job" [value]="j.status" /></td><td class="caption">{{ j.createdAt | ghDate }}</td></tr>
                } @empty { <tr><td class="caption" style="padding-left:20px">No jobs.</td></tr> }</tbody></table></section>
            </div>
          </div>
          <gh-modal [open]="grantOpen()" title="Grant profile view credits" subtitle="Recorded in the ledger and audit log." size="sm" (closed)="grantOpen.set(false)">
            <div class="stack">
              <div class="field"><label for="gq">Credits</label><input id="gq" class="input" type="number" min="1" [(ngModel)]="grant.quantity" /></div>
              <div class="field"><label for="gd">Valid for (days)</label><input id="gd" class="input" type="number" min="1" [(ngModel)]="grant.validDays" /></div>
              <div class="field"><label for="gn">Reason</label><input id="gn" class="input" [(ngModel)]="grant.note" placeholder="e.g. Pilot partner allowance" /></div>
            </div>
            <ng-container footer><button class="btn btn-secondary" (click)="grantOpen.set(false)">Cancel</button><button class="btn btn-primary" [disabled]="grant.note.trim().length < 3" (click)="doGrant(x)">Grant</button></ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
})
export class EmployerPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  protected readonly e = loader(() => this.api.get<Row>(`/admin/employers/${this.id()}`));
  protected readonly grantOpen = signal(false);
  protected grant = { quantity: 25, validDays: 90, note: '' };
  async doGrant(x: Row) {
    try {
      await this.api.post(`/admin/employers/${x['id']}/entitlements`, { quantity: Number(this.grant.quantity), validDays: Number(this.grant.validDays), note: this.grant.note.trim() });
      this.grantOpen.set(false);
      this.toast.success('Credits granted');
      await this.e.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }
  async status(x: Row, action: 'suspend' | 'reinstate') {
    const r = await this.confirm.ask({ title: `${action === 'suspend' ? 'Suspend' : 'Reinstate'} ${x['name']}?`, message: action === 'suspend' ? 'Published jobs are paused and the team loses access to talent search.' : undefined, confirmText: action === 'suspend' ? 'Suspend' : 'Reinstate', tone: action === 'suspend' ? 'danger' : 'primary', reasonLabel: 'Reason' });
    if (!r.ok) return;
    try {
      await this.api.post(`/admin/employers/${x['id']}/${action}`, { reason: r.reason.trim() });
      await this.e.reload();
    } catch (err) {
      this.toast.error(err);
    }
  }
}

@Component({
  selector: 'app-recruiters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageStateComponent, ModalComponent, IconComponent, LabelPipe, AgoPipe],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Recruiters</h1><p>SISTECHWORK HR consultants. Accounts are created here, never through self-signup.</p></div>
        <button class="btn btn-primary" (click)="open.set(true)"><gh-icon name="plus" [size]="16" />Add recruiter</button></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No recruiters yet" emptyIcon="target">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Recruiter</th><th>Designation</th><th class="num">Active cases</th><th>Status</th><th>Last sign-in</th></tr></thead>
          <tbody>@for (r of list.data(); track r['id']) {
            <tr><td><strong>{{ r['displayName'] }}</strong><div class="caption">{{ r['email'] }}</div></td><td class="caption">{{ r['designation'] }}</td>
              <td class="num">{{ r['activeCases'] }} / {{ r['maxActiveCases'] }}</td><td class="caption">{{ r['status'] | label }}</td><td class="caption">{{ r['lastLoginAt'] | ago }}</td></tr>
          }</tbody></table></div>
      </gh-page-state>
      <gh-modal [open]="open()" [title]="created() ? 'Recruiter account created' : 'Add recruiter'" (closed)="close()">
        @if (created(); as c) {
          <div class="stack">
            <div class="alert alert-warning"><gh-icon name="key" [size]="16" /><span>Share this temporary password securely. <strong>It will not be shown again.</strong> The recruiter should change it after signing in.</span></div>
            <dl class="kv"><dt>Email</dt><dd>{{ c.email }}</dd><dt>Temporary password</dt><dd><code class="pw">{{ c.temporaryPassword }}</code></dd></dl>
          </div>
        } @else {
          <div class="stack">
            <div class="field"><label for="rn" class="req">Full name</label><input id="rn" class="input" [(ngModel)]="f.fullName" /></div>
            <div class="field"><label for="re" class="req">Work email</label><input id="re" class="input" type="email" [(ngModel)]="f.email" /></div>
            <div class="field"><label for="rd">Designation</label><input id="rd" class="input" [(ngModel)]="f.designation" placeholder="HR Consultant" /></div>
          </div>
        }
        <ng-container footer>
          @if (created()) { <button class="btn btn-primary" (click)="close()">Done</button> }
          @else { <button class="btn btn-secondary" (click)="close()">Cancel</button><button class="btn btn-primary" [disabled]="!f.fullName.trim() || !f.email.trim()" (click)="create()">Create account</button> }
        </ng-container>
      </gh-modal>
    </div>`,
  styles: `.pw { font-size: 1rem; padding: 4px 8px; background: var(--bg-subtle); border-radius: 6px; user-select: all; }`,
})
export class RecruitersPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<Row[]>('/admin/recruiters'), isEmptyArray);
  protected readonly open = signal(false);
  protected readonly created = signal<{ email: string; temporaryPassword: string } | null>(null);
  protected f = { fullName: '', email: '', designation: '' };
  async create() {
    try {
      const r = await this.api.post<{ email: string; temporaryPassword: string }>('/admin/recruiters', { fullName: this.f.fullName.trim(), email: this.f.email.trim(), designation: this.f.designation.trim() || undefined });
      this.created.set(r);
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
  close() {
    this.open.set(false);
    this.created.set(null);
    this.f = { fullName: '', email: '', designation: '' };
  }
}
