import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError, AuthService } from '@gh/core';
import { IconComponent, LogoComponent } from './icon';

/** Sign-in form shared by all four apps; each app passes its own copy. */
@Component({
  selector: 'gh-login-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LogoComponent, IconComponent],
  template: `
    <div class="auth-card card">
      <gh-logo [height]="30" />
      <div class="stack-sm" style="margin:24px 0 20px"><h1 style="font-size:1.5rem">{{ title() }}</h1><p class="secondary">{{ subtitle() }}</p></div>
      @if (error()) { <div class="alert alert-danger" role="alert" style="margin-bottom:16px"><gh-icon name="alert" [size]="16" /><span>{{ error() }}</span></div> }
      <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
        <div class="field"><label for="email">Email</label>
          <input id="email" class="input" type="email" formControlName="email" autocomplete="username" [attr.aria-invalid]="invalid('email')" /></div>
        <div class="field">
          <div class="row between"><label for="password">Password</label>
            @if (showForgot()) { <a routerLink="/forgot-password" class="caption">Forgot password?</a> }</div>
          <div style="position:relative">
            <input id="password" class="input" [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="current-password" [attr.aria-invalid]="invalid('password')" />
            <button type="button" class="btn btn-ghost btn-sm reveal" (click)="show.update((v) => !v)" [attr.aria-label]="show() ? 'Hide password' : 'Show password'"><gh-icon [name]="show() ? 'eye' : 'lock'" [size]="15" /></button>
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" type="submit" [disabled]="busy()">
          @if (busy()) { <span class="spinner"></span> } Sign in
        </button>
      </form>
      <ng-content />
    </div>`,
  styles: `
    .auth-card { width: 100%; max-width: 420px; padding: 32px; }
    .reveal { position: absolute; right: 4px; top: 4px; }
    @media (max-width: 480px) { .auth-card { padding: 24px 20px; border: 0; background: transparent; } }`,
})
export class LoginFormComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly title = input('Sign in');
  readonly subtitle = input('');
  readonly home = input('/');
  readonly showForgot = input(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly show = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected invalid(c: 'email' | 'password') {
    const ctl = this.form.controls[c];
    return ctl.invalid && ctl.touched ? 'true' : null;
  }

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Enter your email and password.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.form.value.email!.trim(), this.form.value.password!);
      const r = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(r && r.startsWith('/') && !r.startsWith('//') ? r : this.home());
    } catch (e) {
      this.error.set(ApiError.from(e).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Password change + active sessions — the security section of every app's settings. */
@Component({
  selector: 'gh-security-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IconComponent],
  template: `
    <section class="card stack">
      <div><h3>Change password</h3><p class="secondary">Other signed-in devices will be signed out.</p></div>
      @if (pwMsg()) { <div class="alert" [class.alert-success]="pwOk()" [class.alert-danger]="!pwOk()" role="status">{{ pwMsg() }}</div> }
      <form [formGroup]="pw" (ngSubmit)="changePassword()" class="form-grid">
        <div class="field span-2"><label for="cur">Current password</label><input id="cur" class="input" type="password" formControlName="currentPassword" autocomplete="current-password" /></div>
        <div class="field"><label for="np">New password</label><input id="np" class="input" type="password" formControlName="newPassword" autocomplete="new-password" />
          <span class="hint">At least 10 characters.</span></div>
        <div class="field"><label for="np2">Confirm new password</label><input id="np2" class="input" type="password" formControlName="confirm" autocomplete="new-password" /></div>
        <div class="span-2 form-actions"><button class="btn btn-primary" type="submit" [disabled]="pwBusy()">Update password</button></div>
      </form>
    </section>
    <section class="card stack">
      <div class="row between"><div><h3>Where you're signed in</h3><p class="secondary">Sign out of sessions you don't recognise.</p></div>
        <button class="btn btn-secondary" type="button" (click)="auth.logoutAll()">Sign out everywhere</button></div>
      <ul class="list-reset stack-sm">
        @for (s of sessions(); track s.id) {
          <li class="row between session">
            <div class="row"><gh-icon name="key" class="muted" />
              <div><strong>{{ device(s.userAgent) }}</strong>&ngsp;<span class="badge">{{ s.app.toLowerCase() }}</span>
                @if (s.current) { <span class="badge badge-success">This device</span> }
                <div class="caption">{{ s.ipAddress || 'Unknown IP' }} · last active {{ fmt(s.lastUsedAt) }}</div></div></div>
            @if (!s.current) { <button class="btn btn-ghost btn-sm" type="button" (click)="revoke(s.id)">Sign out</button> }
          </li>
        }
      </ul>
    </section>`,
  styles: `:host { display: flex; flex-direction: column; gap: 16px; } .session { padding: 10px 0; border-bottom: 1px solid var(--border); }`,
})
export class SecuritySettingsComponent {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(Api);
  protected readonly sessions = signal<{ id: string; app: string; ipAddress: string | null; userAgent: string | null; lastUsedAt: string; current: boolean }[]>([]);
  protected readonly pwBusy = signal(false);
  protected readonly pwMsg = signal<string | null>(null);
  protected readonly pwOk = signal(false);
  protected readonly pw = inject(FormBuilder).nonNullable.group({ currentPassword: '', newPassword: '', confirm: '' });

  constructor() {
    void this.load();
  }
  async load() {
    this.sessions.set(await this.api.get('/auth/sessions'));
  }
  async revoke(id: string) {
    await this.api.delete(`/auth/sessions/${id}`);
    await this.load();
  }
  async changePassword() {
    const v = this.pw.getRawValue();
    if (v.newPassword.length < 10) return this.fail('New password must be at least 10 characters.');
    if (v.newPassword !== v.confirm) return this.fail('The new passwords do not match.');
    this.pwBusy.set(true);
    try {
      await this.api.post('/auth/password/change', { currentPassword: v.currentPassword, newPassword: v.newPassword });
      this.pwOk.set(true);
      this.pwMsg.set('Password updated. Other devices have been signed out.');
      this.pw.reset();
      await this.load();
    } catch (e) {
      this.fail(ApiError.from(e).message);
    } finally {
      this.pwBusy.set(false);
    }
  }
  private fail(m: string) {
    this.pwOk.set(false);
    this.pwMsg.set(m);
  }
  protected device(ua: string | null) {
    if (!ua) return 'Unknown device';
    const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${b} on ${os}` : b;
  }
  protected fmt(d: string) {
    return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }
}
