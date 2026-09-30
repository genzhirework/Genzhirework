import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AgoPipe, Api, ApiError, AuthService, DatePipe, expRange, LabelPipe, loader, OPTIONS, salaryRange } from '@gh/core';
import { AvatarComponent, IconComponent, ModalComponent, PageStateComponent, StatusBadgeComponent, ToastService } from '@gh/ui';

interface JobDetail {
  id: string;
  title: string;
  status: string;
  department: string | null;
  description: string;
  responsibilities: string | null;
  requirements: string | null;
  qualifications: string[];
  minEducationLevel: string | null;
  experienceMinMonths: number;
  experienceMaxMonths: number | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod: string;
  workMode: string;
  employmentType: string;
  openings: number;
  applicationDeadline: string | null;
  publishedAt: string | null;
  locations: { city: string; state: string }[];
  skills: { id: number; name: string; mandatory: boolean }[];
  company: { name: string; slug: string; website: string | null; industry: string | null; sizeBand: string | null; description: string | null; logoFileId: string | null; verified: boolean };
  viewerState?: { saved: boolean; applied: boolean; applicationId: string | null; applicationStatus: string | null };
}

interface Me {
  firstName: string;
  lastName: string;
  city: string | null;
  profile: { headline: string | null };
  completion: { percent: number; missing: string[] };
  resumes: { id: string; label: string; isPrimary: boolean; file: { originalName: string } }[];
}

@Component({
  selector: 'app-job-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageStateComponent, IconComponent, AvatarComponent, ModalComponent, StatusBadgeComponent, LabelPipe, AgoPipe, DatePipe],
  template: `
    <div class="container" style="padding-top:24px">
      <gh-page-state [state]="job">
        @if (job.data(); as j) {
          <nav class="breadcrumb"><a routerLink="/jobs">Jobs</a> / {{ j.title }}</nav>
          @if (j.status === 'CLOSED') { <div class="alert alert-warning" style="margin-bottom:16px"><gh-icon name="info" [size]="16" />This job is no longer accepting applications.</div> }
          <div class="layout">
            <div class="stack">
              <section class="card stack">
                <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
                  @if (j.company.logoFileId) { <img class="logo" [src]="'/api/v1/files/' + j.company.logoFileId + '/logo'" alt="" width="56" height="56" /> }
                  @else { <gh-avatar [name]="j.company.name" [seed]="j.company.slug" [size]="56" /> }
                  <div class="grow stack-sm">
                    <h1 style="font-size:1.625rem">{{ j.title }}</h1>
                    <div class="row-sm secondary"><span style="font-size:1rem">{{ j.company.name }}</span>
                      @if (j.company.verified) { <span class="badge badge-success"><gh-icon name="shield" [size]="12" />Verified employer</span> }</div>
                  </div>
                </div>
                <div class="facts">
                  <div><span class="caption">Location</span><strong>{{ cities(j) }}</strong></div>
                  <div><span class="caption">Work mode</span><strong>{{ j.workMode | label }}</strong></div>
                  <div><span class="caption">Salary</span><strong>{{ salary(j) }}</strong></div>
                  <div><span class="caption">Experience</span><strong>{{ exp(j) }}</strong></div>
                  <div><span class="caption">Job type</span><strong>{{ j.employmentType | label }}</strong></div>
                  <div><span class="caption">Openings</span><strong>{{ j.openings }}</strong></div>
                </div>
                <div class="row">
                  @if (j.viewerState?.applied) {
                    <a class="btn btn-secondary btn-lg" [routerLink]="['/app/applications', j.viewerState!.applicationId]">View application</a>
                    <gh-status kind="application" [value]="j.viewerState!.applicationStatus" audience="candidate" />
                  } @else if (j.status === 'PUBLISHED') {
                    <button class="btn btn-primary btn-lg" type="button" (click)="startApply()">Apply now</button>
                  }
                  @if (auth.signedIn()) {
                    <button class="btn btn-secondary btn-lg" type="button" (click)="toggleSave(j)" [attr.aria-pressed]="saved()">
                      <gh-icon name="bookmark" [size]="16" />{{ saved() ? 'Saved' : 'Save job' }}</button>
                  }
                  <button class="btn btn-ghost btn-lg" type="button" (click)="share(j)"><gh-icon name="link" [size]="16" />Share</button>
                </div>
                <p class="caption">Posted {{ j.publishedAt | ago }}{{ j.applicationDeadline ? ' · Apply by ' + (j.applicationDeadline | ghDate) : '' }}</p>
              </section>

              <section class="card stack"><h2>About the role</h2><p class="pre-line body">{{ j.description }}</p>
                @if (j.responsibilities) { <h3>Responsibilities</h3><p class="pre-line body">{{ j.responsibilities }}</p> }
                @if (j.requirements) { <h3>Requirements</h3><p class="pre-line body">{{ j.requirements }}</p> }
                @if (j.minEducationLevel || j.qualifications.length) {
                  <h3>Qualification</h3><p class="body">{{ j.minEducationLevel ? (j.minEducationLevel | label) + ' or above' : '' }}{{ j.qualifications.length ? ' · ' + j.qualifications.join(', ') : '' }}</p>
                }
                <h3>Skills</h3>
                <div class="row-sm">@for (s of j.skills; track s.id) { <span class="tag" [class.mine]="mySkills().has(s.id)">{{ s.name }}</span> }</div>
                @if (auth.signedIn() && mySkills().size) { <p class="caption">Highlighted skills are on your profile.</p> }
              </section>
            </div>

            <aside class="stack">
              <section class="card stack-sm"><h3>About {{ j.company.name }}</h3>
                @if (j.company.description) { <p class="secondary pre-line">{{ j.company.description }}</p> }
                <dl class="kv" style="grid-template-columns:90px 1fr">
                  @if (j.company.industry) { <dt>Industry</dt><dd>{{ j.company.industry }}</dd> }
                  @if (j.company.sizeBand) { <dt>Size</dt><dd>{{ j.company.sizeBand | label }} employees</dd> }
                  @if (j.company.website) { <dt>Website</dt><dd><a [href]="j.company.website" target="_blank" rel="noopener noreferrer">{{ host(j.company.website) }}</a></dd> }
                </dl>
              </section>
              <section class="card stack-sm safety"><h4><gh-icon name="shield" [size]="16" />Stay safe</h4>
                <p class="caption">GenZHire and genuine employers never ask for money for jobs, training or interviews.</p>
                @if (auth.signedIn()) { <button class="btn btn-link btn-sm" type="button" (click)="reportOpen.set(true)">Report this job</button> }
              </section>
            </aside>
          </div>

          <!-- Apply: Confirm profile → Resume → Optional note → Submit → Confirmation (spec §14) -->
          <gh-modal [open]="applyOpen()" [title]="done() ? 'Application sent' : 'Apply to ' + j.title" [subtitle]="done() ? null : j.company.name" (closed)="applyOpen.set(false)">
            @if (done()) {
              <div class="stack" style="text-align:center;align-items:center">
                <span class="ok-circle"><gh-icon name="check" [size]="28" /></span>
                <p>Your application is with <strong>{{ j.company.name }}</strong>. We'll notify you when it's viewed or your status changes.</p>
              </div>
            } @else if (me(); as m) {
              <div class="stack">
                <div class="card card-tight row" style="flex-wrap:nowrap">
                  <gh-avatar [name]="m.firstName + ' ' + m.lastName" [size]="40" />
                  <div class="grow"><strong>{{ m.firstName }} {{ m.lastName }}</strong><div class="caption">{{ m.profile.headline || 'Add a headline to stand out' }}{{ m.city ? ' · ' + m.city : '' }}</div></div>
                  <a class="btn btn-link btn-sm" routerLink="/app/profile" (click)="applyOpen.set(false)">Edit</a>
                </div>
                @if (m.completion.percent < 60) { <div class="alert alert-warning"><gh-icon name="info" [size]="16" /><span>Your profile is {{ m.completion.percent }}% complete. Employers see this profile with your application.</span></div> }
                <fieldset class="stack-sm" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:8px">Resume</legend>
                  @for (r of m.resumes; track r.id) {
                    <label class="check card card-tight" [class.card-selected]="resumeId === r.id"><input type="radio" name="resume" [value]="r.id" [(ngModel)]="resumeId" />
                      <span><strong>{{ r.label }}</strong>@if (r.isPrimary) { <span class="badge" style="margin-left:6px">Primary</span> }<br /><span class="caption">{{ r.file.originalName }}</span></span></label>
                  }
                  <label class="btn btn-secondary" style="align-self:flex-start"><gh-icon name="upload" [size]="16" />{{ uploading() ? 'Uploading…' : 'Upload a resume' }}
                    <input type="file" accept=".pdf,.doc,.docx" class="sr-only" (change)="upload($event)" [disabled]="uploading()" /></label>
                  <span class="caption">PDF or Word, up to 5 MB.</span>
                </fieldset>
                <div class="field"><label for="note">Cover note <span class="muted">(optional)</span></label>
                  <textarea id="note" class="textarea" [(ngModel)]="note" maxlength="1000" placeholder="A line or two on why you're a good fit"></textarea>
                  <span class="hint">{{ note.length }}/1000</span></div>
                <p class="caption">By applying you share your profile, resume and contact details with {{ j.company.name }} for this job.</p>
                @if (applyError()) { <div class="alert alert-danger" role="alert">{{ applyError() }}</div> }
              </div>
            } @else { <div class="skeleton" style="height:180px"></div> }
            <ng-container footer>
              @if (done()) {
                <a class="btn btn-secondary" routerLink="/jobs" (click)="applyOpen.set(false)">Browse more jobs</a>
                <a class="btn btn-primary" routerLink="/app/applications">Track applications</a>
              } @else {
                <button class="btn btn-secondary" type="button" (click)="applyOpen.set(false)">Cancel</button>
                <button class="btn btn-primary" type="button" [disabled]="!resumeId || submitting()" (click)="submit(j)">@if (submitting()) { <span class="spinner"></span> } Submit application</button>
              }
            </ng-container>
          </gh-modal>

          <gh-modal [open]="reportOpen()" title="Report this job" subtitle="Our trust & safety team reviews every report." (closed)="reportOpen.set(false)">
            <div class="stack">
              <div class="field"><label for="rr">Reason</label>
                <select id="rr" class="select" [(ngModel)]="reportReason">@for (r of reasons; track r) { <option [value]="r">{{ r | label }}</option> }</select></div>
              <div class="field"><label for="rd">Details <span class="muted">(optional)</span></label><textarea id="rd" class="textarea" [(ngModel)]="reportDetails" maxlength="1000"></textarea></div>
            </div>
            <ng-container footer>
              <button class="btn btn-secondary" type="button" (click)="reportOpen.set(false)">Cancel</button>
              <button class="btn btn-danger" type="button" (click)="report(j)">Submit report</button>
            </ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    .logo { width: 56px; height: 56px; border-radius: 12px; object-fit: contain; border: 1px solid var(--border); background: var(--bg-subtle); }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 16px; background: var(--bg-subtle); border-radius: var(--radius-sm); }
    .facts div { display: flex; flex-direction: column; gap: 2px; }
    .body { font-size: 1rem; line-height: 1.6; color: var(--text-secondary); }
    .tag.mine { background: var(--primary-tint); color: var(--primary); }
    .safety h4 { display: flex; align-items: center; gap: 6px; }
    .ok-circle { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: var(--success-tint); color: var(--success); }
    @media (max-width: 1023px) { .layout { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 640px) { .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }`,
})
export class JobDetailPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();

  protected readonly job = loader(() => this.api.get<JobDetail>(`/jobs/${this.id()}`));
  protected readonly me = signal<Me | null>(null);
  protected readonly mySkills = signal(new Set<number>());
  protected readonly savedOverride = signal<boolean | null>(null);
  protected readonly saved = computed(() => this.savedOverride() ?? !!this.job.data()?.viewerState?.saved);
  protected readonly applyOpen = signal(false);
  protected readonly reportOpen = signal(false);
  protected readonly submitting = signal(false);
  protected readonly uploading = signal(false);
  protected readonly done = signal(false);
  protected readonly applyError = signal<string | null>(null);
  protected readonly reasons = OPTIONS.reportReason;
  protected resumeId = '';
  protected note = '';
  protected reportReason = 'FAKE_JOB';
  protected reportDetails = '';

  constructor() {
    if (this.auth.signedIn()) {
      this.api.get<Me & { skills: { id: number }[] }>('/candidate/profile').then((m) => {
        this.me.set(m);
        this.mySkills.set(new Set(m.skills.map((s) => s.id)));
        this.resumeId = m.resumes.find((r) => r.isPrimary)?.id ?? m.resumes[0]?.id ?? '';
      }).catch(() => {});
    }
  }

  protected salary = (j: JobDetail) => salaryRange(j.salaryMinPaise, j.salaryMaxPaise, j.salaryPeriod);
  protected exp = (j: JobDetail) => expRange(j.experienceMinMonths, j.experienceMaxMonths);
  protected cities = (j: JobDetail) => j.locations.map((l) => l.city).join(', ') || 'India';
  protected host = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/$/, '');

  startApply() {
    if (!this.auth.signedIn()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: `/jobs/${this.id()}` } });
      return;
    }
    this.done.set(false);
    this.applyError.set(null);
    this.applyOpen.set(true);
  }

  async upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.uploading.set(true);
    try {
      const f = await this.api.upload(file, 'RESUME');
      const r = await this.api.post<{ id: string }>('/candidate/resumes', { fileId: f.id });
      const m = await this.api.get<Me>('/candidate/profile');
      this.me.set(m);
      this.resumeId = r.id;
    } catch (e) {
      this.applyError.set(ApiError.from(e).message);
    } finally {
      this.uploading.set(false);
    }
  }

  async submit(j: JobDetail) {
    this.submitting.set(true);
    this.applyError.set(null);
    try {
      await this.api.post(`/candidate/jobs/${j.id}/apply`, { resumeId: this.resumeId, coverNote: this.note.trim() || undefined });
      this.done.set(true);
      await this.job.reload();
    } catch (e) {
      this.applyError.set(ApiError.from(e).message);
    } finally {
      this.submitting.set(false);
    }
  }

  async toggleSave(j: JobDetail) {
    const was = this.saved();
    try {
      if (was) await this.api.delete(`/candidate/saved-jobs/${j.id}`);
      else await this.api.put(`/candidate/saved-jobs/${j.id}`);
      this.savedOverride.set(!was);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async share(j: JobDetail) {
    const url = `${location.origin}/jobs/${j.id}`;
    try {
      if (navigator.share) await navigator.share({ title: j.title, text: `${j.title} at ${j.company.name}`, url });
      else {
        await navigator.clipboard.writeText(url);
        this.toast.success('Link copied');
      }
    } catch {
      /* user cancelled share sheet */
    }
  }

  async report(j: JobDetail) {
    try {
      await this.api.post(`/jobs/${j.id}/report`, { reason: this.reportReason, details: this.reportDetails.trim() || undefined });
      this.reportOpen.set(false);
      this.toast.success('Thanks — our team will review this job.');
    } catch (e) {
      this.toast.error(e);
    }
  }
}
