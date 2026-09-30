import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, appUrl, OPTIONS } from '@gh/core';
import { IconComponent, JobCardComponent, JobCardData } from '@gh/ui';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, IconComponent, JobCardComponent],
  template: `
    <section class="theme-brand hero">
      <div class="hero-grid" aria-hidden="true"></div>
      <div class="container hero-inner">
        <span class="badge badge-primary">Built for freshers and early-career talent</span>
        <h1 class="display">Find Your Next Opportunity.</h1>
        <p class="lead">Discover jobs, build your professional profile and connect with employers looking for emerging talent.</p>
        <form class="search" role="search" (ngSubmit)="search()">
          <label class="sr-only" for="hq">Job title, skill or company</label>
          <div class="search-field"><gh-icon name="search" /><input id="hq" name="q" [(ngModel)]="q" placeholder="Job title, skill or company" autocomplete="off" /></div>
          <label class="sr-only" for="hc">City</label>
          <div class="search-field"><gh-icon name="pin" /><input id="hc" name="city" [(ngModel)]="city" placeholder="City" list="home-cities" autocomplete="off" />
            <datalist id="home-cities">@for (c of cities; track c) { <option [value]="c"></option> }</datalist></div>
          <button class="btn btn-primary btn-lg" type="submit">Find jobs</button>
        </form>
        <div class="row hero-ctas">
          <a class="btn btn-secondary" [href]="employerUrl">I'm hiring</a>
          <span class="caption">Popular: @for (t of popular; track t) { <a [routerLink]="['/jobs']" [queryParams]="{ q: t }" class="pop">{{ t }}</a> }</span>
        </div>
      </div>
    </section>

    @if (featured().length) {
      <section class="container section">
        <div class="section-title"><h2>Fresh jobs from verified employers</h2><a routerLink="/jobs">See all jobs →</a></div>
        <div class="grid-auto">@for (j of featured(); track j.id) { <gh-job-card [job]="j" /> }</div>
      </section>
    }

    <section class="container section">
      <h2 class="center">How GenZHire works</h2>
      <div class="grid-2 how">
        <div class="card stack">
          <span class="overline">For freshers</span>
          <ol class="steps">
            <li><strong>Build your profile in 3 minutes.</strong> Education, skills and projects — no work history needed.</li>
            <li><strong>Discover roles that fit.</strong> Filter by city, work mode and salary. Every employer is reviewed.</li>
            <li><strong>Apply in one tap and track it.</strong> See when you're viewed, shortlisted or invited to interview.</li>
          </ol>
          <a class="btn btn-primary" routerLink="/register">Create your free profile</a>
        </div>
        <div class="card stack">
          <span class="overline">For employers</span>
          <ol class="steps">
            <li><strong>Post jobs or search the talent database.</strong> Filter freshers by skill, degree, graduation year and city.</li>
            <li><strong>Start with 50 free profile views</strong> once your company is verified.</li>
            <li><strong>Or let our HR consultants hire for you</strong> — no upfront fee; pay only after the hire completes 90 days.</li>
          </ol>
          <a class="btn btn-secondary" [href]="employerUrl">Explore GenZHire for employers</a>
        </div>
      </div>
    </section>

    <section class="container section">
      <div class="grid-3">
        <div class="card stack-sm"><gh-icon name="shield" [size]="24" class="accent" /><h3>Verified employers</h3>
          <p class="secondary">Companies are checked against registration records before they can view candidate profiles.</p></div>
        <div class="card stack-sm"><gh-icon name="lock" [size]="24" class="accent" /><h3>You control your data</h3>
          <p class="secondary">Choose who can find you, block employers, and see every company that viewed your profile.</p></div>
        <div class="card stack-sm"><gh-icon name="phone" [size]="24" class="accent" /><h3>No spam calls</h3>
          <p class="secondary">Employers can only see your phone and email after you accept their contact request — or when you apply.</p></div>
      </div>
    </section>

    <section class="container section faq">
      <h2 class="center">Questions, answered</h2>
      <div class="stack-sm">
        @for (f of faqs; track f.q) {
          <details class="card card-tight"><summary><strong>{{ f.q }}</strong></summary><p class="secondary" style="margin-top:8px">{{ f.a }}</p></details>
        }
      </div>
    </section>

    <section class="container section">
      <div class="card cta theme-brand">
        <div><h2>Your career starts here.</h2><p class="secondary">Build your profile once and get discovered by verified employers hiring emerging talent.</p></div>
        <div class="row"><a class="btn btn-primary btn-lg" routerLink="/register">Get started — it's free</a><a class="btn btn-secondary btn-lg" routerLink="/jobs">Browse jobs</a></div>
      </div>
    </section>`,
  styles: `
    .hero { position: relative; overflow: hidden; background: var(--bg); color: var(--text); padding: 88px 0 72px; }
    .hero-grid { position: absolute; inset: 0; opacity: 0.07; background-image: linear-gradient(var(--electric) 1px, transparent 1px), linear-gradient(90deg, var(--electric) 1px, transparent 1px);
      background-size: 48px 48px; mask-image: radial-gradient(ellipse at 50% 30%, #000 20%, transparent 70%); }
    .hero-inner { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 20px; }
    .display { font-size: var(--fs-display); line-height: 1.1; font-weight: 700; letter-spacing: -0.02em; max-width: 780px; }
    .lead { font-size: 1.125rem; color: var(--text-secondary); max-width: 620px; }
    .search { display: grid; grid-template-columns: 1.4fr 1fr auto; gap: 8px; width: min(820px, 100%); margin-top: 8px; padding: 8px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
    .search-field { display: flex; align-items: center; gap: 8px; padding: 0 12px; color: var(--text-muted); border-radius: var(--radius-sm); background: var(--bg-subtle); }
    .search-field input { flex: 1; height: 44px; border: 0; outline: 0; background: none; color: var(--text); font: inherit; font-size: 1rem; min-width: 0; }
    .search-field:focus-within { box-shadow: 0 0 0 2px var(--primary); }
    .hero-ctas { justify-content: center; }
    .pop { margin-left: 8px; color: var(--text-secondary); }
    .section { padding-top: 64px; }
    .center { text-align: center; margin-bottom: 24px; }
    .how { margin-top: 8px; }
    .steps { display: flex; flex-direction: column; gap: 12px; color: var(--text-secondary); padding-left: 1.2em; }
    .steps strong { color: var(--text); }
    .accent { color: var(--primary); }
    .faq { max-width: 820px; }
    summary { cursor: pointer; list-style-position: outside; }
    .cta { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; background: var(--bg); padding: 40px; color: var(--text); }
    @media (max-width: 767px) { .hero { padding: 56px 0 48px; } .search { grid-template-columns: 1fr; } .cta { padding: 24px; } }`,
})
export class HomePage {
  private readonly router = inject(Router);
  protected readonly employerUrl = appUrl('employer');
  protected readonly cities = OPTIONS.cities;
  protected readonly popular = ['Data Analyst', 'Java Developer', 'Python', 'Customer Support', 'Digital Marketing'];
  protected readonly featured = signal<JobCardData[]>([]);
  protected q = '';
  protected city = '';
  protected readonly faqs = [
    { q: 'Is GenZHire free for jobseekers?', a: 'Yes. Creating a profile, searching and applying to jobs is free. GenZHire will never ask you to pay for a job or an interview — report any employer who does.' },
    { q: 'Who can see my profile?', a: 'By default, only verified employers can find your profile in search, and they see a limited preview. Your phone and email are shared only when you apply or accept a contact request. You can change this any time in Privacy settings.' },
    { q: 'I have no work experience. Can I still apply?', a: 'Absolutely. GenZHire is built for freshers — add your education, skills, projects and certifications and employers will see what you can do.' },
    { q: 'How are employers verified?', a: 'Employers submit their official email, website and registration details (such as GSTIN or CIN). Our team reviews them before they can unlock candidate profiles.' },
    { q: 'How do I delete my account?', a: 'Go to Settings → Privacy. You can hide your profile instantly, and request deletion of your account and data.' },
  ];

  constructor() {
    inject(Api).get<JobCardData[]>('/jobs/featured').then((j) => this.featured.set(j)).catch(() => this.featured.set([]));
  }

  search() {
    void this.router.navigate(['/jobs'], { queryParams: { q: this.q.trim() || null, city: this.city.trim() || null } });
  }
}
