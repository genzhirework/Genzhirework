import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, ApiError, appUrl, AuthService } from '@gh/core';
import { IconComponent, LoginFormComponent, LogoComponent } from '@gh/ui';

const AUTH_STYLES = `
  :host { display: flex; justify-content: center; padding: 48px 16px 64px; }
  .auth-card { width: 100%; max-width: 460px; padding: 32px; }
  @media (max-width: 480px) { :host { padding-top: 24px; } .auth-card { padding: 24px 20px; } }`;

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginFormComponent, RouterLink],
  template: `
    <gh-login-form title="Welcome back" subtitle="Sign in to track applications and discover new roles." home="/app">
      <p class="caption" style="margin-top:20px;text-align:center">New to GenZHire? <a routerLink="/register">Create a free profile</a></p>
      <p class="caption" style="text-align:center">Hiring? <a [href]="employerUrl">Employer sign in →</a></p>
    </gh-login-form>`,
  styles: `:host { display: flex; justify-content: center; padding: 48px 16px 64px; }`,
})
export class LoginPage {
  protected readonly employerUrl = appUrl('employer', '/login');
}

@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LogoComponent, IconComponent],
  template: `
    <div class="auth-card card">
      <gh-logo [height]="30" />
      <div class="stack-sm" style="margin:24px 0 20px"><h1 style="font-size:1.5rem">Create your free profile</h1>
        <p class="secondary">Takes about 3 minutes. No work experience needed.</p></div>
      @if (error()) { <div class="alert alert-danger" role="alert" style="margin-bottom:16px"><gh-icon name="alert" [size]="16" /><span>{{ error() }}</span></div> }
      <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
        <div class="grid-2">
          <div class="field"><label for="fn" class="req">First name</label><input id="fn" class="input" formControlName="firstName" autocomplete="given-name" /></div>
          <div class="field"><label for="ln" class="req">Last name</label><input id="ln" class="input" formControlName="lastName" autocomplete="family-name" /></div>
        </div>
        <div class="field"><label for="em" class="req">Email</label><input id="em" class="input" type="email" formControlName="email" autocomplete="email" /></div>
        <div class="field"><label for="pw" class="req">Password</label><input id="pw" class="input" type="password" formControlName="password" autocomplete="new-password" />
          <div class="progress" [class.warn]="strength() < 3" [class.danger]="strength() < 2" aria-hidden="true"><span [style.width.%]="strength() * 25"></span></div>
          <span class="hint">At least 10 characters. A short phrase is easier to remember and harder to guess.</span></div>
        <label class="check"><input type="checkbox" formControlName="ageConfirmed" /><span>I am 18 years or older.</span></label>
        <label class="check"><input type="checkbox" formControlName="discoverable" />
          <span>Let verified employers find my profile in search. <span class="caption">They see a limited preview; your phone and email stay private until you apply or accept a request. You can change this anytime.</span></span></label>
        <p class="caption">By creating an account you agree to the <a routerLink="/legal/terms">Terms</a> and acknowledge the <a routerLink="/legal/privacy">Privacy policy</a>, which explains what we collect and why.</p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" [disabled]="busy()">@if (busy()) { <span class="spinner"></span> } Create profile</button>
      </form>
      <p class="caption" style="margin-top:20px;text-align:center">Already have an account? <a routerLink="/login">Sign in</a></p>
    </div>`,
  styles: AUTH_STYLES,
})
export class RegisterPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly strength = signal(0);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(60)]],
    lastName: ['', [Validators.required, Validators.maxLength(60)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    ageConfirmed: [false, Validators.requiredTrue],
    discoverable: [true],
  });

  constructor() {
    this.form.controls.password.valueChanges.subscribe((p) => {
      let s = 0;
      if (p.length >= 10) s++;
      if (p.length >= 14) s++;
      if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
      if (/[\d\W]/.test(p)) s++;
      this.strength.set(s);
    });
  }

  async submit() {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (!v.ageConfirmed) return this.error.set('You must be 18 or older to use GenZHire.');
    if (this.form.invalid) return this.error.set('Please fill in all required fields. Passwords need at least 10 characters.');
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post('/auth/register/candidate', { ...v, email: v.email.trim() });
      try {
        await this.auth.login(v.email.trim(), v.password);
        await this.router.navigateByUrl('/onboarding');
      } catch (e) {
        const err = ApiError.from(e);
        if (err.code === 'EMAIL_NOT_VERIFIED') await this.router.navigate(['/verify-email'], { queryParams: { sent: 1 } });
        else this.error.set('If this email is new, your account is ready — sign in to continue. Otherwise, sign in or reset your password.');
      }
    } catch (e) {
      const err = ApiError.from(e);
      this.error.set(err.errors[0]?.message ?? err.message);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-verify-email',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LogoComponent, IconComponent],
  template: `
    <div class="auth-card card stack" style="text-align:center;align-items:center">
      <gh-logo [height]="30" />
      @switch (state()) {
        @case ('working') { <span class="spinner"></span><p>Verifying your email…</p> }
        @case ('ok') { <gh-icon name="check" [size]="36" class="ok" /><h2>Email verified</h2><a class="btn btn-primary" routerLink="/login">Sign in</a> }
        @case ('sent') { <gh-icon name="mail" [size]="36" /><h2>Check your inbox</h2><p class="secondary">We sent a verification link. Open it to activate your account.</p> }
        @default { <gh-icon name="alert" [size]="36" class="bad" /><h2>Link invalid or expired</h2><p class="secondary">{{ message() }}</p><a class="btn btn-secondary" routerLink="/login">Back to sign in</a> }
      }
    </div>`,
  styles: AUTH_STYLES + `.ok { color: var(--success); } .bad { color: var(--danger); }`,
})
export class VerifyEmailPage implements OnInit {
  private readonly api = inject(Api);
  readonly token = input<string>();
  readonly sent = input<string>();
  protected readonly state = signal<'working' | 'ok' | 'sent' | 'error'>('working');
  protected readonly message = signal('');
  async ngOnInit() {
    if (this.sent()) return this.state.set('sent');
    if (!this.token()) return this.state.set('error');
    try {
      await this.api.post('/auth/verify-email', { token: this.token() });
      this.state.set('ok');
    } catch (e) {
      this.message.set(ApiError.from(e).message);
      this.state.set('error');
    }
  }
}

@Component({
  selector: 'app-forgot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LogoComponent],
  template: `
    <div class="auth-card card stack">
      <gh-logo [height]="30" />
      <h1 style="font-size:1.5rem">Reset your password</h1>
      @if (sent()) {
        <div class="alert alert-success" role="status">If an account exists for that email, a reset link is on its way. It expires in 30 minutes.</div>
      } @else {
        <p class="secondary">Enter your account email and we'll send you a reset link.</p>
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <div class="field"><label for="em">Email</label><input id="em" class="input" type="email" formControlName="email" autocomplete="email" /></div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="form.invalid || busy()">Send reset link</button>
        </form>
      }
      <a routerLink="/login" class="caption">← Back to sign in</a>
    </div>`,
  styles: AUTH_STYLES,
})
export class ForgotPasswordPage {
  private readonly api = inject(Api);
  protected readonly sent = signal(false);
  protected readonly busy = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({ email: ['', [Validators.required, Validators.email]] });
  async submit() {
    this.busy.set(true);
    try {
      await this.api.post('/auth/password/forgot', { email: this.form.getRawValue().email.trim() });
    } finally {
      this.busy.set(false);
      this.sent.set(true);
    }
  }
}

@Component({
  selector: 'app-reset',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LogoComponent],
  template: `
    <div class="auth-card card stack">
      <gh-logo [height]="30" />
      <h1 style="font-size:1.5rem">Choose a new password</h1>
      @if (done()) {
        <div class="alert alert-success" role="status">Password updated. All other sessions were signed out.</div>
        <a class="btn btn-primary" routerLink="/login">Sign in</a>
      } @else {
        @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack">
          <div class="field"><label for="pw">New password</label><input id="pw" class="input" type="password" formControlName="password" autocomplete="new-password" /><span class="hint">At least 10 characters.</span></div>
          <button class="btn btn-primary btn-block" type="submit" [disabled]="form.invalid">Update password</button>
        </form>
      }
    </div>`,
  styles: AUTH_STYLES,
})
export class ResetPasswordPage {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({ password: ['', [Validators.required, Validators.minLength(10)]] });
  async submit() {
    try {
      await this.api.post('/auth/password/reset', { token: this.route.snapshot.queryParamMap.get('token'), password: this.form.getRawValue().password });
      this.done.set(true);
    } catch (e) {
      this.error.set(ApiError.from(e).message);
    }
  }
}
