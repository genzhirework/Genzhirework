import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Api } from '@gh/core';
import { AppShellComponent, NavGroup, StatusBadgeComponent } from '@gh/ui';
import { CreditsState } from './credits';
import { filter } from 'rxjs';

@Component({
  selector: 'app-employer-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, AppShellComponent, StatusBadgeComponent],
  template: `
    <gh-app-shell appName="Employer" [nav]="nav">
      <div topbar class="row">
        @if (company(); as c) {
          <strong class="truncate hide-mobile" style="max-width:240px">{{ c.displayName }}</strong>
          <gh-status kind="verification" [value]="c.verificationStatus" />
          @if (c.verificationStatus !== 'VERIFIED') { <a routerLink="/company/verification" class="caption hide-mobile">Verify to unlock talent search →</a> }
        }
        <div class="grow"></div>
        @if (credits(); as cr) {
          <a routerLink="/usage" class="credits hide-mobile" title="Profile view credits">
            <span class="tabular"><strong>{{ cr.remaining }}</strong> profile views left</span></a>
        }
      </div>
      <router-outlet />
    </gh-app-shell>`,
  styles: `.credits { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text-secondary); text-decoration: none !important; }
    .credits strong { color: var(--text); }`,
})
export class EmployerShell {
  private readonly api = inject(Api);
  protected readonly company = signal<{ displayName: string; verificationStatus: string } | null>(null);
  protected readonly credits = inject(CreditsState).credits;
  private readonly creditsState = inject(CreditsState);
  protected readonly nav: NavGroup[] = [
    { items: [{ label: 'Dashboard', link: '/dashboard', icon: 'home' }] },
    {
      label: 'Hiring',
      items: [
        { label: 'Jobs', link: '/jobs', icon: 'briefcase' },
        { label: 'Applications', link: '/applications', icon: 'inbox' },
        { label: 'Find talent', link: '/talent', icon: 'search' },
        { label: 'Saved candidates', link: '/saved', icon: 'bookmark' },
      ],
    },
    {
      label: 'Recruitment',
      items: [
        { label: 'Hiring requirements', link: '/requirements', icon: 'clipboard' },
      ],
    },
    {
      label: 'Account',
      items: [
        { label: 'Usage & credits', link: '/usage', icon: 'chart' },
        { label: 'Company', link: '/company', icon: 'building' },
        { label: 'Settings', link: '/settings', icon: 'settings' },
      ],
    },
  ];

  constructor() {
    void this.refresh();
    // Keep the credit counter honest after unlocks without a global store.
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => void this.refreshCredits());
  }
  async refresh() {
    this.company.set(await this.api.get<{ displayName: string; verificationStatus: string }>('/employer/company').catch(() => null));
    await this.refreshCredits();
  }
  refreshCredits() {
    return this.creditsState.refresh();
  }
}
