import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgoPipe, Api, AuthService, loader } from '@gh/core';
import { AvatarComponent, CreditMeterComponent, IconComponent, PageStateComponent, StatTileComponent, StatusBadgeComponent } from '@gh/ui';

interface Dash {
  activeJobs: number;
  pendingJobs: number;
  applicants: number;
  applicants7d: number;
  shortlisted: number;
  saved: number;
  openRequirements: number;
  credits: { remaining: number; total: number; nextExpiry: string | null };
  employer: { name: string; verificationStatus: string };
  latestVerification: { status: string; decisionReason: string | null } | null;
  recent: { id: string; status: string; appliedAt: string; matchScore: number | null; jobTitle: string; candidateName: string }[];
}

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, StatTileComponent, CreditMeterComponent, StatusBadgeComponent, AvatarComponent, IconComponent, AgoPipe],
  template: `
    <div class="page">
      <gh-page-state [state]="dash">
        @if (dash.data(); as d) {
          <div class="page-header">
            <div><h1>Welcome back, {{ auth.firstName() }}</h1><p>{{ d.employer.name }} · hiring overview</p></div>
            <div class="row"><a class="btn btn-secondary" routerLink="/talent"><gh-icon name="search" [size]="16" />Find talent</a>
              <a class="btn btn-primary" routerLink="/jobs/new"><gh-icon name="plus" [size]="16" />Post a job</a></div>
          </div>

          @if (d.employer.verificationStatus !== 'VERIFIED') {
            <div class="alert alert-warning" style="margin-bottom:16px"><gh-icon name="shield" [size]="16" />
              <div class="grow">
                @switch (d.latestVerification?.status) {
                  @case ('SUBMITTED') { <strong>Verification submitted.</strong> We usually review within 1 business day. }
                  @case ('IN_REVIEW') { <strong>Verification in review.</strong> }
                  @case ('NEEDS_INFO') { <strong>We need more information:</strong> {{ d.latestVerification!.decisionReason }} }
                  @case ('REJECTED') { <strong>Verification was not approved:</strong> {{ d.latestVerification!.decisionReason }} }
                  @default { <strong>Verify your company</strong> to unlock candidate profiles and receive 50 free profile views. Jobs from unverified employers are reviewed before publishing. }
                }
              </div>
              @if (!['SUBMITTED', 'IN_REVIEW'].includes(d.latestVerification?.status ?? '')) { <a class="btn btn-primary btn-sm" routerLink="/company/verification">Verify now</a> }
            </div>
          }

          <div class="kpis">
            <gh-stat label="Active jobs" [value]="d.activeJobs" icon="briefcase" [hint]="d.pendingJobs ? d.pendingJobs + ' pending approval' : null" />
            <gh-stat label="Applicants" [value]="d.applicants" icon="inbox" [hint]="d.applicants7d + ' in the last 7 days'" />
            <gh-stat label="Shortlisted" [value]="d.shortlisted" icon="star" />
            <gh-stat label="Saved candidates" [value]="d.saved" icon="bookmark" />
            <gh-stat label="Open requirements" [value]="d.openRequirements" icon="clipboard" />
            <div class="card card-tight stat"><span class="label">Profile views left</span>
              @if (d.credits.total) { <gh-credit-meter [remaining]="d.credits.remaining" [total]="d.credits.total" /> }
              @else { <span class="caption">Granted after verification</span> }
              <a routerLink="/usage" class="caption">View usage →</a></div>
          </div>

          <div class="grid-2" style="margin-top:16px;align-items:start">
            <section class="card card-flush">
              <div class="row between" style="padding:16px 20px"><h3>Recent applicants</h3><a routerLink="/applications" class="caption">View all</a></div>
              <table class="table">
                <tbody>
                  @for (a of d.recent; track a.id) {
                    <tr><td><div class="row" style="flex-wrap:nowrap"><gh-avatar [name]="a.candidateName" [size]="28" />
                        <div><a class="row-link" [routerLink]="['/applications', a.id]">{{ a.candidateName }}</a><div class="caption">{{ a.jobTitle }}</div></div></div></td>
                      <td>@if (a.matchScore !== null) { <span class="caption">{{ a.matchScore }}% skill match</span> }</td>
                      <td><gh-status kind="application" [value]="a.status" /></td><td class="caption">{{ a.appliedAt | ago }}</td></tr>
                  } @empty { <tr><td class="caption" style="height:80px">No applications yet. Post a job to start receiving applicants.</td></tr> }
                </tbody>
              </table>
            </section>
            <section class="card stack">
              <h3>Quick actions</h3>
              <a class="action" routerLink="/jobs/new"><gh-icon name="briefcase" /><div><strong>Post a job</strong><div class="caption">Reach freshers actively looking.</div></div></a>
              <a class="action" routerLink="/talent"><gh-icon name="search" /><div><strong>Search the talent database</strong><div class="caption">Filter by skill, degree, year and city.</div></div></a>
              <a class="action" routerLink="/requirements/new"><gh-icon name="users" /><div><strong>I need candidates</strong><div class="caption">Let GenZHire HR consultants source for you — pay only after 90 days.</div></div></a>
            </section>
          </div>
        }
      </gh-page-state>
    </div>`,
  styles: `
    .kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
    .stat { display: flex; flex-direction: column; gap: 8px; }
    .action { display: flex; gap: 12px; align-items: flex-start; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); text-decoration: none !important; }
    .action:hover { border-color: var(--border-strong); background: var(--surface-hover); }
    .action gh-icon { color: var(--primary); margin-top: 2px; }
    @media (max-width: 1279px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 640px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`,
})
export class DashboardPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(AuthService);
  protected readonly dash = loader(() => this.api.get<Dash>('/employer/dashboard'));
}
