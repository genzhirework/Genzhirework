import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AgoPipe, DatePipe, expRange, LabelPipe, MonthsPipe, salaryRange } from '@gh/core';
import { AvatarComponent } from './bits';
import { IconComponent } from './icon';

export interface JobCardData {
  id: string;
  title: string;
  workMode: string;
  employmentType: string;
  experienceMinMonths: number;
  experienceMaxMonths: number | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryPeriod?: string;
  publishedAt: string | null;
  company: { name: string; slug: string; verified: boolean; logoFileId?: string | null };
  cities: string[];
  skills: string[];
}

@Component({
  selector: 'gh-job-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, AvatarComponent, AgoPipe, LabelPipe],
  template: `
    <article class="card job" [attr.aria-label]="job().title + ' at ' + job().company.name">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
        @if (job().company.logoFileId) {
          <img class="logo" [src]="'/api/v1/files/' + job().company.logoFileId + '/logo'" alt="" width="44" height="44" />
        } @else { <gh-avatar [name]="job().company.name" [seed]="job().company.slug" [size]="44" /> }
        <div class="grow">
          <h3 class="title"><a [routerLink]="['/jobs', job().id]" class="stretched">{{ job().title }}</a></h3>
          <div class="row-sm secondary">
            <span>{{ job().company.name }}</span>
            @if (job().company.verified) { <span class="verified" title="Verified employer"><gh-icon name="shield" [size]="14" />Verified</span> }
          </div>
        </div>
        @if (showSave()) {
          <button class="btn btn-ghost btn-icon save" type="button" (click)="save.emit(job().id)"
                  [attr.aria-pressed]="saved()" [attr.aria-label]="saved() ? 'Remove from saved jobs' : 'Save job'">
            <gh-icon name="bookmark" [class.filled]="saved()" />
          </button>
        }
      </div>
      <div class="meta">
        <span><gh-icon name="pin" [size]="14" />{{ job().cities.join(', ') || 'India' }}</span>
        <span><gh-icon name="briefcase" [size]="14" />{{ job().workMode | label }} · {{ job().employmentType | label }}</span>
        <span><gh-icon name="rupee" [size]="14" />{{ salary() }}</span>
        <span><gh-icon name="graduation" [size]="14" />{{ exp() }}</span>
      </div>
      @if (job().skills.length) {
        <div class="row-sm">@for (s of job().skills.slice(0, 5); track s) { <span class="tag">{{ s }}</span> }</div>
      }
      <div class="caption muted">{{ job().publishedAt | ago }}</div>
    </article>`,
  styles: `
    .job { position: relative; display: flex; flex-direction: column; gap: 12px; transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
    .job:hover { border-color: var(--border-strong); box-shadow: var(--shadow-1); }
    .title { font-size: 1rem; line-height: 1.35; margin-bottom: 2px; }
    .title a { color: var(--text); }
    .stretched::after { content: ''; position: absolute; inset: 0; }
    .save { position: relative; z-index: 1; }
    .filled { color: var(--primary); } .filled ::ng-deep path { fill: currentColor; }
    .logo { width: 44px; height: 44px; border-radius: 10px; object-fit: contain; background: var(--bg-subtle); border: 1px solid var(--border); }
    .verified { display: inline-flex; align-items: center; gap: 4px; color: var(--success); font-size: var(--fs-caption); font-weight: 600; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--text-secondary); font-size: var(--fs-body); }
    .meta span { display: inline-flex; align-items: center; gap: 6px; }`,
})
export class JobCardComponent {
  readonly job = input.required<JobCardData>();
  readonly showSave = input(false);
  readonly saved = input(false);
  readonly save = output<string>();
  protected readonly salary = computed(() => salaryRange(this.job().salaryMinPaise, this.job().salaryMaxPaise, this.job().salaryPeriod));
  protected readonly exp = computed(() => expRange(this.job().experienceMinMonths, this.job().experienceMaxMonths));
}

export interface CandidateCardData {
  candidateId: string;
  displayName: string;
  headline: string | null;
  targetRole: string | null;
  city: string | null;
  highestDegree: string | null;
  specialization: string | null;
  graduationYear: number | null;
  experienceMonths: number;
  availability: string | null;
  profileCompletion: number;
  emailVerified: boolean;
  phoneVerified: boolean;
  skills: string[];
  expectedCtcBand: string | null;
  unlocked?: boolean;
  saved?: boolean;
  applied?: boolean;
}

@Component({
  selector: 'gh-candidate-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, AvatarComponent, LabelPipe, MonthsPipe],
  template: `
    <article class="card card-tight cand" [class.card-selected]="selected()">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <gh-avatar [name]="c().displayName" [seed]="c().candidateId" [size]="44" />
        <div class="grow">
          <div class="row-sm">
            <h3 class="name"><a [routerLink]="link()" class="stretched">{{ c().displayName }}</a></h3>
            @if (c().unlocked) { <span class="badge badge-primary">Unlocked</span> }
            @if (c().applied) { <span class="badge badge-success">Applied to you</span> }
            @if (c().saved) { <span class="badge">Saved</span> }
          </div>
          <p class="secondary truncate">{{ c().headline || c().targetRole || 'Early-career candidate' }}</p>
        </div>
        <ng-content select="[actions]" />
      </div>
      <div class="meta">
        @if (c().highestDegree) { <span><gh-icon name="graduation" [size]="14" />{{ c().highestDegree }}{{ c().specialization ? ' · ' + c().specialization : '' }}{{ c().graduationYear ? ' · ' + c().graduationYear : '' }}</span> }
        @if (c().city) { <span><gh-icon name="pin" [size]="14" />{{ c().city }}</span> }
        <span><gh-icon name="briefcase" [size]="14" />{{ c().experienceMonths | months }}</span>
        @if (c().availability) { <span><gh-icon name="clock" [size]="14" />{{ c().availability | label }}</span> }
        @if (c().expectedCtcBand) { <span><gh-icon name="rupee" [size]="14" />{{ c().expectedCtcBand }}</span> }
      </div>
      <div class="row between">
        <div class="row-sm">@for (s of c().skills; track s) { <span class="tag">{{ s }}</span> }</div>
        <div class="row-sm caption">
          @if (c().emailVerified) { <span class="ok" title="Email verified"><gh-icon name="mail" [size]="13" /></span> }
          @if (c().phoneVerified) { <span class="ok" title="Phone verified"><gh-icon name="phone" [size]="13" /></span> }
          <span>{{ c().profileCompletion }}% complete</span>
        </div>
      </div>
    </article>`,
  styles: `
    .cand { position: relative; display: flex; flex-direction: column; gap: 10px; }
    .cand:hover { border-color: var(--border-strong); }
    .name { font-size: 1rem; } .name a { color: var(--text); }
    .stretched::after { content: ''; position: absolute; inset: 0; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--text-secondary); }
    .meta span { display: inline-flex; align-items: center; gap: 6px; }
    .ok { color: var(--success); display: inline-flex; }
    :host ::ng-deep [actions] { position: relative; z-index: 1; }`,
})
export class CandidateCardComponent {
  readonly c = input.required<CandidateCardData>({ alias: 'candidate' });
  readonly link = input<string | unknown[]>('');
  readonly selected = input(false);
}

/** Renders a candidate profile at LOCKED / FULL / CONTACT level from the API presenter's shape. */
@Component({
  selector: 'gh-candidate-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, IconComponent, LabelPipe, MonthsPipe, DatePipe],
  template: `
    @let p = profile();
    <section class="card head">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
        <gh-avatar [name]="p.displayName" [seed]="p.candidateId" [size]="64" />
        <div class="grow stack-sm">
          <div class="row-sm"><h2>{{ p.displayName }}</h2>
            @if (p.verified?.email) { <span class="badge badge-success"><gh-icon name="mail" [size]="12" />Email verified</span> }
            @if (p.verified?.phone) { <span class="badge badge-success"><gh-icon name="phone" [size]="12" />Phone verified</span> }
          </div>
          <p class="secondary" style="font-size:1rem">{{ p.headline || p.targetRole || 'Early-career candidate' }}</p>
          <div class="meta">
            @if (p.city) { <span><gh-icon name="pin" [size]="14" />{{ p.city }}{{ p.state ? ', ' + p.state : '' }}</span> }
            <span><gh-icon name="briefcase" [size]="14" />{{ p.experienceMonths | months }}</span>
            @if (p.availability) { <span><gh-icon name="clock" [size]="14" />Available: {{ p.availability | label }}</span> }
            @if (p.employmentStatus) { <span><gh-icon name="user" [size]="14" />{{ p.employmentStatus | label }}</span> }
            @if (level() !== 'LOCKED' && p.expectedCtc?.minPaise) { <span><gh-icon name="rupee" [size]="14" />Expects {{ lpa(p.expectedCtc.minPaise) }}{{ p.expectedCtc.maxPaise ? '–' + lpa(p.expectedCtc.maxPaise) : '' }}</span> }
            @else if (p.expectedCtcBand) { <span><gh-icon name="rupee" [size]="14" />{{ p.expectedCtcBand }}</span> }
          </div>
          @if (p.contact) {
            <div class="row contact">
              <a [href]="'mailto:' + p.contact.email"><gh-icon name="mail" [size]="14" />{{ p.contact.email }}</a>
              @if (p.contact.phone) { <span><gh-icon name="phone" [size]="14" />{{ p.contact.phone }}</span> }
            </div>
          }
        </div>
        <ng-content select="[head-actions]" />
      </div>
    </section>

    <div class="cols">
      <div class="stack">
        @if (level() === 'LOCKED') {
          <section class="card lock-panel stack-sm">
            <gh-icon name="lock" [size]="28" />
            <h3>Full profile is locked</h3>
            <p class="secondary">Summary{{ p.sections?.experience ? ', ' + p.sections.experience + ' experience' : '' }}{{ p.sections?.projects ? ', ' + p.sections.projects + ' project(s)' : '' }}{{ p.sections?.certifications ? ', ' + p.sections.certifications + ' certification(s)' : '' }}{{ p.sections?.resume ? ' and resume' : '' }} are available after unlocking.</p>
            <ng-content select="[unlock]" />
          </section>
        } @else {
          @if (p.summary) { <section class="card"><h3 class="mb">Summary</h3><p class="pre-line">{{ p.summary }}</p></section> }
          @if (p.experience?.length) {
            <section class="card"><h3 class="mb">Experience</h3>
              <ul class="list-reset stack">
                @for (x of p.experience; track x.id) {
                  <li><strong>{{ x.title }}</strong> · {{ x.companyName }} <span class="badge">{{ x.employmentType | label }}</span>
                    <div class="caption">{{ x.startDate | ghDate }} – {{ x.isCurrent ? 'Present' : (x.endDate | ghDate) }}{{ x.location ? ' · ' + x.location : '' }}</div>
                    @if (x.description) { <p class="pre-line secondary" style="margin-top:4px">{{ x.description }}</p> }</li>
                }
              </ul>
            </section>
          }
          @if (p.projects?.length) {
            <section class="card"><h3 class="mb">Projects</h3>
              <ul class="list-reset stack">
                @for (x of p.projects; track x.id) {
                  <li><strong>{{ x.title }}</strong>{{ x.role ? ' · ' + x.role : '' }}
                    @if (x.description) { <p class="pre-line secondary" style="margin-top:4px">{{ x.description }}</p> }
                    <div class="row-sm" style="margin-top:4px">
                      @if (x.projectUrl) { <a [href]="x.projectUrl" target="_blank" rel="noopener noreferrer">Live <gh-icon name="external" [size]="12" /></a> }
                      @if (x.repoUrl) { <a [href]="x.repoUrl" target="_blank" rel="noopener noreferrer">Code <gh-icon name="external" [size]="12" /></a> }
                    </div></li>
                }
              </ul>
            </section>
          }
        }
        <section class="card"><h3 class="mb">Education</h3>
          @if (level() === 'LOCKED') {
            <p><strong>{{ p.education?.degree || (p.education?.level | label) }}</strong>{{ p.education?.specialization ? ' · ' + p.education.specialization : '' }}</p>
            <p class="secondary">{{ p.institution }}{{ p.education?.graduationYear ? ' · ' + p.education.graduationYear : '' }}</p>
          } @else {
            <ul class="list-reset stack">
              @for (e of p.educationHistory; track e.id) {
                <li><strong>{{ e.degree || (e.level | label) }}</strong>{{ e.specialization ? ' · ' + e.specialization : '' }}
                  <div class="secondary">{{ e.institution }}{{ e.graduationYear ? ' · ' + (e.isPursuing ? 'Graduating ' : '') + e.graduationYear : '' }}{{ e.score ? ' · ' + e.score + ' ' + (e.scoreType | label) : '' }}</div></li>
              } @empty { <li class="muted">No education added.</li> }
            </ul>
          }
        </section>
      </div>
      <aside class="stack">
        <section class="card"><h3 class="mb">Skills</h3>
          <div class="row-sm">
            @for (s of skillNames(); track s) { <span class="tag">{{ s }}</span> } @empty { <span class="muted">No skills added.</span> }
          </div>
        </section>
        @if (level() !== 'LOCKED') {
          @if (p.certifications?.length) {
            <section class="card"><h3 class="mb">Certifications</h3>
              <ul class="list-reset stack-sm">
                @for (x of p.certifications; track x.id) {
                  <li><strong>{{ x.name }}</strong><div class="caption">{{ x.issuer }}{{ x.issueDate ? ' · ' + (x.issueDate | ghDate) : '' }}</div>
                    @if (x.credentialUrl) { <a class="caption" [href]="x.credentialUrl" target="_blank" rel="noopener noreferrer">Verify credential</a> }</li>
                }
              </ul>
            </section>
          }
          @if (p.links?.length) {
            <section class="card"><h3 class="mb">Links</h3>
              <ul class="list-reset stack-sm">
                @for (l of p.links; track l.url) { <li><a [href]="l.url" target="_blank" rel="noopener noreferrer">{{ l.type | label }} <gh-icon name="external" [size]="12" /></a></li> }
              </ul>
            </section>
          }
          @if (p.preferences) {
            <section class="card"><h3 class="mb">Preferences</h3>
              <dl class="kv" style="grid-template-columns:110px 1fr">
                <dt>Work mode</dt><dd>{{ (p.preferences.workModes | label) || '—' }}</dd>
                <dt>Locations</dt><dd>{{ p.preferences.cities.join(', ') || '—' }}</dd>
              </dl>
            </section>
          }
        }
        <ng-content select="[aside]" />
      </aside>
    </div>`,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--text-secondary); }
    .meta span, .contact a, .contact span { display: inline-flex; align-items: center; gap: 6px; }
    .contact { margin-top: 4px; padding: 8px 12px; background: var(--success-tint); border-radius: var(--radius-sm); }
    .cols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .mb { margin-bottom: 12px; }
    @media (max-width: 1023px) { .cols { grid-template-columns: minmax(0, 1fr); } }`,
})
export class CandidateProfileComponent {
  // Shape is the backend presenter's output (docs/06-business-rules.md §1.2); loosely typed on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly profile = input.required<any>();
  readonly level = input<'LOCKED' | 'FULL' | 'CONTACT'>('FULL');
  protected readonly skillNames = computed(() =>
    (this.profile().skills ?? []).map((s: string | { name: string }) => (typeof s === 'string' ? s : s.name)),
  );
  protected lpa(p: number) {
    const v = p / 100 / 100000;
    return `${Number.isInteger(v) ? v : v.toFixed(1)} LPA`;
  }
}

@Component({
  selector: 'gh-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <ol class="timeline">
      @for (i of items(); track $index) {
        <li class="done"><strong>{{ i.label }}</strong>
          @if (i.note) { <div class="secondary">{{ i.note }}</div> }
          <div class="caption">{{ i.at | ghDate: true }}{{ i.by ? ' · ' + i.by : '' }}</div></li>
      }
    </ol>`,
})
export class TimelineComponent {
  readonly items = input<{ label: string; at: string; note?: string | null; by?: string | null }[]>([]);
}
