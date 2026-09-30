import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, ApiError, DatePipe, LabelPipe, loader, lpaToPaise, MonthsPipe, OPTIONS, paiseToLpa } from '@gh/core';
import {
  CandidateCardComponent, CandidateProfileComponent, ConfirmService, IconComponent, ModalComponent, PageStateComponent, Skill,
  SkillPickerComponent, TagInputComponent, ToastService,
} from '@gh/ui';

type Section = 'basic' | 'about' | 'education' | 'experience' | 'projects' | 'certifications' | 'links' | 'preferences';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
interface Me {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  onboardingCompleted: boolean;
  profile: Row;
  education: Row[];
  experience: Row[];
  projects: Row[];
  certifications: Row[];
  skills: Skill[];
  completion: { percent: number; missing: string[] };
}

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, RouterLink, PageStateComponent, IconComponent, ModalComponent, SkillPickerComponent, TagInputComponent, LabelPipe,
    MonthsPipe, DatePipe,
  ],
  template: `
    <div class="container page-pad">
      <gh-page-state [state]="me">
        @if (me.data(); as m) {
          <div class="page-header">
            <div><h1>{{ m.firstName }} {{ m.lastName }}</h1><p>{{ m.profile['headline'] || 'Add a headline so employers know what you do' }}</p></div>
            <a class="btn btn-secondary" routerLink="/app/profile/preview"><gh-icon name="eye" [size]="16" />Preview as employer</a>
          </div>
          <div class="layout">
            <div class="stack">
              <section class="card">
                <div class="card-header"><h3>Basic information</h3><button class="btn btn-ghost btn-sm" (click)="edit('basic')"><gh-icon name="edit" [size]="14" />Edit</button></div>
                <dl class="kv"><dt>Name</dt><dd>{{ m.firstName }} {{ m.lastName }}</dd><dt>Email</dt><dd>{{ m.email }}</dd>
                  <dt>Phone</dt><dd>{{ m.phone || '—' }} <span class="caption">(private — shared only when you apply or accept a request)</span></dd>
                  <dt>Location</dt><dd>{{ m.city || '—' }}{{ m.state ? ', ' + m.state : '' }}</dd></dl>
              </section>

              <section class="card">
                <div class="card-header"><h3>Professional summary</h3><button class="btn btn-ghost btn-sm" (click)="edit('about')"><gh-icon name="edit" [size]="14" />Edit</button></div>
                <dl class="kv"><dt>Target role</dt><dd>{{ m.profile['targetRole'] || '—' }}</dd><dt>Status</dt><dd>{{ m.profile['employmentStatus'] | label }}</dd>
                  <dt>Experience</dt><dd>{{ m.profile['totalExperienceMonths'] | months }}</dd>
                  <dt>Expected CTC</dt><dd>{{ ctc(m) }}</dd></dl>
                @if (m.profile['summary']) { <p class="pre-line secondary" style="margin-top:12px">{{ m.profile['summary'] }}</p> }
              </section>

              <section class="card">
                <div class="card-header"><h3>Education</h3><button class="btn btn-ghost btn-sm" (click)="edit('education')"><gh-icon name="plus" [size]="14" />Add</button></div>
                <ul class="list-reset items">
                  @for (e of m.education; track e['id']) {
                    <li><div class="grow"><strong>{{ e['degree'] || (e['level'] | label) }}</strong>{{ e['specialization'] ? ' · ' + e['specialization'] : '' }}
                      <div class="caption">{{ e['institution'] }}{{ e['graduationYear'] ? ' · ' + e['graduationYear'] : '' }}{{ e['score'] ? ' · ' + e['score'] + ' ' + (e['scoreType'] | label) : '' }}</div></div>
                      <button class="btn btn-ghost btn-sm btn-icon" (click)="edit('education', e)" aria-label="Edit education"><gh-icon name="edit" [size]="14" /></button>
                      <button class="btn btn-ghost btn-sm btn-icon" (click)="remove('education', e)" aria-label="Delete education"><gh-icon name="trash" [size]="14" /></button></li>
                  } @empty { <li class="muted">Add your college or school.</li> }
                </ul>
              </section>

              <section class="card">
                <div class="card-header"><h3>Skills</h3>@if (skillsDirty()) { <button class="btn btn-primary btn-sm" (click)="saveSkills()">Save skills</button> }</div>
                <gh-skill-picker [value]="skills()" (valueChange)="skills.set($event); skillsDirty.set(true)" [max]="30" />
              </section>

              @for (sec of lists; track sec.key) {
                <section class="card">
                  <div class="card-header"><h3>{{ sec.title }}</h3><button class="btn btn-ghost btn-sm" (click)="edit(sec.key)"><gh-icon name="plus" [size]="14" />Add</button></div>
                  <ul class="list-reset items">
                    @for (x of $any(m)[sec.key]; track x['id']) {
                      <li><div class="grow">
                        @switch (sec.key) {
                          @case ('experience') { <strong>{{ x['title'] }}</strong> · {{ x['companyName'] }}<div class="caption">{{ x['employmentType'] | label }} · {{ x['startDate'] | ghDate }} – {{ x['isCurrent'] ? 'Present' : (x['endDate'] | ghDate) }}</div> }
                          @case ('projects') { <strong>{{ x['title'] }}</strong><div class="caption truncate">{{ x['description'] }}</div> }
                          @case ('certifications') { <strong>{{ x['name'] }}</strong><div class="caption">{{ x['issuer'] }}{{ x['issueDate'] ? ' · ' + (x['issueDate'] | ghDate) : '' }}</div> }
                        }</div>
                        <button class="btn btn-ghost btn-sm btn-icon" (click)="edit(sec.key, x)" [attr.aria-label]="'Edit ' + sec.single"><gh-icon name="edit" [size]="14" /></button>
                        <button class="btn btn-ghost btn-sm btn-icon" (click)="remove(sec.key, x)" [attr.aria-label]="'Delete ' + sec.single"><gh-icon name="trash" [size]="14" /></button></li>
                    } @empty { <li class="muted">{{ sec.empty }}</li> }
                  </ul>
                </section>
              }

              <section class="card">
                <div class="card-header"><h3>Links</h3><button class="btn btn-ghost btn-sm" (click)="edit('links')"><gh-icon name="edit" [size]="14" />Edit</button></div>
                <ul class="list-reset stack-sm">@for (l of m.profile['links']; track l.url) { <li><span class="tag">{{ l.type | label }}</span>&ngsp;<a [href]="l.url" target="_blank" rel="noopener noreferrer">{{ l.url }}</a></li> }
                  @empty { <li class="muted">Add LinkedIn, GitHub or a portfolio.</li> }</ul>
              </section>

              <section class="card">
                <div class="card-header"><h3>Job preferences</h3><button class="btn btn-ghost btn-sm" (click)="edit('preferences')"><gh-icon name="edit" [size]="14" />Edit</button></div>
                <dl class="kv"><dt>Work mode</dt><dd>{{ (m.profile['preferredWorkModes'] | label) || '—' }}</dd>
                  <dt>Cities</dt><dd>{{ m.profile['preferredCities'].join(', ') || '—' }}</dd>
                  <dt>Job types</dt><dd>{{ (m.profile['preferredEmploymentTypes'] | label) || '—' }}</dd>
                  <dt>Availability</dt><dd>{{ m.profile['availability'] | label }}</dd></dl>
              </section>
            </div>

            <aside class="stack side">
              <section class="card stack-sm">
                <h3>{{ m.completion.percent }}% complete</h3>
                <div class="progress"><span [style.width.%]="m.completion.percent"></span></div>
                @if (m.completion.percent < 40) {
                  <div class="alert alert-warning" role="status"><span>Employers can't find you in talent search until your profile is at least <strong>40% complete</strong>. You can still apply to jobs.</span></div>
                }
                @if (m.completion.missing.length) {
                  <p class="caption">To get found by more employers:</p>
                  <ul class="missing">@for (x of m.completion.missing; track x) { <li>{{ x }}</li> }</ul>
                }
              </section>
              <section class="card stack-sm"><h4>Resume</h4><p class="caption">Employers download your primary resume.</p>
                <a class="btn btn-secondary btn-sm" routerLink="/app/resume" style="align-self:flex-start">Manage resumes</a></section>
              <section class="card stack-sm"><h4>Who can see this?</h4><p class="caption">Verified employers see a limited preview until they unlock your full profile. Control this in Privacy.</p>
                <a class="btn btn-secondary btn-sm" routerLink="/app/settings/privacy" style="align-self:flex-start">Privacy settings</a></section>
            </aside>
          </div>

          <gh-modal [open]="!!editing()" [title]="modalTitle()" (closed)="editing.set(null)" [size]="editing() === 'about' ? 'lg' : 'md'">
            @if (formError()) { <div class="alert alert-danger" style="margin-bottom:12px" role="alert">{{ formError() }}</div> }
            @switch (editing()) {
              @case ('basic') {
                <div class="form-grid">
                  <div class="field"><label for="f1" class="req">First name</label><input id="f1" class="input" [(ngModel)]="d['firstName']" maxlength="60" /></div>
                  <div class="field"><label for="f2" class="req">Last name</label><input id="f2" class="input" [(ngModel)]="d['lastName']" maxlength="60" /></div>
                  <div class="field span-2"><label for="f3">Mobile number</label><input id="f3" class="input" [(ngModel)]="d['phone']" placeholder="+919876543210" inputmode="tel" /></div>
                  <div class="field"><label for="f4">City</label><input id="f4" class="input" [(ngModel)]="d['city']" list="p-cities" />
                    <datalist id="p-cities">@for (c of opts.cities; track c) { <option [value]="c"></option> }</datalist></div>
                  <div class="field"><label for="f5">State</label><select id="f5" class="select" [(ngModel)]="d['state']"><option value="">Select</option>@for (s of opts.states; track s) { <option [value]="s">{{ s }}</option> }</select></div>
                </div>
              }
              @case ('about') {
                <div class="form-grid">
                  <div class="field span-2"><label for="a1">Headline</label><input id="a1" class="input" [(ngModel)]="d['headline']" maxlength="140" placeholder="e.g. Aspiring Data Analyst | Python · SQL · Power BI" /></div>
                  <div class="field"><label for="a2">Target role</label><input id="a2" class="input" [(ngModel)]="d['targetRole']" maxlength="100" /></div>
                  <div class="field"><label for="a3">Current job title</label><input id="a3" class="input" [(ngModel)]="d['currentJobTitle']" maxlength="100" placeholder="If employed / interning" /></div>
                  <div class="field"><label for="a4">Status</label><select id="a4" class="select" [(ngModel)]="d['employmentStatus']">@for (s of opts.employmentStatus; track s) { <option [value]="s">{{ s | label }}</option> }</select></div>
                  <div class="field"><label for="a5">Total experience (months)</label><input id="a5" class="input" type="number" min="0" max="600" [(ngModel)]="d['totalExperienceMonths']" /><span class="hint">Include internships.</span></div>
                  <div class="field"><label for="a6">Expected CTC — min (LPA)</label><input id="a6" class="input" type="number" min="0" step="0.5" [(ngModel)]="d['ctcMin']" /></div>
                  <div class="field"><label for="a7">Expected CTC — max (LPA)</label><input id="a7" class="input" type="number" min="0" step="0.5" [(ngModel)]="d['ctcMax']" /></div>
                  <div class="field span-2"><label for="a8">Summary</label><textarea id="a8" class="textarea" rows="6" [(ngModel)]="d['summary']" maxlength="2000"
                    placeholder="2–4 sentences: what you studied, what you've built, and what you want to do next."></textarea><span class="hint">{{ (d['summary'] || '').length }}/2000 · 150+ characters recommended</span></div>
                </div>
              }
              @case ('education') {
                <div class="form-grid">
                  <div class="field"><label for="e1" class="req">Level</label><select id="e1" class="select" [(ngModel)]="d['level']">@for (l of opts.educationLevel; track l) { <option [value]="l">{{ l | label }}</option> }</select></div>
                  <div class="field"><label for="e2">Degree</label><input id="e2" class="input" [(ngModel)]="d['degree']" maxlength="80" placeholder="B.Tech, B.Com…" /></div>
                  <div class="field span-2"><label for="e3">Specialization</label><input id="e3" class="input" [(ngModel)]="d['specialization']" maxlength="120" /></div>
                  <div class="field span-2"><label for="e4" class="req">Institution</label><input id="e4" class="input" [(ngModel)]="d['institution']" maxlength="160" /></div>
                  <div class="field"><label for="e5">University / board</label><input id="e5" class="input" [(ngModel)]="d['universityBoard']" maxlength="160" /></div>
                  <div class="field"><label for="e6">Graduation year</label><input id="e6" class="input" type="number" [(ngModel)]="d['graduationYear']" /></div>
                  <div class="field"><label for="e7">Score type</label><select id="e7" class="select" [(ngModel)]="d['scoreType']"><option [ngValue]="null">—</option><option value="CGPA_10">CGPA (10)</option><option value="CGPA_4">CGPA (4)</option><option value="PERCENTAGE">Percentage</option></select></div>
                  <div class="field"><label for="e8">Score</label><input id="e8" class="input" type="number" step="0.01" [(ngModel)]="d['score']" /></div>
                  <label class="check span-2"><input type="checkbox" [(ngModel)]="d['isPursuing']" />Currently studying here</label>
                </div>
              }
              @case ('experience') {
                <div class="form-grid">
                  <div class="field"><label for="x1" class="req">Title</label><input id="x1" class="input" [(ngModel)]="d['title']" maxlength="120" /></div>
                  <div class="field"><label for="x2" class="req">Company</label><input id="x2" class="input" [(ngModel)]="d['companyName']" maxlength="120" /></div>
                  <div class="field"><label for="x3">Type</label><select id="x3" class="select" [(ngModel)]="d['employmentType']">@for (t of expTypes; track t) { <option [value]="t">{{ t | label }}</option> }</select></div>
                  <div class="field"><label for="x4">Location</label><input id="x4" class="input" [(ngModel)]="d['location']" maxlength="80" /></div>
                  <div class="field"><label for="x5" class="req">Start date</label><input id="x5" class="input" type="date" [(ngModel)]="d['startDate']" /></div>
                  <div class="field"><label for="x6">End date</label><input id="x6" class="input" type="date" [(ngModel)]="d['endDate']" [disabled]="d['isCurrent']" /></div>
                  <label class="check span-2"><input type="checkbox" [(ngModel)]="d['isCurrent']" />I currently work here</label>
                  <div class="field span-2"><label for="x7">What did you do?</label><textarea id="x7" class="textarea" [(ngModel)]="d['description']" maxlength="2000"></textarea></div>
                </div>
              }
              @case ('projects') {
                <div class="form-grid">
                  <div class="field span-2"><label for="p1" class="req">Project title</label><input id="p1" class="input" [(ngModel)]="d['title']" maxlength="120" /></div>
                  <div class="field span-2"><label for="p2">Your role</label><input id="p2" class="input" [(ngModel)]="d['role']" maxlength="80" /></div>
                  <div class="field span-2"><label for="p3">Description</label><textarea id="p3" class="textarea" [(ngModel)]="d['description']" maxlength="2000" placeholder="Problem, what you built, tools used, result."></textarea></div>
                  <div class="field"><label for="p4">Live URL</label><input id="p4" class="input" type="url" [(ngModel)]="d['projectUrl']" placeholder="https://" /></div>
                  <div class="field"><label for="p5">Code URL</label><input id="p5" class="input" type="url" [(ngModel)]="d['repoUrl']" placeholder="https://github.com/…" /></div>
                </div>
              }
              @case ('certifications') {
                <div class="form-grid">
                  <div class="field span-2"><label for="c1" class="req">Certification</label><input id="c1" class="input" [(ngModel)]="d['name']" maxlength="160" /></div>
                  <div class="field"><label for="c2" class="req">Issuer</label><input id="c2" class="input" [(ngModel)]="d['issuer']" maxlength="120" /></div>
                  <div class="field"><label for="c3">Issue date</label><input id="c3" class="input" type="date" [(ngModel)]="d['issueDate']" /></div>
                  <div class="field"><label for="c4">Credential ID</label><input id="c4" class="input" [(ngModel)]="d['credentialId']" maxlength="80" /></div>
                  <div class="field"><label for="c5">Credential URL</label><input id="c5" class="input" type="url" [(ngModel)]="d['credentialUrl']" placeholder="https://" /></div>
                </div>
              }
              @case ('links') {
                <div class="stack">
                  @for (l of d['links']; track $index; let i = $index) {
                    <div class="row" style="flex-wrap:nowrap">
                      <select class="select" style="width:150px" [(ngModel)]="l.type" [attr.aria-label]="'Link ' + (i + 1) + ' type'"><option value="LINKEDIN">LinkedIn</option><option value="GITHUB">GitHub</option><option value="PORTFOLIO">Portfolio</option><option value="OTHER">Other</option></select>
                      <input class="input" type="url" [(ngModel)]="l.url" placeholder="https://" [attr.aria-label]="'Link ' + (i + 1) + ' URL'" />
                      <button class="btn btn-ghost btn-icon" type="button" (click)="d['links'].splice(i, 1)" aria-label="Remove link"><gh-icon name="trash" [size]="14" /></button>
                    </div>
                  }
                  @if (d['links'].length < 6) { <button class="btn btn-secondary btn-sm" type="button" style="align-self:flex-start" (click)="d['links'].push({ type: 'LINKEDIN', url: '' })"><gh-icon name="plus" [size]="14" />Add link</button> }
                </div>
              }
              @case ('preferences') {
                <div class="stack">
                  <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">Work mode</legend>
                    <div class="row-sm">@for (w of opts.workMode; track w) { <button type="button" class="chip" [attr.aria-pressed]="d['preferredWorkModes'].includes(w)" (click)="toggle('preferredWorkModes', w)">{{ w | label }}</button> }</div></fieldset>
                  <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label">Job types</legend>
                    <div class="row-sm">@for (w of opts.employmentType; track w) { <button type="button" class="chip" [attr.aria-pressed]="d['preferredEmploymentTypes'].includes(w)" (click)="toggle('preferredEmploymentTypes', w)">{{ w | label }}</button> }</div></fieldset>
                  <div class="field"><label for="pc">Preferred cities</label><gh-tag-input inputId="pc" [(value)]="d['preferredCities']" [suggestions]="opts.cities" placeholder="Add a city" /></div>
                  <div class="field"><label for="pa">Availability</label><select id="pa" class="select" [(ngModel)]="d['availability']">@for (a of opts.availability; track a) { <option [value]="a">{{ a | label }}</option> }</select></div>
                </div>
              }
            }
            <ng-container footer>
              <button class="btn btn-secondary" type="button" (click)="editing.set(null)">Cancel</button>
              <button class="btn btn-primary" type="button" [disabled]="saving()" (click)="save()">@if (saving()) { <span class="spinner"></span> } Save</button>
            </ng-container>
          </gh-modal>
        }
      </gh-page-state>
    </div>`,
  styles: `
    .page-pad { padding-top: 32px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .side { position: sticky; top: 80px; }
    .items li { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-top: 1px solid var(--border); }
    .items li:first-child { border-top: 0; }
    .missing { color: var(--text-secondary); padding-left: 1.1em; display: flex; flex-direction: column; gap: 4px; }
    @media (max-width: 1023px) { .layout { grid-template-columns: minmax(0, 1fr); } .side { position: static; } }`,
})
export class ProfilePage {
  private readonly api = inject(Api);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly opts = OPTIONS;
  protected readonly expTypes = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'APPRENTICESHIP', 'FREELANCE', 'CONTRACT'];
  protected readonly lists = [
    { key: 'experience' as const, title: 'Experience & internships', single: 'experience', empty: 'Internships count — add them here.' },
    { key: 'projects' as const, title: 'Projects', single: 'project', empty: 'Projects show employers what you can build.' },
    { key: 'certifications' as const, title: 'Certifications', single: 'certification', empty: 'Add courses and certifications.' },
  ];
  protected readonly me = loader(async () => {
    const m = await this.api.get<Me>('/candidate/profile');
    this.skills.set(m.skills);
    this.skillsDirty.set(false);
    return m;
  });
  protected readonly skills = signal<Skill[]>([]);
  protected readonly skillsDirty = signal(false);
  protected readonly editing = signal<Section | null>(null);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected d: Row = {};
  private editingId: string | null = null;
  protected readonly modalTitle = computed(() => {
    const e = this.editing();
    const titles: Record<Section, string> = {
      basic: 'Basic information', about: 'Professional summary', education: 'Education', experience: 'Experience',
      projects: 'Project', certifications: 'Certification', links: 'Links', preferences: 'Job preferences',
    };
    if (!e) return '';
    if (this.editingId) return `Edit ${titles[e].toLowerCase()}`;
    return ['education', 'experience', 'projects', 'certifications'].includes(e) ? `Add ${titles[e].toLowerCase()}` : titles[e];
  });

  protected ctc(m: Me) {
    const a = paiseToLpa(m.profile['expectedCtcMinPaise']), b = paiseToLpa(m.profile['expectedCtcMaxPaise']);
    return a ? `${a}${b && b !== a ? '–' + b : ''} LPA` : '—';
  }

  edit(section: Section, row?: Row) {
    const m = this.me.data()!;
    const p = m.profile;
    this.formError.set(null);
    this.editingId = row?.['id'] ?? null;
    const date = (v: string | null) => (v ? String(v).slice(0, 10) : '');
    const drafts: Record<Section, () => Row> = {
      basic: () => ({ firstName: m.firstName, lastName: m.lastName, phone: m.phone ?? '', city: m.city ?? '', state: m.state ?? '' }),
      about: () => ({
        headline: p['headline'] ?? '', targetRole: p['targetRole'] ?? '', currentJobTitle: p['currentJobTitle'] ?? '',
        employmentStatus: p['employmentStatus'] ?? 'FRESHER', totalExperienceMonths: p['totalExperienceMonths'] ?? 0,
        ctcMin: paiseToLpa(p['expectedCtcMinPaise']), ctcMax: paiseToLpa(p['expectedCtcMaxPaise']), summary: p['summary'] ?? '',
      }),
      education: () => row ? { ...row } : { level: 'UG', degree: '', specialization: '', institution: '', universityBoard: '', graduationYear: null, scoreType: null, score: null, isPursuing: false },
      experience: () => row ? { ...row, startDate: date(row['startDate']), endDate: date(row['endDate']) } : { title: '', companyName: '', employmentType: 'INTERNSHIP', location: '', startDate: '', endDate: '', isCurrent: false, description: '' },
      projects: () => row ? { ...row } : { title: '', role: '', description: '', projectUrl: '', repoUrl: '' },
      certifications: () => row ? { ...row, issueDate: date(row['issueDate']) } : { name: '', issuer: '', issueDate: '', credentialId: '', credentialUrl: '' },
      links: () => ({ links: (p['links'] ?? []).map((l: Row) => ({ ...l })) }),
      preferences: () => ({
        preferredWorkModes: [...(p['preferredWorkModes'] ?? [])], preferredEmploymentTypes: [...(p['preferredEmploymentTypes'] ?? [])],
        preferredCities: [...(p['preferredCities'] ?? [])], availability: p['availability'] ?? 'IMMEDIATE',
      }),
    };
    this.d = drafts[section]();
    this.editing.set(section);
  }

  toggle(key: string, v: string) {
    const arr: string[] = this.d[key];
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(v);
  }

  private clean(o: Row) {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  }

  async save() {
    const s = this.editing()!;
    const d = this.d;
    this.saving.set(true);
    this.formError.set(null);
    try {
      if (s === 'basic') await this.api.patch('/candidate/profile', this.clean({ firstName: d['firstName'], lastName: d['lastName'], phone: d['phone']?.replace(/\s/g, ''), city: d['city'], state: d['state'] }));
      else if (s === 'about') {
        await this.api.patch('/candidate/profile', {
          headline: d['headline'], targetRole: d['targetRole'], currentJobTitle: d['currentJobTitle'], employmentStatus: d['employmentStatus'],
          totalExperienceMonths: Number(d['totalExperienceMonths']) || 0, summary: d['summary'],
          ...(d['ctcMin'] ? { expectedCtcMinPaise: lpaToPaise(d['ctcMin']) } : {}), ...(d['ctcMax'] ? { expectedCtcMaxPaise: lpaToPaise(d['ctcMax']) } : {}),
        });
      } else if (s === 'links') {
        await this.api.patch('/candidate/profile', { links: d['links'].filter((l: Row) => l['url']?.trim()).map((l: Row) => ({ type: l['type'], url: l['url'].trim() })) });
      } else if (s === 'preferences') {
        await this.api.patch('/candidate/profile', d);
      } else {
        const pick: Record<string, string[]> = {
          education: ['level', 'degree', 'specialization', 'institution', 'universityBoard', 'graduationYear', 'isPursuing', 'scoreType', 'score'],
          experience: ['companyName', 'title', 'employmentType', 'location', 'startDate', 'endDate', 'isCurrent', 'description'],
          projects: ['title', 'description', 'role', 'projectUrl', 'repoUrl'],
          certifications: ['name', 'issuer', 'issueDate', 'credentialId', 'credentialUrl'],
        };
        const body = this.clean(Object.fromEntries(pick[s].map((k) => [k, d[k]])));
        for (const n of ['graduationYear', 'score']) if (body[n] !== undefined) body[n] = Number(body[n]);
        if (this.editingId) await this.api.patch(`/candidate/${s}/${this.editingId}`, body);
        else await this.api.post(`/candidate/${s}`, body);
      }
      this.editing.set(null);
      this.toast.success('Profile updated');
      await this.me.reload();
    } catch (e) {
      const err = ApiError.from(e);
      this.formError.set(err.errors.length ? err.errors.map((x) => x.message).join('. ') : err.message);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(section: Section, row: Row) {
    const ok = await this.confirm.confirm({ title: 'Delete this entry?', message: 'It will be removed from your profile.', confirmText: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      await this.api.delete(`/candidate/${section}/${row['id']}`);
      await this.me.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async saveSkills() {
    try {
      await this.api.put('/candidate/skills', { skills: this.skills().map((s) => ({ skillId: s.id })) });
      this.toast.success('Skills saved');
      await this.me.reload();
    } catch (e) {
      this.toast.error(e);
    }
  }
}

@Component({
  selector: 'app-profile-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageStateComponent, CandidateProfileComponent, CandidateCardComponent],
  template: `
    <div class="container page-pad">
      <nav class="breadcrumb"><a routerLink="/app/profile">Profile</a> / Preview</nav>
      <div class="page-header"><div><h1>Preview as employer</h1><p>Exactly what employers receive at each stage — generated by the same code that serves them.</p></div></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">
        <button class="tab" role="tab" [attr.aria-selected]="view() === 'CARD'" (click)="set('CARD')">Search result</button>
        <button class="tab" role="tab" [attr.aria-selected]="view() === 'LOCKED'" (click)="set('LOCKED')">Before unlock</button>
        <button class="tab" role="tab" [attr.aria-selected]="view() === 'FULL'" (click)="set('FULL')">After unlock</button>
      </div>
      <gh-page-state [state]="preview">
        @if (preview.data(); as p) {
          @if (view() === 'CARD') {
            <div style="max-width:720px"><gh-candidate-card [candidate]="card(p)" /></div>
            <p class="caption" style="margin-top:12px">Your surname, contact details and full profile are hidden in search results.</p>
          } @else {
            <gh-candidate-profile [profile]="p" [level]="view() === 'LOCKED' ? 'LOCKED' : 'FULL'" />
          }
        }
      </gh-page-state>
    </div>`,
  styles: `.page-pad { padding-top: 32px; }`,
})
export class ProfilePreviewPage {
  private readonly api = inject(Api);
  protected readonly view = signal<'CARD' | 'LOCKED' | 'FULL'>('CARD');
  protected readonly preview = loader(() => this.api.get<Row>('/candidate/profile/preview', { as: this.view() }));
  set(v: 'CARD' | 'LOCKED' | 'FULL') {
    this.view.set(v);
    void this.preview.reload();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected card(p: Row): any {
    return {
      ...p, highestDegree: p['education']?.degree, specialization: p['education']?.specialization, graduationYear: p['education']?.graduationYear,
      emailVerified: p['verified']?.email, phoneVerified: p['verified']?.phone,
    };
  }
}

