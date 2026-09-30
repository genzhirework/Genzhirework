# A. Product Requirements Document — GenZHire.work

## 1. Vision

GenZHire is a place where freshers get discovered and hired. It is not "Naukri for freshers". It is built around three loops that feed each other:

| Loop | Flow | Value created |
|---|---|---|
| Candidate | Profile → Discover → Apply → Interview → Hire | Freshers get jobs with little friction and see where each application stands. |
| Employer | Requirement → Search → Shortlist → Contact → Hire | Employers find emerging talent without waiting for applications. |
| Recruitment | Requirement → Source → Screen → Interview → Join → 90 days → Billing | SISTECHWORK earns revenue when an assisted hire succeeds. |

Every candidate profile makes the database more valuable to employers. Every employer requirement brings jobs and outreach to candidates. Every successful placement brings revenue.

## 2. Users

| Persona | Application | Primary goals | Key worries |
|---|---|---|---|
| **Fresher / early-career jobseeker** (age 18–26, UG/PG/diploma, 0–2 yrs experience) | genzhire.work (mobile-first, light UI) | Build a credible profile with no work history, find relevant jobs, apply quickly, know what's happening | Fake jobs, being ignored, spam calls, data misuse |
| **Employer user** (founder, HR executive, hiring manager at SMB/mid-market) | employer.genzhire.work (desktop-first, dark UI) | Fill fresher roles fast, search the database, manage applicants | Poor-quality candidates, wasted credits, clunky tools |
| **Company admin** | same | Manage team, verification, usage | Controlling spend and access |
| **Recruiter / HR consultant** (SISTECHWORK staff) | recruiter.genzhire.work (desktop-first, operational) | Work assigned requirements, run the pipeline, land joinings, get to billing | Losing track of candidates and 90-day dates |
| **Admin** (SISTECHWORK ops) | admin.genzhire.work (dense, dark) | Verify employers, moderate jobs, watch for abuse, run billing, audit access | Fraud, data breaches, revenue leakage |

## 3. Goals and success metrics (MVP)

The MVP must prove the chain in spec §68. Each step has a measurable exit signal:

| Question | Metric | MVP target (first 90 days live) |
|---|---|---|
| Can candidates create profiles? | Registered candidates with ≥ 60% profile completion | ≥ 60% of registrations |
| Can employers post jobs? | Verified employers with ≥ 1 published job | ≥ 50% of verified employers |
| Can candidates apply? | Median time from job view to submitted application | < 90 seconds |
| Can employers search candidates? | Searches per active employer per week | ≥ 3 |
| Can employers view candidates? | Unlocks per verified employer | Median ≥ 5 |
| Does the entitlement work? | Credit ledger vs. unlock records mismatch | **0** (checked nightly) |
| Can admin monitor everything? | Sensitive actions with an audit row | **100%** (release gate) |

Guardrail metrics: rate of fake-job reports, candidate complaints about spam contact, p95 search latency < 800 ms.

## 4. Scope

### 4.1 MVP (Phases 1–3, see [15-roadmap.md](15-roadmap.md))

- Identity: email/password, email verification, password reset, sessions, logout from all devices, login history, RBAC, TOTP MFA required for admin and recruiter.
- Candidate: registration, full profile (all sections in spec §15), resume upload (virus-scanned), visibility controls, consents, preview "as employer sees it", job search, save job, apply, application tracking, in-app and email notifications.
- Employer: registration, company profile, team invites, verification submission, job posting with moderation, application management (table + Kanban), candidate search, profile unlock using credits, saved candidates and folders, notes, contact requests, usage page.
- Admin: dashboard KPIs, user/candidate/employer/job/application management, employer verification queue, job moderation queue, profile access log, audit log, system settings.

### 4.2 Phase 4–5 (post-MVP, planned)

Hiring requirements ("I Need Candidates"), the recruiter CRM (cases, pipeline, interviews, offers, joining), 90-day tracking, consultant fee calculation, invoices and payments.

> The hiring-requirement **form** for employers ships in Phase 3, so demand is captured from day one. Until the recruiter app exists, admin handles requirements manually.

### 4.3 Out of scope (Phase 6+)

AI matching, resume parsing, natural-language search, subscriptions/paid plans, WhatsApp, calendar-integrated interview scheduling, assessments, OpenSearch. The architecture leaves room for each (see [09-architecture.md](09-architecture.md#5-extension-points-phase-6)).

## 5. Functional requirements

Requirement IDs are referenced in the API spec and tests. The priority column says whether a requirement is **M**VP or **L**ater.

### 5.1 Identity & access (IAM)

| ID | Requirement | P |
|---|---|---|
| IAM-1 | Register with email + password. A verification email is sent, and the account stays `PENDING_VERIFICATION` until the link is used. | M |
| IAM-2 | Passwords: minimum 10 characters, checked against a breached-password list, hashed with argon2id. | M |
| IAM-3 | Login returns a short-lived access token and a rotating refresh token in an httpOnly cookie that belongs to one app only. | M |
| IAM-4 | Password reset through a single-use token that expires in 30 minutes. A reset revokes every session. | M |
| IAM-5 | Users can see their active sessions and log out one device or all devices. | M |
| IAM-6 | Login history (success and failure, IP, device) is visible to the user and to admin. | M |
| IAM-7 | TOTP MFA is required for ADMIN and RECRUITER and optional for everyone else. | M |
| IAM-8 | Optional OTP login by email or SMS. | L |
| IAM-9 | Each app accepts only the roles it is meant for. For example, a jobseeker session cannot call employer APIs. | M |

### 5.2 Candidate (CAN)

| ID | Requirement | P |
|---|---|---|
| CAN-1 | Onboarding wizard with 3 steps (basics → education → skills). Everything else is optional and can be done later. | M |
| CAN-2 | Profile sections: basic info, summary, education, skills (from a controlled list), experience/internships, projects, certifications, resume(s), links, preferences. | M |
| CAN-3 | Profile completion % with a weighted formula (see [06-business-rules.md](06-business-rules.md#9-profile-completion)) and next-best-action hints. | M |
| CAN-4 | Up to 3 resumes (PDF/DOC/DOCX, ≤ 5 MB). One is primary. | M |
| CAN-5 | Four visibility levels plus a list of employers to hide the profile from. | M |
| CAN-6 | "Preview as employer" shows exactly what an employer sees, both before and after unlock. | M |
| CAN-7 | Consent centre: see, grant and withdraw consent for each purpose, with a history of changes. | M |
| CAN-8 | "Who viewed my profile": each employer company that unlocked the profile, with the date. | M |
| CAN-9 | Accept or decline employer contact requests. | M |
| CAN-10 | Request account deletion and data export. | M |

### 5.3 Jobs & applications (JOB / APP)

| ID | Requirement | P |
|---|---|---|
| JOB-1 | Employer creates a job with all fields in spec §25. Jobs start as `DRAFT`. | M |
| JOB-2 | Submitting a job moves it to `PENDING_APPROVAL`. Jobs from verified employers with no reports are approved automatically (a setting). All others go to admin review. | M |
| JOB-3 | Public job search with keyword + 3 main filters (location, work mode, experience) and more filters behind an "Advanced" drawer. | M |
| JOB-4 | Job details page, SEO-rendered, with `JobPosting` structured data. | M |
| JOB-5 | Save and share a job. | M |
| JOB-6 | Report a job (fake, spam, discriminatory, other). | M |
| APP-1 | Apply in one screen: confirm profile snapshot → pick resume → optional cover note (≤ 1000 chars) → submit. | M |
| APP-2 | One application per job per candidate. A candidate can withdraw until the status is `SELECTED`. | M |
| APP-3 | Employer views applicants as a table or a Kanban board. Status changes are recorded in the history, and `REJECTED` needs confirmation. | M |
| APP-4 | The candidate is notified of every status change they are allowed to see (see the status table in business rules). | M |

### 5.4 Talent database (TAL)

| ID | Requirement | P |
|---|---|---|
| TAL-1 | Candidate search with the filters in spec §21 and cursor pagination (at most 25 per page and 500 results deep). | M |
| TAL-2 | Result cards show no contact details and no full surname before unlock (D5). | M |
| TAL-3 | Unlocking a full profile is a deliberate action with a confirmation ("Uses 1 credit · 37 left"). It uses one credit unless an active unlock already exists. | M |
| TAL-4 | Saved candidates, folders, shortlist, compare (up to 3 unlocked profiles), and internal notes. | M |
| TAL-5 | Contact request flow (D3). | M |
| TAL-6 | Usage page: credit balance, expiry, and a list of what used each credit. | M |
| TAL-7 | Share a candidate with a teammate inside the same employer account. This is free, because unlocks are shared across the account. | M |

### 5.5 Recruitment CRM (REC) & billing (BIL)

| ID | Requirement | P |
|---|---|---|
| REC-1 | Employer raises a hiring requirement and chooses Database, HR Consultant, or Both. | M (form) / L (workflow) |
| REC-2 | Admin reviews the requirement, links a recruitment agreement, and assigns recruiter(s). This creates a recruitment case. | L |
| REC-3 | Recruiter sources candidates from the database (free for recruiters, but audited), from applications, or from outside the platform. | L |
| REC-4 | Pipeline with configurable stages that map to fixed system meanings (see business rules). | L |
| REC-5 | Submit shortlisted candidates to the employer. The employer sees them in "Recruitment" and can accept or reject each one. | L |
| REC-6 | Interviews (rounds, mode, outcome), offers, joining confirmation. | L |
| BIL-1 | Confirming a joining creates a consultant-billing record with the fee % and trigger days copied from the agreement. | L |
| BIL-2 | Reminders on the configured days (default 30/60/75/85/90). On the due date the worker marks the record `BILLABLE`. | L |
| BIL-3 | Admin/finance generates the invoice (with GST), records payments, and tracks overdue invoices. Nothing is charged automatically. | L |

### 5.6 Admin (ADM)

| ID | Requirement | P |
|---|---|---|
| ADM-1 | KPI dashboard with date-range filter (spec §32). | M |
| ADM-2 | Manage users: search, filter, view, verify, suspend, reactivate, delete according to the retention policy, see login history and activity. | M |
| ADM-3 | Queues: employer verification, job moderation, abuse reports, security alerts. | M |
| ADM-4 | Profile access log (spec §24) filterable by employer, candidate, date and action, with export. | M |
| ADM-5 | Immutable audit log viewer. | M |
| ADM-6 | System settings editor, with a history of every change. | M |
| ADM-7 | Grant or adjust employer credits. Every change is recorded in the ledger with a reason. | M |

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Public pages LCP < 2.5 s on 4G. API p95 < 300 ms (reads), < 800 ms (candidate search). |
| Availability | 99.5% monthly for the MVP. RPO ≤ 5 min (point-in-time recovery), RTO ≤ 4 h. |
| Scale (design target, year 1) | 500k candidates, 10k employers, 50k jobs, 5M applications, 100 req/s peak. |
| Accessibility | WCAG 2.2 AA. Every flow works with the keyboard alone. |
| Browser support | Last 2 versions of Chrome, Edge, Firefox and Safari. Android Chrome and iOS Safari. |
| Localisation | English at launch. All user-facing strings live in a separate translation file (i18n-ready). Currency INR, timezone Asia/Kolkata for business dates. |
| SEO | Public app is server-rendered (Angular SSR). Sitemap.xml, canonical URLs, JobPosting schema. |
| Privacy | DPDP Act 2023 compliant (notice, consent, rights, grievance officer, breach process). |
| Security | OWASP ASVS 4.0 Level 2 baseline. Level 3 controls for admin authentication. |

## 7. Assumptions

1. The launch market is India, and INR is the only currency.
2. A small team (4–6 engineers), so the backend is a modular monolith (spec §62).
3. Email is the main notification channel. SMS for OTP needs DLT registration (a TRAI requirement for commercial SMS in India).
4. Recruitment agreements are signed outside the platform. The platform records their terms and stores the signed PDF.

## 8. Open questions (beyond D1–D13)

1. Should recruiters be able to see candidates whose visibility is `APPLICATION_ONLY`? **Proposed:** only those who applied to a job belonging to an employer the recruiter has an active case with.
2. Should employers be able to email applicants from inside the platform (masked relay)? **Proposed:** Phase 6.
3. What is the paid credit pricing once the 50 free views run out? This is a business decision. The schema already supports it through `subscriptions` and the `ADMIN_GRANT` source.
