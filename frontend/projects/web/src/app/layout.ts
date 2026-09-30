import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { appUrl, AuthService } from '@gh/core';
import { AvatarComponent, IconComponent, LogoComponent, NotificationBellComponent } from '@gh/ui';
import { filter } from 'rxjs';

@Component({
  selector: 'app-site-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LogoComponent, IconComponent, AvatarComponent, NotificationBellComponent],
  template: `
    <a class="sr-only" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="site-header-inner">
        <a routerLink="/" aria-label="GenZHire home"><gh-logo [height]="28" /></a>
        <nav class="site-nav" aria-label="Main">
          @if (auth.signedIn()) {
            <a routerLink="/app" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
          }
          <a routerLink="/jobs" routerLinkActive="active">Find jobs</a>
          @if (auth.signedIn()) {
            <a routerLink="/app/applications" routerLinkActive="active">Applications</a>
            <a routerLink="/app/saved-jobs" routerLinkActive="active">Saved</a>
            <a routerLink="/app/profile" routerLinkActive="active">Profile</a>
          } @else {
            <a [href]="employerUrl">For employers</a>
          }
        </nav>
        <div class="grow"></div>
        @if (auth.signedIn()) {
          <gh-notification-bell />
          <div class="account">
            <button class="btn btn-ghost" type="button" (click)="menu.update((v) => !v)" [attr.aria-expanded]="menu()" aria-label="Account menu">
              <gh-avatar [name]="auth.user()?.fullName" [seed]="auth.user()?.id" [size]="30" />
              <gh-icon name="chevron-down" [size]="14" class="hide-mobile" />
            </button>
            @if (menu()) {
              <div class="menu" style="right:0;top:48px">
                <div style="padding:8px 10px"><strong>{{ auth.user()?.fullName }}</strong><div class="caption">{{ auth.user()?.email }}</div></div>
                <div class="divider" style="margin:6px 0"></div>
                <a class="menu-item" routerLink="/app/profile"><gh-icon name="user" [size]="16" />My profile</a>
                <a class="menu-item" routerLink="/app/resume"><gh-icon name="file" [size]="16" />Resume</a>
                <a class="menu-item" routerLink="/app/contact-requests"><gh-icon name="mail" [size]="16" />Contact requests</a>
                <a class="menu-item" routerLink="/app/settings/privacy"><gh-icon name="shield" [size]="16" />Privacy</a>
                <a class="menu-item" routerLink="/app/settings"><gh-icon name="settings" [size]="16" />Settings</a>
                <button class="menu-item danger" type="button" (click)="auth.logout()"><gh-icon name="logout" [size]="16" />Sign out</button>
              </div>
            }
          </div>
        } @else {
          <a class="btn btn-ghost" routerLink="/login">Sign in</a>
          <a class="btn btn-primary hide-mobile" routerLink="/register">Create free profile</a>
        }
      </div>
    </header>

    <main id="main" [class.has-bottom-tabs]="auth.signedIn()"><router-outlet /></main>

    <footer class="site-footer">
      <div class="container footer-grid">
        <div class="stack-sm"><gh-logo [height]="24" /><p class="secondary">Your career starts here.</p>
          <p class="caption">GenZHire is a product of SISTECHWORK Private Limited.</p></div>
        <div class="stack-sm"><h4>Jobseekers</h4><a routerLink="/jobs">Find jobs</a><a routerLink="/register">Create profile</a><a routerLink="/app/settings/privacy">Privacy controls</a></div>
        <div class="stack-sm"><h4>Employers</h4><a [href]="employerUrl">Post a job</a><a [href]="employerUrl">Search talent</a><a [href]="employerUrl">HR consulting</a></div>
        <div class="stack-sm"><h4>Company</h4><a routerLink="/legal/privacy">Privacy policy</a><a routerLink="/legal/terms">Terms</a><a routerLink="/legal/grievance">Grievance officer</a></div>
      </div>
      <div class="container caption" style="padding-top:24px">© {{ year }} SISTECHWORK Private Limited. GenZHire never asks candidates to pay for jobs.</div>
    </footer>

    @if (auth.signedIn()) {
      <nav class="bottom-tabs" aria-label="App">
        <a routerLink="/app" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><gh-icon name="home" />Home</a>
        <a routerLink="/jobs" routerLinkActive="active"><gh-icon name="search" />Jobs</a>
        <a routerLink="/app/applications" routerLinkActive="active"><gh-icon name="briefcase" />Applied</a>
        <a routerLink="/app/profile" routerLinkActive="active"><gh-icon name="user" />Profile</a>
        <a routerLink="/app/more" routerLinkActive="active"><gh-icon name="menu" />More</a>
      </nav>
    }`,
  styles: `
    .account { position: relative; }
    main { min-height: calc(100vh - 64px); }
    .site-footer { border-top: 1px solid var(--border); background: var(--surface); padding: 48px 0 32px; margin-top: 64px; }
    .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 24px; }
    .footer-grid a { color: var(--text-secondary); }
    @media (max-width: 767px) { .footer-grid { grid-template-columns: 1fr 1fr; } .site-footer { padding-bottom: 96px; } }`,
})
export class SiteLayoutComponent {
  protected readonly auth = inject(AuthService);
  protected readonly menu = signal(false);
  protected readonly employerUrl = appUrl('employer');
  protected readonly year = new Date().getFullYear();

  constructor() {
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.menu.set(false));
  }
  @HostListener('document:keydown.escape') esc() {
    this.menu.set(false);
  }
}
