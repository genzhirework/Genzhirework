import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, inject, input, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AgoPipe, Api, AuthService } from '@gh/core';
import { filter } from 'rxjs';
import { AvatarComponent } from './bits';
import { IconComponent, LogoComponent } from './icon';

export interface NavItem {
  label: string;
  link: string;
  icon: string;
  exact?: boolean;
  /** Hide unless the session has this permission (UX only — API enforces). */
  permission?: string;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

@Component({
  selector: 'gh-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AgoPipe],
  template: `
    <div class="bell">
      <button class="btn btn-ghost btn-icon" type="button" (click)="toggle()" [attr.aria-expanded]="open()"
              [attr.aria-label]="count() ? count() + ' unread notifications' : 'Notifications'">
        <gh-icon name="bell" />
        @if (count()) { <span class="dot-count">{{ count() > 9 ? '9+' : count() }}</span> }
      </button>
      @if (open()) {
        <div class="menu panel" role="dialog" aria-label="Notifications">
          <div class="row between" style="padding:6px 8px 10px">
            <strong>Notifications</strong>
            @if (count()) { <button class="btn btn-link btn-sm" type="button" (click)="readAll()">Mark all read</button> }
          </div>
          @for (n of items(); track n.id) {
            <button class="menu-item note" [class.unread]="!n.readAt" type="button" (click)="go(n)">
              <span class="stack-sm" style="gap:2px"><strong>{{ n.title }}</strong><span class="caption">{{ n.body }}</span>
                <span class="caption muted">{{ n.createdAt | ago }}</span></span>
            </button>
          } @empty { <p class="caption" style="padding:16px 8px">You're all caught up.</p> }
        </div>
      }
    </div>`,
  styles: `
    .bell { position: relative; }
    .dot-count { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
      background: var(--danger-fill); color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center; }
    .panel { right: 0; top: 44px; width: min(380px, calc(100vw - 24px)); max-height: 480px; overflow: auto; }
    .note { align-items: flex-start; white-space: normal; } .note.unread { background: var(--primary-tint); }`,
})
export class NotificationBellComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  protected readonly count = signal(0);
  protected readonly items = signal<Notification[]>([]);
  protected readonly open = signal(false);

  ngOnInit() {
    const poll = () => this.api.get<{ count: number }>('/notifications/unread-count').then((r) => this.count.set(r.count)).catch(() => {});
    void poll();
    const t = setInterval(poll, 60_000);
    this.destroy.onDestroy(() => clearInterval(t));
  }
  async toggle() {
    this.open.update((v) => !v);
    if (this.open()) this.items.set(await this.api.get<Notification[]>('/notifications'));
  }
  async go(n: Notification) {
    if (!n.readAt) {
      await this.api.post(`/notifications/${n.id}/read`);
      this.count.update((c) => Math.max(0, c - 1));
    }
    this.open.set(false);
    if (n.link) void this.router.navigateByUrl(n.link);
  }
  async readAll() {
    await this.api.post('/notifications/read-all');
    this.count.set(0);
    this.items.update((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }
  @HostListener('document:keydown.escape') esc() {
    this.open.set(false);
  }
}

/** Dashboard shell for employer / recruiter / admin (dark, sidebar + top bar). */
@Component({
  selector: 'gh-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent, LogoComponent, AvatarComponent, NotificationBellComponent],
  template: `
    <div class="shell" [class.open]="menuOpen()">
      <div class="shell-scrim" (click)="menuOpen.set(false)"></div>
      <nav class="shell-sidebar" aria-label="Main">
        <div class="shell-brand"><gh-logo [height]="26" /><span class="app-name">{{ appName() }}</span></div>
        <ng-content select="[sidebar-top]" />
        @for (g of nav(); track $index) {
          <div class="nav-group">
            @if (g.label) { <span class="nav-group-label">{{ g.label }}</span> }
            @for (i of g.items; track i.link) {
              @if (!i.permission || auth.hasPermission(i.permission)) {
                <a class="nav-link" [routerLink]="i.link" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!i.exact }">
                  <gh-icon [name]="i.icon" [size]="18" /><span>{{ i.label }}</span>
                </a>
              }
            }
          </div>
        }
      </nav>
      <div class="shell-main">
        <header class="shell-topbar">
          <button class="btn btn-ghost btn-icon shell-menu-btn" type="button" (click)="menuOpen.set(true)" aria-label="Open menu"><gh-icon name="menu" /></button>
          <div class="grow"><ng-content select="[topbar]" /></div>
          <gh-notification-bell />
          <div class="account">
            <button class="btn btn-ghost" type="button" (click)="accountOpen.update((v) => !v)" [attr.aria-expanded]="accountOpen()" aria-label="Account menu">
              <gh-avatar [name]="auth.user()?.fullName || auth.user()?.email" [seed]="auth.user()?.id" [size]="28" />
              <span class="hide-mobile truncate" style="max-width:160px">{{ auth.user()?.fullName || auth.user()?.email }}</span>
              <gh-icon name="chevron-down" [size]="14" />
            </button>
            @if (accountOpen()) {
              <div class="menu" style="right:0;top:48px">
                <div style="padding:8px 10px"><strong class="truncate" style="display:block">{{ auth.user()?.fullName }}</strong>
                  <span class="caption">{{ auth.user()?.email }}</span></div>
                <div class="divider" style="margin:6px 0"></div>
                <a class="menu-item" routerLink="/settings" (click)="accountOpen.set(false)"><gh-icon name="settings" [size]="16" />Settings</a>
                <button class="menu-item danger" type="button" (click)="auth.logout()"><gh-icon name="logout" [size]="16" />Sign out</button>
              </div>
            }
          </div>
        </header>
        <main class="shell-content" id="main"><ng-content /></main>
      </div>
    </div>`,
  styles: `.account { position: relative; }`,
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
  readonly appName = input.required<string>();
  readonly nav = input.required<NavGroup[]>();
  protected readonly menuOpen = signal(false);
  protected readonly accountOpen = signal(false);

  constructor() {
    inject(Router).events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.menuOpen.set(false);
      this.accountOpen.set(false);
    });
  }
  @HostListener('document:keydown.escape') esc() {
    this.menuOpen.set(false);
    this.accountOpen.set(false);
  }
}
