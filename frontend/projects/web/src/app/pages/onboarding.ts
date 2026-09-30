import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, AuthService, LabelPipe, OPTIONS } from '@gh/core';
import { Skill, SkillPickerComponent, ToastService } from '@gh/ui';

/** 3-step onboarding (docs/03-user-journeys.md J1): basics → education → skills. */
@Component({
  selector: 'app-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SkillPickerComponent, LabelPipe],
  template: `
    <div class="wrap">
      <div class="card stack-lg">
        <div class="stack-sm">
          <span class="overline">Step {{ step() }} of 3</span>
          <div class="progress"><span [style.width.%]="step() * 33.4"></span></div>
          <h1 style="font-size:1.5rem">{{ titles[step() - 1] }}</h1>
          <p class="secondary">{{ subtitles[step() - 1] }}</p>
        </div>
        @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

        @switch (step()) {
          @case (1) {
            <div class="form-grid">
              <div class="field"><label for="city" class="req">City</label>
                <input id="city" class="input" [(ngModel)]="basics.city" list="ob-cities" placeholder="e.g. Chennai" />
                <datalist id="ob-cities">@for (c of cities; track c) { <option [value]="c"></option> }</datalist></div>
              <div class="field"><label for="state">State</label>
                <select id="state" class="select" [(ngModel)]="basics.state"><option value="">Select</option>@for (s of states; track s) { <option [value]="s">{{ s }}</option> }</select></div>
              <div class="field"><label for="es">Current status</label>
                <select id="es" class="select" [(ngModel)]="basics.employmentStatus">@for (s of statuses; track s) { <option [value]="s">{{ s | label }}</option> }</select></div>
              <div class="field"><label for="av">When can you join?</label>
                <select id="av" class="select" [(ngModel)]="basics.availability">@for (s of availability; track s) { <option [value]="s">{{ s | label }}</option> }</select></div>
              <div class="field span-2"><label for="tr">Role you're looking for</label>
                <input id="tr" class="input" [(ngModel)]="basics.targetRole" placeholder="e.g. Data Analyst, Java Developer, Sales Executive" maxlength="100" /></div>
            </div>
          }
          @case (2) {
            <div class="form-grid">
              <div class="field"><label for="lvl" class="req">Level</label>
                <select id="lvl" class="select" [(ngModel)]="edu.level">@for (l of levels; track l) { <option [value]="l">{{ l | label }}</option> }</select></div>
              <div class="field"><label for="deg">Degree</label><input id="deg" class="input" [(ngModel)]="edu.degree" placeholder="e.g. B.Tech, B.Com, BCA" maxlength="80" /></div>
              <div class="field span-2"><label for="spec">Specialization</label><input id="spec" class="input" [(ngModel)]="edu.specialization" placeholder="e.g. Computer Science" maxlength="120" /></div>
              <div class="field span-2"><label for="inst" class="req">College / institution</label><input id="inst" class="input" [(ngModel)]="edu.institution" maxlength="160" /></div>
              <div class="field"><label for="gy" class="req">Graduation year</label><input id="gy" class="input" type="number" [(ngModel)]="edu.graduationYear" min="1980" max="2035" /></div>
              <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" [(ngModel)]="edu.isPursuing" />I'm still studying</label>
            </div>
          }
          @case (3) {
            <div class="field"><label class="req" for="sk">Your skills</label>
              <gh-skill-picker [(value)]="skills" inputId="sk" />
              <span class="hint">Add at least 3. Employers search by skill, so be specific (e.g. "SQL", "Power BI", "Tally").</span></div>
          }
        }

        <div class="form-actions" style="justify-content:space-between">
          @if (step() > 1) { <button class="btn btn-ghost" type="button" (click)="step.set(step() - 1)">Back</button> } @else { <span></span> }
          <button class="btn btn-primary btn-lg" type="button" [disabled]="busy()" (click)="next()">
            @if (busy()) { <span class="spinner"></span> } {{ step() === 3 ? 'Finish' : 'Continue' }}</button>
        </div>
      </div>
      <p class="caption" style="text-align:center;margin-top:12px">You can add projects, certifications and your resume from your profile afterwards.</p>
    </div>`,
  styles: `.wrap { max-width: 640px; margin: 0 auto; padding: 40px 16px 64px; } .card { padding: 32px; } @media (max-width: 480px) { .card { padding: 20px; } }`,
})
export class OnboardingPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  protected readonly step = signal(1);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly cities = OPTIONS.cities;
  protected readonly states = OPTIONS.states;
  protected readonly statuses = OPTIONS.employmentStatus;
  protected readonly availability = OPTIONS.availability;
  protected readonly levels = OPTIONS.educationLevel;
  protected readonly titles = ['Where are you based?', 'Your latest education', 'What are you good at?'];
  protected readonly subtitles = [
    'Employers filter candidates by city and joining date.',
    'Freshers are discovered mostly by degree and graduation year.',
    'Skills are the #1 way employers search the talent database.',
  ];
  protected basics = { city: '', state: '', employmentStatus: 'FRESHER', availability: 'IMMEDIATE', targetRole: '' };
  protected edu = { level: 'UG', degree: '', specialization: '', institution: '', graduationYear: new Date().getFullYear(), isPursuing: false };
  protected readonly skills = signal<Skill[]>([]);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor() {
    this.api.get<{ onboardingCompleted: boolean; city: string | null; skills: Skill[] }>('/candidate/profile').then((m) => {
      if (m.onboardingCompleted) void this.router.navigateByUrl('/app');
      if (m.city) this.basics.city = m.city;
      this.skills.set(m.skills);
      this.cdr.markForCheck();
    }).catch(() => {});
  }

  async next() {
    this.error.set(null);
    this.busy.set(true);
    try {
      if (this.step() === 1) {
        if (!this.basics.city.trim()) throw new Error('Please enter your city.');
        await this.api.patch('/candidate/profile', {
          city: this.basics.city.trim(), state: this.basics.state || undefined, employmentStatus: this.basics.employmentStatus,
          availability: this.basics.availability, targetRole: this.basics.targetRole.trim() || undefined,
          preferredCities: [this.basics.city.trim()],
        });
        this.step.set(2);
      } else if (this.step() === 2) {
        if (this.edu.institution.trim().length < 2 || !this.edu.graduationYear) throw new Error('Add your institution and graduation year.');
        await this.api.post('/candidate/education', {
          level: this.edu.level, degree: this.edu.degree.trim() || undefined, specialization: this.edu.specialization.trim() || undefined,
          institution: this.edu.institution.trim(), graduationYear: Number(this.edu.graduationYear), isPursuing: this.edu.isPursuing,
        });
        this.step.set(3);
      } else {
        if (this.skills().length < 3) throw new Error('Add at least 3 skills.');
        await this.api.put('/candidate/skills', { skills: this.skills().map((s) => ({ skillId: s.id })) });
        await this.api.post('/candidate/onboarding/complete');
        this.toast.success('Profile created! Complete a few more sections to stand out.');
        await this.router.navigateByUrl('/app');
      }
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
