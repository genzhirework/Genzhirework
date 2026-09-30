import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, AuthService, DatePipe, isEmptyArray, LabelPipe, loader, Page, statusOf } from '@gh/core';
import {
  ConfirmService, EmptyStateComponent, IconComponent, JobCardComponent, JobCardData, PageStateComponent, StatusBadgeComponent,
  TimelineComponent, ToastService,
} from '@gh/ui';

interface Me {
  id: string;
  firstName: string;
  city: string | null;
  onboardingCompleted: boolean;
  completion: { percent: number; missing: string[] };
  skills: { id: number; name: string }[];
  profile: { preferredCities: string[] };
}
interface AppRow {
  id: string;
  status: string;
  statusLabel: string;
  appliedAt: string;
  statusChangedAt: string;
  jobs: { id: string; title: string; status: string; workMode: string; companies: { displayName: string }; jobLocations: { city: string }[] };
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, IconComponent, JobCardComponent, StatusBadgeComponent],
  template: `
    <div class="container page-pad">
      <gh-page-state [state]="me">
        @if (me.data(); as m) {
          <div class="page-header"><div><h1>Hi {{ m.firstName }} 👋</h1><p>Here's what's happening with your job search.</p></div>
            <a class="btn btn-primary" routerLink="/jobs"><gh-icon name="search" [size]="16" />Find jobs</a></div>
          @if (!m.onboardingCompleted) {
            <div class="alert alert-info" style="margin-bottom:16px"><gh-icon name="info" [size]="16" />
              <span class="grow">Finish setting up your profile so employers can find you.</span><a class="btn btn-primary btn-sm" routerLink="/onboarding">Continue setup</a></div>
          }
          <div class="dash">
            <section class="card completion">
              <div class="ring" [style.--p]="m.completion.percent" role="img" [attr.aria-label]="'Profile ' + m.completion.percent + '% complete'"><span>{{ m.completion.percent }}%</span></div>
              <div class="stack-sm grow"><h3>Profile completion</h3>
                @if (m.completion.percent < 40) { <p class="caption" style="color:var(--warning)">Reach 40% to appear in employer talent search.</p> }
                @if (m.completion.missing.length) {
                  <ul class="missing">@for (x of m.completion.missing.slice(0, 3); track x) { <li>{{ x }}</li> }</ul>
                  <a class="btn btn-secondary btn-sm" routerLink="/app/profile" style="align-self:flex-start">Complete profile</a>
                } @else { <p class="secondary">Your profile is complete. Nice work!</p> }
              </div>
            </section>
            <section class="card stack-sm">
              <div class="row between"><h3>Applications</h3><a routerLink="/app/applications" class="caption">View all</a></div>
              <div class="counts">
                <div><strong>{{ counts().total }}</strong><span class="caption">Applied</span></div>
                <div><strong>{{ counts().active }}</strong><span class="caption">In progress</span></div>
                <div><strong>{{ counts().interview }}</strong><span class="caption">Interviews</span></div>
              </div>
              @for (a of apps().slice(0, 3); track a.id) {
                <a class="row between app-row" [routerLink]="['/app/applications', a.id]">
                  <span class="truncate grow"><strong>{{ a.jobs.title }}</strong><span class="caption"> · {{ a.jobs.companies.displayName }}</span></span>
                  <gh-status kind="application" [value]="a.status" audience="candidate" /></a>
              } @empty { <p class="caption">No applications yet — your next opportunity is a search away.</p> }
            </section>
          </div>
          @if (contacts() > 0) {
            <a class="alert alert-info" routerLink="/app/contact-requests" style="margin-top:16px;text-decoration:none">
              <gh-icon name="mail" [size]="16" /><span class="grow">{{ contacts() }} employer{{ contacts() > 1 ? 's want' : ' wants' }} to contact you.</span><span>Review →</span></a>
          }
          <section style="margin-top:32px">
            <div class="section-title"><h2>Recommended for you</h2><a routerLink="/jobs">Browse all →</a></div>
            <div class="grid-auto">@for (j of recommended(); track j.id) { <gh-job-card [job]="j" /> }</div>
            @if (!recommended().length) { <p class="secondary">Add skills and preferred cities to your profile to get recommendations.</p> }
          </section>
        }
      </gh-page-state>
    </div>`,
  styles: `
    .page-pad { padding-top: 32px; }
    .dash { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .completion { display: flex; gap: 20px; align-items: center; }
    .ring { --p: 0; width: 96px; height: 96px; flex: none; border-radius: 50%; display: grid; place-items: center;
      background: conic-gradient(var(--primary-fill) calc(var(--p) * 1%), var(--bg-subtle) 0); }
    .ring span { width: 76px; height: 76px; border-radius: 50%; background: var(--surface); display: grid; place-items: center; font-weight: 700; font-size: 1.25rem; }
    .missing { color: var(--text-secondary); padding-left: 1.1em; }
    .counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 4px 0 8px; }
    .counts div { display: flex; flex-direction: column; } .counts strong { font-size: 1.5rem; }
    .app-row { padding: 8px 0; border-top: 1px solid var(--border); color: var(--text); text-decoration: none !important; flex-wrap: nowrap; }
    @media (max-width: 767px) { .dash { grid-template-columns: 1fr; } .completion { flex-direction: column; align-items: flex-start; } }`,
})
export class DashboardPage {
  private readonly api = inject(Api);
  protected readonly me = loader(() => this.api.get<Me>('/candidate/profile'));
  protected readonly apps = signal<AppRow[]>([]);
  protected readonly recommended = signal<JobCardData[]>([]);
  protected readonly contacts = signal(0);
  protected readonly counts = computed(() => {
    const a = this.apps();
    return {
      total: a.length,
      active: a.filter((x) => !['REJECTED', 'WITHDRAWN', 'SELECTED'].includes(x.status)).length,
      interview: a.filter((x) => x.status === 'INTERVIEW').length,
    };
  });

  constructor() {
    this.api.get<AppRow[]>('/candidate/applications').then((a) => this.apps.set(a)).catch(() => {});
    this.api.get<{ status: string }[]>('/candidate/contact-requests').then((c) => this.contacts.set(c.filter((x) => x.status === 'PENDING').length)).catch(() => {});
    this.api.get<Me>('/candidate/profile').then(async (m) => {
      const r = await this.api.get<Page<JobCardData>>('/jobs', { skills: m.skills.map((s) => s.id).slice(0, 10), limit: 6, sort: 'recent' });
      this.recommended.set(r.data);
    }).catch(() => {});
  }
}

@Component({
  selector: 'app-applications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, AgoPipe, DatePipe, LabelPipe, EmptyStateComponent],
  template: `
    <div class="container page-pad">
      <div class="page-header"><div><h1>Applications</h1><p>Track every application in one place.</p></div></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">
        @for (t of tabs; track t.key) {
          <button class="tab" role="tab" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}<span class="count">{{ count(t.key) }}</span></button>
        }
      </div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No applications yet" emptyText="When you apply to jobs, you'll track them here." emptyIcon="briefcase">
        <a empty class="btn btn-primary" routerLink="/jobs">Find jobs</a>
        <div class="stack-sm">
          @for (a of filtered(); track a.id) {
            <a class="card card-tight card-interactive row between item" [routerLink]="['/app/applications', a.id]">
              <div class="grow" style="min-width:0"><strong class="truncate" style="display:block">{{ a.jobs.title }}</strong>
                <span class="caption">{{ a.jobs.companies.displayName }} · {{ a.jobs.workMode | label }} · Applied {{ a.appliedAt | ghDate }}</span></div>
              <div class="stack-sm" style="align-items:flex-end;gap:4px"><gh-status kind="application" [value]="a.status" audience="candidate" />
                <span class="caption">Updated {{ a.statusChangedAt | ago }}</span></div>
            </a>
          } @empty { <div class="card"><gh-empty title="Nothing in this tab" icon="inbox" /></div> }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; } .item { color: var(--text); text-decoration: none !important; flex-wrap: nowrap; }`,
})
export class ApplicationsPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<AppRow[]>('/candidate/applications'), isEmptyArray);
  protected readonly tab = signal<'all' | 'active' | 'interview' | 'closed'>('all');
  protected readonly tabs = [
    { key: 'all' as const, label: 'All' }, { key: 'active' as const, label: 'In progress' },
    { key: 'interview' as const, label: 'Interviews' }, { key: 'closed' as const, label: 'Closed' },
  ];
  private match(t: string, s: string) {
    if (t === 'active') return ['APPLIED', 'VIEWED', 'SCREENING', 'SHORTLISTED'].includes(s);
    if (t === 'interview') return s === 'INTERVIEW';
    if (t === 'closed') return ['SELECTED', 'REJECTED', 'WITHDRAWN'].includes(s);
    return true;
  }
  protected readonly filtered = computed(() => (this.list.data() ?? []).filter((a) => this.match(this.tab(), a.status)));
  protected count(t: string) {
    return (this.list.data() ?? []).filter((a) => this.match(t, a.status)).length;
  }
}

interface AppDetail {
  id: string;
  status: string;
  statusLabel: string;
  appliedAt: string;
  coverNote: string | null;
  resumeLabel: string | null;
  job: { id: string; title: string; status: string; workMode: string; employmentType: string; companies: { displayName: string }; jobLocations: { city: string }[] };
  timeline: { status: string; label: string; at: string }[];
}

@Component({
  selector: 'app-application-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, TimelineComponent, LabelPipe, DatePipe],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <nav class="breadcrumb"><a routerLink="/app/applications">Applications</a> / Details</nav>
      <gh-page-state [state]="app">
        @if (app.data(); as a) {
          <div class="stack">
            <section class="card stack-sm">
              <div class="row between"><h1 style="font-size:1.5rem">{{ a.job.title }}</h1><gh-status kind="application" [value]="a.status" audience="candidate" /></div>
              <p class="secondary">{{ a.job.companies.displayName }} · {{ a.job.workMode | label }} · {{ a.job.employmentType | label }} · {{ cities(a) }}</p>
              <p class="caption">Applied {{ a.appliedAt | ghDate: true }}{{ a.resumeLabel ? ' with "' + a.resumeLabel + '"' : '' }}</p>
              <div class="row"><a class="btn btn-secondary btn-sm" [routerLink]="['/jobs', a.job.id]">View job</a>
                @if (canWithdraw(a.status)) { <button class="btn btn-ghost btn-sm" type="button" (click)="withdraw(a)">Withdraw application</button> }</div>
            </section>
            <section class="card"><h3 style="margin-bottom:16px">Progress</h3><gh-timeline [items]="timeline(a)" /></section>
            @if (a.coverNote) { <section class="card"><h3 style="margin-bottom:8px">Your cover note</h3><p class="pre-line secondary">{{ a.coverNote }}</p></section> }
          </div>
        }
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; }`,
})
export class ApplicationDetailPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  protected readonly app = loader(() => this.api.get<AppDetail>(`/candidate/applications/${this.id()}`));
  protected cities = (a: AppDetail) => a.job.jobLocations.map((l) => l.city).join(', ');
  protected canWithdraw = (s: string) => !['SELECTED', 'REJECTED', 'WITHDRAWN'].includes(s);
  protected timeline = (a: AppDetail) => a.timeline.map((t) => ({ label: statusOf('application', t.status, 'candidate').label, at: t.at }));
  async withdraw(a: AppDetail) {
    const ok = await this.confirm.confirm({ title: 'Withdraw this application?', message: `${a.job.companies.displayName} will no longer see your application for ${a.job.title}. This can't be undone.`, confirmText: 'Withdraw application', tone: 'danger' });
    if (!ok) return;
    try {
      await this.api.post(`/candidate/applications/${a.id}/withdraw`);
      this.toast.success('Application withdrawn');
      await this.app.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

interface SavedRow {
  jobId: string;
  jobs: JobCardData & { status: string; companies: { displayName: string; slug: string }; employers: { verificationStatus: string }; jobLocations: { city: string }[] };
}

@Component({
  selector: 'app-saved-jobs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, JobCardComponent],
  template: `
    <div class="container page-pad">
      <div class="page-header"><div><h1>Saved jobs</h1><p>Jobs you've bookmarked to apply to later.</p></div></div>
      <gh-page-state [state]="list" skeleton="cards" emptyTitle="No saved jobs" emptyText="Tap the bookmark on any job to save it here." emptyIcon="bookmark">
        <a empty class="btn btn-primary" routerLink="/jobs">Browse jobs</a>
        <div class="grid-auto">
          @for (s of list.data(); track s.jobId) {
            <div [class.closed]="s.jobs.status !== 'PUBLISHED'">
              <gh-job-card [job]="card(s)" [showSave]="true" [saved]="true" (save)="unsave($event)" />
              @if (s.jobs.status !== 'PUBLISHED') { <p class="caption" style="margin-top:4px">No longer accepting applications</p> }
            </div>
          }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; } .closed { opacity: 0.6; }`,
})
export class SavedJobsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<SavedRow[]>('/candidate/saved-jobs'), isEmptyArray);
  protected card(s: SavedRow): JobCardData {
    const j = s.jobs;
    return {
      ...j,
      company: { name: j.companies.displayName, slug: j.companies.slug, verified: j.employers.verificationStatus === 'VERIFIED' },
      cities: j.jobLocations.map((l) => l.city),
      skills: [],
    };
  }
  async unsave(id: string) {
    await this.api.delete(`/candidate/saved-jobs/${id}`);
    this.toast.success('Removed from saved jobs');
    await this.list.reload();
  }
}

interface Note {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

@Component({
  selector: 'app-notifications',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, AgoPipe],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <div class="page-header"><div><h1>Notifications</h1></div>
        <button class="btn btn-secondary btn-sm" type="button" (click)="readAll()">Mark all as read</button></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="You're all caught up" emptyIcon="bell">
        <div class="card card-flush">
          @for (n of list.data(); track n.id) {
            <a class="note" [class.unread]="!n.readAt" [routerLink]="n.link || null" (click)="read(n)">
              <strong>{{ n.title }}</strong><span class="secondary">{{ n.body }}</span><span class="caption">{{ n.createdAt | ago }}</span></a>
          }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; }
    .note { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-bottom: 1px solid var(--border); color: var(--text); text-decoration: none !important; }
    .note:last-child { border-bottom: 0; } .note.unread { background: var(--primary-tint); } .note:hover { background: var(--surface-hover); }`,
})
export class NotificationsPage {
  private readonly api = inject(Api);
  protected readonly list = loader(() => this.api.get<Note[]>('/notifications'), isEmptyArray);
  async read(n: Note) {
    if (!n.readAt) await this.api.post(`/notifications/${n.id}/read`);
  }
  async readAll() {
    await this.api.post('/notifications/read-all');
    await this.list.reload();
  }
}

interface ContactReq {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  employers: { name: string; verificationStatus: string };
  jobs: { id: string; title: string } | null;
}

@Component({
  selector: 'app-contact-requests',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatusBadgeComponent, IconComponent, AgoPipe, DatePipe],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <div class="page-header"><div><h1>Contact requests</h1><p>Employers who want your phone and email. Nothing is shared unless you accept.</p></div></div>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No contact requests" emptyText="When a verified employer wants to reach you, you'll decide here." emptyIcon="mail">
        <div class="stack">
          @for (r of list.data(); track r.id) {
            <article class="card stack-sm">
              <div class="row between"><div class="row-sm"><strong>{{ r.employers.name }}</strong>
                @if (r.employers.verificationStatus === 'VERIFIED') { <span class="badge badge-success"><gh-icon name="shield" [size]="12" />Verified</span> }</div>
                <gh-status kind="contact" [value]="r.status" /></div>
              @if (r.jobs) { <p class="caption">About: <a [routerLink]="['/jobs', r.jobs.id]">{{ r.jobs.title }}</a></p> }
              <p class="pre-line">{{ r.message }}</p>
              <p class="caption">Received {{ r.createdAt | ago }}{{ r.status === 'PENDING' ? ' · expires ' + (r.expiresAt | ghDate) : '' }}</p>
              @if (r.status === 'PENDING') {
                <div class="row"><button class="btn btn-primary btn-sm" type="button" (click)="respond(r, true)">Share my contact details</button>
                  <button class="btn btn-secondary btn-sm" type="button" (click)="respond(r, false)">Decline</button></div>
              }
            </article>
          }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; }`,
})
export class ContactRequestsPage {
  private readonly api = inject(Api);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly list = loader(() => this.api.get<ContactReq[]>('/candidate/contact-requests'), isEmptyArray);
  async respond(r: ContactReq, accept: boolean) {
    if (accept) {
      const ok = await this.confirm.confirm({ title: `Share your contact details with ${r.employers.name}?`, message: 'They will see your email and phone number and may contact you about opportunities.', confirmText: 'Share contact details' });
      if (!ok) return;
    }
    try {
      await this.api.post(`/candidate/contact-requests/${r.id}/${accept ? 'accept' : 'decline'}`);
      this.toast.success(accept ? 'Contact details shared' : 'Request declined');
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-more',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `
    <div class="container page-pad">
      <h1 style="margin-bottom:16px">More</h1>
      <nav class="card card-flush" aria-label="More">
        @for (l of links; track l.link) { <a class="item" [routerLink]="l.link"><gh-icon [name]="l.icon" />{{ l.label }}<gh-icon name="chevron-right" [size]="16" class="muted end" /></a> }
        <button class="item danger" type="button" (click)="auth.logout()"><gh-icon name="logout" />Sign out</button>
      </nav>
    </div>`,
  styles: `.page-pad { padding-top: 24px; }
    .item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text); font: inherit; text-decoration: none !important; }
    .item:last-child { border-bottom: 0; } .end { margin-left: auto; } .danger { color: var(--danger); }`,
})
export class MorePage {
  protected readonly auth = inject(AuthService);
  protected readonly links = [
    { label: 'Saved jobs', link: '/app/saved-jobs', icon: 'bookmark' },
    { label: 'Resume', link: '/app/resume', icon: 'file' },
    { label: 'Notifications', link: '/app/notifications', icon: 'bell' },
    { label: 'Contact requests', link: '/app/contact-requests', icon: 'mail' },
    { label: 'Privacy', link: '/app/settings/privacy', icon: 'shield' },
    { label: 'Settings', link: '/app/settings', icon: 'settings' },
  ];
}
