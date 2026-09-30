import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, AuthService, DatePipe, isEmptyArray, LabelPipe, loader } from '@gh/core';
import { ConfirmService, IconComponent, PageStateComponent, SecuritySettingsComponent, ToastService } from '@gh/ui';

interface Resume {
  id: string;
  label: string;
  isPrimary: boolean;
  createdAt: string;
  file: { id: string; originalName: string; mimeType: string; sizeBytes: number };
}

@Component({
  selector: 'app-resume',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageStateComponent, IconComponent, DatePipe],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <div class="page-header"><div><h1>Resume</h1><p>Keep up to 3 versions. Employers download your primary resume.</p></div>
        <label class="btn btn-primary" [class.disabled]="uploading()"><gh-icon name="upload" [size]="16" />{{ uploading() ? 'Uploading…' : 'Upload resume' }}
          <input type="file" class="sr-only" accept=".pdf,.doc,.docx" (change)="upload($event)" [disabled]="uploading() || (list.data()?.length ?? 0) >= 3" /></label>
      </div>
      <p class="caption" style="margin-bottom:12px">PDF or Word, up to 5 MB. We check every file before it's stored. Employers' downloads are watermarked with their name.</p>
      <gh-page-state [state]="list" skeleton="table" emptyTitle="No resume yet" emptyText="Upload a resume so you can apply in one tap." emptyIcon="file">
        <div class="stack-sm">
          @for (r of list.data(); track r.id) {
            <div class="card card-tight row" style="flex-wrap:nowrap">
              <gh-icon name="file" [size]="24" class="muted" />
              <div class="grow" style="min-width:0"><div class="row-sm"><strong class="truncate">{{ r.label }}</strong>@if (r.isPrimary) { <span class="badge badge-primary">Primary</span> }</div>
                <span class="caption">{{ r.file.originalName }} · {{ kb(r.file.sizeBytes) }} · uploaded {{ r.createdAt | ghDate }}</span></div>
              <button class="btn btn-ghost btn-sm" type="button" (click)="download(r)"><gh-icon name="download" [size]="14" />Download</button>
              @if (!r.isPrimary) { <button class="btn btn-ghost btn-sm" type="button" (click)="primary(r)">Make primary</button> }
              <button class="btn btn-ghost btn-sm btn-icon" type="button" (click)="remove(r)" aria-label="Delete resume"><gh-icon name="trash" [size]="14" /></button>
            </div>
          }
        </div>
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; } .disabled { opacity: 0.6; pointer-events: none; }`,
})
export class ResumePage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly uploading = signal(false);
  protected readonly list = loader(async () => (await this.api.get<{ resumes: Resume[] }>('/candidate/profile')).resumes, isEmptyArray);
  protected kb = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

  async upload(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploading.set(true);
    try {
      const f = await this.api.upload(file, 'RESUME');
      await this.api.post('/candidate/resumes', { fileId: f.id });
      this.toast.success('Resume uploaded');
      await this.list.reload();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
    }
  }
  download(r: Resume) {
    void this.api.download(`/files/${r.file.id}/download`, r.file.originalName).catch((e) => this.toast.error(e));
  }
  async primary(r: Resume) {
    await this.api.patch(`/candidate/resumes/${r.id}`, { isPrimary: true });
    await this.list.reload();
  }
  async remove(r: Resume) {
    if (!(await this.confirm.confirm({ title: 'Delete this resume?', message: 'Applications you already sent keep the resume you applied with.', confirmText: 'Delete resume', tone: 'danger' }))) return;
    await this.api.delete(`/candidate/resumes/${r.id}`);
    await this.list.reload();
  }
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SecuritySettingsComponent],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <div class="page-header"><div><h1>Settings</h1><p>{{ auth.user()?.email }}</p></div>
        <a class="btn btn-secondary" routerLink="/app/settings/privacy">Privacy settings</a></div>
      <gh-security-settings />
    </div>`,
  styles: `.page-pad { padding-top: 32px; }`,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
}

interface Me {
  visibility: { level: string; openToWork: boolean };
  consents: { purpose: string; granted: boolean; createdAt: string }[];
}

@Component({
  selector: 'app-privacy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageStateComponent, IconComponent, LabelPipe, DatePipe],
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <nav class="breadcrumb"><a routerLink="/app/settings">Settings</a> / Privacy</nav>
      <div class="page-header"><div><h1>Privacy</h1><p>Decide who can find you, and see who has viewed your profile.</p></div></div>
      <gh-page-state [state]="me">
        @if (me.data(); as m) {
          <div class="stack">
            <section class="card stack">
              <div><h3>Profile visibility</h3><p class="secondary">Your phone and email are never shown in search.</p></div>
              <fieldset class="stack-sm" style="border:0;padding:0;margin:0"><legend class="sr-only">Visibility</legend>
                @for (v of levels; track v.value) {
                  <label class="check card card-tight" [class.card-selected]="m.visibility.level === v.value">
                    <input type="radio" name="vis" [value]="v.value" [ngModel]="m.visibility.level" (ngModelChange)="setVisibility($event)" />
                    <span><strong>{{ v.label }}</strong><br /><span class="caption">{{ v.help }}</span></span></label>
                }
              </fieldset>
            </section>

            <section class="card stack">
              <div><h3>Consents</h3><p class="secondary">You can withdraw consent at any time. Each change is recorded.</p></div>
              <label class="check"><input type="checkbox" [ngModel]="consent(m, 'DATABASE_DISCOVERY')" (ngModelChange)="setConsent('DATABASE_DISCOVERY', $event)" />
                <span><strong>Let verified employers discover me</strong><br /><span class="caption">When off, you won't appear in the employer talent search. Applications are unaffected.</span></span></label>
              <label class="check"><input type="checkbox" [ngModel]="consent(m, 'RECRUITER_OUTREACH')" (ngModelChange)="setConsent('RECRUITER_OUTREACH', $event)" />
                <span><strong>GenZHire recruiters may suggest me for roles</strong><br /><span class="caption">Our HR consultants may put you forward for matching hiring requirements.</span></span></label>
              <label class="check"><input type="checkbox" [ngModel]="consent(m, 'MARKETING_EMAIL')" (ngModelChange)="setConsent('MARKETING_EMAIL', $event)" />
                <span><strong>Job tips and product updates by email</strong></span></label>
            </section>

            <section class="card stack">
              <div><h3>Blocked employers</h3><p class="secondary">Blocked companies can't find or open your profile — useful for your current employer.</p></div>
              <div class="row" style="flex-wrap:nowrap">
                <input class="input" [(ngModel)]="q" (ngModelChange)="search($event)" placeholder="Search company name" aria-label="Search company to block" />
              </div>
              @if (found().length) {
                <ul class="list-reset stack-sm">@for (e of found(); track e.id) {
                  <li class="row between"><span>{{ e.name }}</span><button class="btn btn-secondary btn-sm" type="button" (click)="block(e.id)">Block</button></li> }</ul>
              }
              <ul class="list-reset stack-sm">
                @for (b of blocked(); track b.employerId) {
                  <li class="row between"><span><gh-icon name="lock" [size]="14" /> {{ b.employers.name }}</span><button class="btn btn-ghost btn-sm" type="button" (click)="unblock(b.employerId)">Unblock</button></li>
                } @empty { <li class="caption">No blocked employers.</li> }
              </ul>
            </section>

            <section class="card stack">
              <div><h3>Who viewed my profile</h3><p class="secondary">Every company that opened your full profile or downloaded your resume.</p></div>
              <ul class="list-reset">
                @for (v of access(); track $index) {
                  <li class="row between access"><strong>{{ v.company }}</strong><span class="caption">{{ v.action | label }} · {{ v.createdAt | ghDate: true }}</span></li>
                } @empty { <li class="caption">No employer has opened your full profile yet.</li> }
              </ul>
            </section>
          </div>
        }
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; } .access { padding: 10px 0; border-bottom: 1px solid var(--border); }`,
})
export class PrivacyPage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly me = loader(() => this.api.get<Me>('/candidate/profile'));
  protected readonly blocked = signal<{ employerId: string; employers: { name: string } }[]>([]);
  protected readonly access = signal<{ company: string; action: string; createdAt: string }[]>([]);
  protected readonly found = signal<{ id: string; name: string }[]>([]);
  protected q = '';
  private t?: ReturnType<typeof setTimeout>;
  protected readonly levels = [
    { value: 'EMPLOYER_VISIBLE', label: 'Visible to verified employers', help: 'Recommended. You appear in search with a limited preview; employers unlock your full profile.' },
    { value: 'PUBLIC', label: 'Public', help: 'Same as above, plus a shareable profile link (not indexed by search engines).' },
    { value: 'APPLICATION_ONLY', label: 'Only employers I apply to', help: "You won't appear in talent search." },
    { value: 'HIDDEN', label: 'Hidden', help: 'Nobody new can find or unlock your profile. Existing applications are unaffected.' },
  ];

  constructor() {
    void this.loadLists();
  }
  async loadLists() {
    const [b, a] = await Promise.all([
      this.api.get<{ employerId: string; employers: { name: string } }[]>('/candidate/blocked-employers'),
      this.api.get<{ company: string; action: string; createdAt: string }[]>('/candidate/profile-access'),
    ]);
    this.blocked.set(b);
    this.access.set(a);
  }
  protected consent(m: Me, purpose: string) {
    return m.consents.find((c) => c.purpose === purpose)?.granted ?? false;
  }
  async setVisibility(level: string) {
    if (level === 'HIDDEN' && !(await this.confirm.confirm({ title: 'Hide your profile?', message: 'Employers will no longer find you in search, and new unlocks are blocked.', confirmText: 'Hide profile' }))) {
      await this.me.reload();
      return;
    }
    await this.api.put('/candidate/visibility', { level });
    this.toast.success('Visibility updated');
    await this.me.reload();
  }
  async setConsent(purpose: string, granted: boolean) {
    await this.api.post('/candidate/consents', { purpose, granted });
    this.toast.success(granted ? 'Consent given' : 'Consent withdrawn');
    await this.me.reload();
  }
  search(q: string) {
    clearTimeout(this.t);
    this.t = setTimeout(async () => this.found.set(q.trim().length >= 2 ? await this.api.get('/candidate/blocked-employers/search', { q: q.trim() }) : []), 250);
  }
  async block(id: string) {
    await this.api.post('/candidate/blocked-employers', { employerId: id });
    this.found.set([]);
    this.q = '';
    await this.loadLists();
  }
  async unblock(id: string) {
    await this.api.delete(`/candidate/blocked-employers/${id}`);
    await this.loadLists();
  }
}

@Component({
  selector: 'app-legal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container page-pad page-narrow" style="margin:0 auto">
      <h1>{{ title() }}</h1>
      <p class="caption" style="margin:8px 0 24px">Version 2026-09-v1 · SISTECHWORK Private Limited</p>
      <div class="card stack">
        @switch (doc()) {
          @case ('privacy') {
            <p>This summary explains how GenZHire handles your personal data. The complete policy is published by SISTECHWORK Private Limited after legal review.</p>
            <ul class="stack-sm"><li><strong>What we collect:</strong> your name, email, phone, city, education, skills, experience, projects, certifications and resume. We do not collect date of birth, gender, caste, religion or your full address.</li>
              <li><strong>Why:</strong> to run your account, match you with jobs, and — only if you consent — let verified employers discover you.</li>
              <li><strong>Who sees it:</strong> verified employers see a limited preview; contact details are shared only when you apply or accept a request. Every access is logged and shown to you.</li>
              <li><strong>Your rights:</strong> access, correct, withdraw consent, and request deletion from Settings → Privacy, or contact the Grievance Officer.</li></ul>
          }
          @case ('terms') { <p>By using GenZHire you agree to provide accurate information and to use the platform only for genuine job seeking or hiring. Employers must not charge candidates, misuse candidate data, or post misleading jobs. The complete terms are published by SISTECHWORK Private Limited after legal review.</p> }
          @default { <p>For privacy complaints or data requests, contact the Grievance Officer of SISTECHWORK Private Limited. Contact details will be published here before launch.</p> }
        }
      </div>
    </div>`,
  styles: `.page-pad { padding-top: 32px; }`,
})
export class LegalPage {
  readonly doc = input<string>('privacy');
  protected readonly title = computed(() => ({ privacy: 'Privacy policy', terms: 'Terms of use', grievance: 'Grievance officer' })[this.doc() as 'privacy'] ?? 'Legal');
}

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  template: `<div class="empty" style="padding-top:96px"><gh-icon name="search" [size]="48" /><h1>Page not found</h1>
    <p>The page you're looking for doesn't exist or has moved.</p><a class="btn btn-primary" routerLink="/">Go home</a></div>`,
})
export class NotFoundPage {}
