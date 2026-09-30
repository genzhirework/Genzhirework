import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterOutlet } from '@angular/router';
import { Api, loader, num } from '@gh/core';
import { AppShellComponent, BarChartComponent, ChartPoint, LoginFormComponent, NavGroup, PageStateComponent, SecuritySettingsComponent, StatTileComponent } from '@gh/ui';

@Component({
  selector: 'app-admin-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AppShellComponent],
  template: `<gh-app-shell appName="Admin" [nav]="nav"><router-outlet /></gh-app-shell>`,
})
export class AdminShell {
  protected readonly nav: NavGroup[] = [
    { items: [{ label: 'Overview', link: '/dashboard', icon: 'chart' }] },
    {
      label: 'Queues',
      items: [
        { label: 'Employer verification', link: '/verification', icon: 'shield' },
        { label: 'Job moderation', link: '/jobs', icon: 'briefcase' },
        { label: 'Hiring requirements', link: '/requirements', icon: 'clipboard' },
        { label: 'Trust & safety', link: '/security', icon: 'alert' },
      ],
    },
    {
      label: 'People',
      items: [
        { label: 'Users', link: '/users', icon: 'users' },
        { label: 'Candidates', link: '/candidates', icon: 'user' },
        { label: 'Employers', link: '/employers', icon: 'building' },
        { label: 'Recruiters', link: '/recruiters', icon: 'target' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Applications', link: '/applications', icon: 'inbox' },
        { label: 'Recruitment cases', link: '/recruitment', icon: 'kanban' },
        { label: 'Billing', link: '/billing', icon: 'rupee' },
      ],
    },
    {
      label: 'Audit',
      items: [
        { label: 'Profile access logs', link: '/access-logs', icon: 'eye' },
        { label: 'Audit log', link: '/audit-logs', icon: 'hash' },
      ],
    },
    { label: 'System', items: [{ label: 'Settings', link: '/system', icon: 'sliders' }] },
  ];
}

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginFormComponent],
  template: `<gh-login-form title="Admin sign in" subtitle="Restricted to SISTECHWORK administrators. All actions are audited." home="/dashboard" [showForgot]="false" />`,
  styles: `:host { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; }`,
})
export class LoginPage {}

interface Metrics {
  totalJobseekers: number;
  newJobseekers: number;
  activeEmployers: number;
  verifiedEmployers: number;
  pendingVerifications: number;
  activeJobs: number;
  pendingJobs: number;
  applications: number;
  profileViews: number;
  freeViewsConsumed: number;
  openRequirements: number;
  activeCases: number;
  candidatesHired: number;
  inTracking: number;
  billable: number;
  pendingInvoices: number;
  paidInvoices: number;
  openAlerts: number;
  openReports: number;
  series: { day: string; registrations: number; jobs: number; applications: number; searches: number; profileViews: number }[];
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, StatTileComponent, BarChartComponent],
  template: `
    <div class="page">
      <div class="page-header"><div><h1>Overview</h1><p>Platform health for the selected period.</p></div>
        <div class="row-sm"><label class="caption" for="from">From</label><input id="from" class="input" type="date" [(ngModel)]="from" style="width:auto" />
          <label class="caption" for="to">To</label><input id="to" class="input" type="date" [(ngModel)]="to" style="width:auto" />
          <button class="btn btn-secondary" (click)="m.reload()">Apply</button></div></div>
      <gh-page-state [state]="m">
        @if (m.data(); as d) {
          @if (d.pendingVerifications || d.pendingJobs || d.openAlerts || d.openReports) {
            <div class="queues row">
              @if (d.pendingVerifications) { <a class="queue" routerLink="/verification"><strong>{{ d.pendingVerifications }}</strong>&ngsp;{{ d.pendingVerifications === 1 ? 'employer verification' : 'employer verifications' }} waiting</a> }
              @if (d.pendingJobs) { <a class="queue" routerLink="/jobs"><strong>{{ d.pendingJobs }}</strong>&ngsp;{{ d.pendingJobs === 1 ? 'job' : 'jobs' }} to moderate</a> }
              @if (d.openAlerts) { <a class="queue danger" routerLink="/security"><strong>{{ d.openAlerts }}</strong>&ngsp;open security {{ d.openAlerts === 1 ? 'alert' : 'alerts' }}</a> }
              @if (d.openReports) { <a class="queue" routerLink="/security"><strong>{{ d.openReports }}</strong>&ngsp;abuse {{ d.openReports === 1 ? 'report' : 'reports' }}</a> }
            </div>
          }
          <div class="kpis">
            <gh-stat label="Total jobseekers" [value]="n(d.totalJobseekers)" [hint]="'+' + d.newJobseekers + ' in period'" />
            <gh-stat label="Active employers" [value]="n(d.activeEmployers)" />
            <gh-stat label="Verified employers" [value]="n(d.verifiedEmployers)" />
            <gh-stat label="Active jobs" [value]="n(d.activeJobs)" />
            <gh-stat label="Applications" [value]="n(d.applications)" hint="in period" />
            <gh-stat label="Profile views" [value]="n(d.profileViews)" hint="in period" />
            <gh-stat label="Free views consumed" [value]="n(d.freeViewsConsumed)" hint="in period" />
            <gh-stat label="Hiring requirements" [value]="n(d.openRequirements)" hint="open" />
            <gh-stat label="Active recruitment cases" [value]="n(d.activeCases)" />
            <gh-stat label="Candidates hired" [value]="n(d.candidatesHired)" />
            <gh-stat label="In 90-day tracking" [value]="n(d.inTracking)" />
            <gh-stat label="Pending invoices" [value]="n(d.pendingInvoices)" [hint]="d.billable + ' placements billable'" />
            <gh-stat label="Paid invoices" [value]="n(d.paidInvoices)" />
          </div>
          <div class="charts">
            <gh-bar-chart title="Registrations" [data]="series('registrations')" />
            <gh-bar-chart title="Jobs published" [data]="series('jobs')" />
            <gh-bar-chart title="Applications" [data]="series('applications')" />
            <gh-bar-chart title="Talent searches" [data]="series('searches')" />
            <gh-bar-chart title="Profile views" [data]="series('profileViews')" />
          </div>
        }
      </gh-page-state>
    </div>`,
  styles: `
    .queues { margin-bottom: 16px; }
    .queue { padding: 10px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--warning-tint); color: var(--text); text-decoration: none !important; }
    .queue.danger { background: var(--danger-tint); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
    .charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 12px; margin-top: 16px; }
    @media (max-width: 640px) { .charts { grid-template-columns: 1fr; } }`,
})
export class DashboardPage {
  private readonly api = inject(Api);
  protected from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  protected to = new Date().toISOString().slice(0, 10);
  protected readonly m = loader(() => this.api.get<Metrics>('/admin/metrics', { from: this.from, to: `${this.to}T23:59:59` }));
  protected n = num;
  protected series(key: 'registrations' | 'jobs' | 'applications' | 'searches' | 'profileViews'): ChartPoint[] {
    return (this.m.data()?.series ?? []).map((s) => ({ label: s.day.slice(5, 10), value: s[key] }));
  }
}

@Component({
  selector: 'app-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SecuritySettingsComponent],
  template: `<div class="page page-narrow"><div class="page-header"><div><h1>Account</h1><p>Change the seeded admin password after first sign-in.</p></div></div><gh-security-settings /></div>`,
})
export class AccountPage {}

