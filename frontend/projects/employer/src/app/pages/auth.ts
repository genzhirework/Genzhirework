import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, appUrl, AuthService } from '@gh/core';
import { IconComponent, LoginFormComponent, LogoComponent } from '@gh/ui';

const SPLIT = `
  :host { display: grid; grid-template-columns: 1fr 1fr; min-height: 100vh; }
  .pitch { background: var(--bg-subtle); border-right: 1px solid var(--border); padding: 64px; display: flex; flex-direction: column; justify-content: center; gap: 24px; }
  .pitch h1 { font-size: 2rem; line-height: 1.2; max-width: 460px; }
  .pitch ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 14px; color: var(--text-secondary); }
  .pitch li { display: flex; gap: 10px; align-items: flex-start; } .pitch li gh-icon { color: var(--primary); margin-top: 2px; }
  .form-side { display: flex; align-items: center; justify-content: center; padding: 32px 16px; }
  .auth-card { width: 100%; max-width: 460px; padding: 32px; }
  @media (max-width: 1023px) { :host { grid-template-columns: 1fr; } .pitch { display: none; } }`;

const PITCH = `
  <aside class="pitch">
    <gh-logo [height]="30" />
    <h1>Hire freshers faster, with verified talent.</h1>
    <ul>
      <li><gh-icon name="search" />Search a database of early-career candidates by skill, degree, graduation year and city.</li>
      <li><gh-icon name="unlock" />50 free profile views once your company is verified.</li>
      <li><gh-icon name="users" />Need help? GenZHire HR consultants source and screen for you — no upfront fee.</li>
    </ul>
  </aside>`;

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoginFormComponent, RouterLink, LogoComponent, IconComponent],
  template: PITCH + `
    <div class="form-side">
      <gh-login-form title="Employer sign in" subtitle="Manage jobs, applicants and talent search." home="/dashboard">
        <p class="caption" style="margin-top:20px;text-align:center">New to GenZHire? <a routerLink="/register">Create an employer account</a></p>
        <p class="caption" style="text-align:center">Looking for a job? <a [href]="seekerUrl">Go to GenZHire.work →</a></p>
      </gh-login-form>
    </div>`,
  styles: SPLIT,
})
export class LoginPage {
  protected readonly seekerUrl = appUrl('jobseeker');
}

@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, LogoComponent, IconComponent],
  template: PITCH + `
    <div class="form-side">
      <div class="auth-card card">
        <h1 style="font-size:1.5rem">Create an employer account</h1>
        <p class="secondary" style="margin:6px 0 20px">Use your work email — it speeds up verification.</p>
        @if (error()) { <div class="alert alert-danger" role="alert" style="margin-bottom:16px"><gh-icon name="alert" [size]="16" /><span>{{ error() }}</span></div> }
        <form [formGroup]="form" (ngSubmit)="submit()" class="stack" novalidate>
          <div class="grid-2">
            <div class="field"><label for="fn" class="req">First name</label><input id="fn" class="input" formControlName="firstName" autocomplete="given-name" /></div>
            <div class="field"><label for="ln" class="req">Last name</label><input id="ln" class="input" formControlName="lastName" autocomplete="family-name" /></div>
          </div>
          <div class="field"><label for="cn" class="req">Company name</label><input id="cn" class="input" formControlName="companyName" autocomplete="organization" /></div>
          <div class="field"><label for="ds">Your designation</label><input id="ds" class="input" formControlName="designation" placeholder="e.g. HR Manager" /></div>
          <div class="field"><label for="em" class="req">Work email</label><input id="em" class="input" type="email" formControlName="email" autocomplete="email" />
            <span class="hint">Personal email (Gmail etc.) works, but you'll need to upload a registration document to verify.</span></div>
          <div class="field"><label for="pw" class="req">Password</label><input id="pw" class="input" type="password" formControlName="password" autocomplete="new-password" /><span class="hint">At least 10 characters.</span></div>
          <p class="caption">By creating an account you agree to the employer terms, including using candidate data only for recruitment.</p>
          <button class="btn btn-primary btn-lg btn-block" type="submit" [disabled]="busy()">@if (busy()) { <span class="spinner"></span> } Create account</button>
        </form>
        <p class="caption" style="margin-top:20px;text-align:center">Already have an account? <a routerLink="/login">Sign in</a></p>
      </div>
    </div>`,
  styles: SPLIT,
})
export class RegisterPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    companyName: ['', [Validators.required, Validators.minLength(2)]],
    designation: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
  });

  async submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return this.error.set('Please complete all required fields. Passwords need at least 10 characters.');
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.post('/auth/register/employer', { ...v, email: v.email.trim(), designation: v.designation || undefined });
      try {
        await this.auth.login(v.email.trim(), v.password);
        await this.router.navigateByUrl('/company/verification?welcome=1');
      } catch {
        this.error.set('Your account may already exist — sign in, or reset your password.');
      }
    } catch (e) {
      const err = ApiError.from(e);
      this.error.set(err.errors[0]?.message ?? err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
