# B. Sitemap

Route legend: 🌐 public (SEO-rendered) · 🔒 authenticated · 🛡 authenticated + an extra condition (for example, the employer must be verified or have MFA enrolled).

## 1. Public + Jobseeker — `genzhire.work`

```
/                                   🌐 Homepage
/jobs                               🌐 Job search (query-string filters, shareable)
/jobs/:slug-:id                     🌐 Job details
/companies/:slug                    🌐 Company page (verified employers only)
/for-employers                      🌐 Employer landing → links to employer.genzhire.work
/hr-consulting                      🌐 HR consultant service landing
/about  /contact  /faq              🌐
/legal/privacy  /legal/terms        🌐 Versioned policies
/legal/grievance                    🌐 Grievance officer (DPDP)
/login                              🌐
/register                           🌐
/verify-email?token=                🌐
/forgot-password  /reset-password   🌐
/onboarding                         🔒 3-step wizard (basics → education → skills)

/app                                🔒 Dashboard
/app/jobs                           🔒 Find jobs (the same search, personalised)
/app/applications                   🔒 List + status filter
/app/applications/:id               🔒 Timeline
/app/saved-jobs                     🔒
/app/profile                        🔒 Section editor
/app/profile/preview                🔒 "As employer sees it" (tabs: search card · locked · unlocked)
/app/resume                         🔒 Manage resumes
/app/notifications                  🔒
/app/contact-requests               🔒 Accept/decline employer contact requests
/app/settings                       🔒 → account · security · sessions
/app/settings/privacy               🔒 → visibility · blocked employers · who viewed me · consents · export · delete
/app/settings/notifications         🔒
```

Mobile navigation (candidate): a bottom tab bar with **Home · Jobs · Applications · Profile · More**. "More" opens a sheet with Saved jobs, Notifications, Resume and Settings.

## 2. Employer — `employer.genzhire.work`

```
/login  /register  /verify-email  /forgot-password  /reset-password  /accept-invite?token=
/onboarding                         🔒 Company basics → verification prompt

/dashboard                          🔒
/jobs                               🔒 Table (status tabs: All · Draft · Pending · Published · Paused · Closed)
/jobs/new                           🔒
/jobs/:id                           🔒 Overview + stats
/jobs/:id/edit                      🔒
/jobs/:id/applications              🔒 Kanban | table toggle
/applications                       🔒 All applications, across all jobs
/applications/:id                   🔒 Applicant drawer/page (profile is free — the candidate applied)
/talent                             🛡 Find talent — candidate search (cards are visible when unverified; unlocking needs verification)
/talent/candidates/:id              🛡 Candidate profile (locked preview → unlock)
/talent/compare?ids=                🛡 Up to 3 unlocked profiles
/saved                              🔒 Saved candidates + folders
/saved/folders/:id                  🔒
/requirements                       🔒 Hiring requirements list
/requirements/new                   🔒 "I Need Candidates"
/requirements/:id                   🔒 Status + submitted candidates (when consultant mode is used)
/recruitment                        🔒 Candidates submitted by GenZHire recruiters, across all requirements
/analytics                          🔒 Funnel, time-to-shortlist, source mix
/usage                              🔒 Credits: balances, expiry, ledger
/company                            🔒 Public company profile editor
/company/verification               🔒 Submit/track verification
/company/team                       🔒 Invite/remove users (COMPANY_ADMIN)
/settings                           🔒 Account · security · sessions · notifications
```

## 3. Recruiter — `recruiter.genzhire.work`

```
/login  /mfa  /mfa/setup  /forgot-password  /reset-password
/dashboard                          🛡 My cases, today's interviews, due reminders
/requirements                       🛡 Assigned + unassigned (read-only unless assigned)
/requirements/:caseId               🛡 Case workspace: brief · pipeline · activity
/candidates                         🛡 My candidates (across cases) + database search
/candidates/:id                     🛡 Candidate details + case history
/pipeline                           🛡 Kanban across my cases (filter by case)
/interviews                         🛡 Calendar/list
/placements                         🛡 Offers + joinings
/tracking                           🛡 90-day tracker (due-date sorted)
/billing                            🛡 Billable / invoiced / paid (read-only for recruiters)
/employers                          🛡 Employers I work with (contacts, agreement summary)
/reports                            🛡 Personal + team funnel
/settings                           🛡
```

## 4. Admin — `admin.genzhire.work`

```
/login  /mfa  /mfa/setup
/dashboard                          🛡 KPIs + charts, date range
/users                              🛡 All identities
/users/:id                          🛡 Profile · roles · sessions · login history · activity
/candidates                         🛡
/candidates/:id                     🛡 Profile · applications · access history (who viewed/saved/accessed) · consents
/employers                          🛡
/employers/:id                      🛡 Company · team · verification · credits/ledger · jobs · access activity
/verification                       🛡 Employer verification queue
/jobs                               🛡 All jobs
/jobs/moderation                    🛡 Pending approval queue
/applications                       🛡
/requirements                       🛡 Hiring requirements → assign recruiter, link agreement
/recruitment                        🛡 All cases + pipeline health
/recruiters                         🛡 Recruiter accounts + capacity
/agreements                         🛡 Recruitment agreements
/billing                            🛡 Consultant billing records
/billing/invoices                   🛡 Invoices + payments
/access-logs                        🛡 Profile access log (spec §24)
/audit-logs                         🛡 Immutable audit trail
/reports/abuse                      🛡 Abuse reports
/security                           🛡 Security alerts (scraping, credential stuffing, etc.)
/settings                           🛡 System settings (with history)
/settings/pipeline                  🛡 Recruitment stage configuration
/settings/policies                  🛡 Privacy/terms versions
/settings/skills                    🛡 Skill list (merge/rename)
```
