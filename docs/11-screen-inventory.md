# J. Screen Inventory

The 41 screens from spec §72 plus the screens the flows also need. Numbers match the spec, and extra screens are marked with a letter (for example `5a`).

**States column.** Every screen must design **L**oading (skeleton), **E**mpty, **Er**ror, **P**ermission denied, and **N**ot found (spec §52). The column lists only states specific to that screen, beyond those five.

## Public — `genzhire.work` (theme `brand` → `light`)

| # | Screen | Route | Key content | Extra states | Mobile |
|---|---|---|---|---|---|
| 1 | Homepage | `/` | The sections from spec §44: hero + search, featured jobs (6, only from verified employers), how it works (3 steps × 2 audiences), for freshers, for employers, talent database, HR consultant, trust/verification, FAQ (accordion), final CTA, footer | Featured jobs empty → hide the section | Search stacks, and feature grids become one column |
| 2 | Job search | `/jobs` | Search bar; 3 main filters (Location, Work mode, Experience) as chips; "All filters" drawer (salary, type, education, posted date, skills, company); sort; result count; JobCards; SEO paging | No results → suggest removing the filter that removes the most | Filters open in a full-screen sheet |
| 3 | Job details | `/jobs/:slug-:id` | Header (title, company + verified badge, meta row), Apply Now, Save, Share; description, responsibilities, requirements, skills; about company; similar jobs; report link | Job closed → banner + similar jobs | Apply bar sticks to the bottom |
| 4 | Login | `/login` | Email, password, show/hide, forgot link; CAPTCHA once risky; "Hiring? Employer login →" | Locked, unverified email, MFA step | |
| 5 | Registration | `/register` | Name, email, password (strength meter), 18+ checkbox, privacy notice summary, and a separate **optional** "Let employers discover me" consent that is on by default and explained in one line | Email sent screen | |
| 5a | Verify email / reset password / set new password | | | Expired link | |
| 5b | Onboarding wizard (3 steps) | `/onboarding` | Progress 1/3; basics → education → skills | | |

## Jobseeker — `genzhire.work/app` (theme `light`, mobile-first)

| # | Screen | Key content | Extra states |
|---|---|---|---|
| 6 | Dashboard | Greeting; profile completion ring + next best action; application summary (counts by status); recommended jobs (6); pending contact requests | New user → onboarding nudges instead of stats |
| 7 | Profile | Section list, each shown as a card with edit in a drawer or sheet. Completion hints on each section. "Preview as employer" button. | Section-level empty prompts |
| 7a | Profile preview | Tabs: Search card · Locked preview · Full profile. The same components the employer app uses, in read-only mode. | |
| 8 | Resume | Up to 3 resumes; primary toggle; upload (drag-drop); scan status | Scanning, rejected (reason) |
| 9 | Applications | Status filter tabs; list with job, company, date, StatusBadge | |
| 9a | Application detail | Timeline of status changes, job snapshot, withdraw | Withdrawn, job closed |
| 10 | Saved jobs | JobCards; closed jobs are greyed out | |
| 11 | Notifications | Grouped by day; mark read; deep links | |
| 11a | Contact requests | Employer name + verified badge, message, job link; Accept / Decline; explains what sharing means | Expired |
| 12 | Settings | Account, security (password, MFA, sessions), notifications, **privacy** (visibility, blocked employers, who viewed me, consents, export, delete) | Deletion scheduled banner |

## Employer — `employer.genzhire.work` (theme `dark`, desktop-first)

| # | Screen | Key content | Extra states |
|---|---|---|---|
| 12a | Employer register / login / accept invite | Split layout: form + value proposition | |
| 12b | Onboarding + verification | Company basics → verification form (official email, website, registration ID, document upload) → status tracker | Pending, needs info, rejected (reason + resubmit) |
| 13 | Dashboard | StatTiles: Active jobs, Applicants (7d), Shortlisted, Saved, **Profile views left**, Open requirements; recent applicants table; verification banner if pending; quick actions | Unverified → verification CTA tile in place of credits |
| 14 | Post job | One page split into sections (Basics, Description, Requirements & skills, Compensation, Location & mode, Openings & deadline) + a live JobCard preview on the right. Save as draft / Submit. | Pending approval notice |
| 15 | Jobs | Table with status tabs; columns: title, status, applicants (new), posted, deadline; row actions | |
| 15a | Job overview | Stats, funnel, edit history, status actions | Rejected → reason |
| 16 | Applications | Kanban / table toggle; job filter; applicant drawer (profile, resume viewer, notes, status actions) | Bulk selection mode |
| 17 | Find talent (landing) | Big search + recent/saved searches + suggested filters based on their open jobs | Unverified → search works, unlock shows the verification prompt |
| 18 | Candidate search results | Sticky toolbar (search, filter chips, `1,284 candidates found`, `CreditMeter 37 left`); filter panel on the left (collapsible); CandidateCards in list or compact view; save, compare checkbox | No match; search depth limit reached ("Refine your filters to see more") |
| 19 | Candidate profile | **Locked state:** preview fields + blurred section outlines (not real blurred text: the data is never sent) + "View full profile · uses 1 credit" → ConfirmDialog. **Full state:** the sections from spec §23, action bar (Save, Shortlist, Contact, Share, Add note), notes panel, unlock expiry | Out of credits; candidate hidden since unlock (404); contact pending/accepted |
| 19a | Compare | 3 columns | |
| 20 | Saved candidates | Folder list (left) + table/cards; move/remove | |
| 21 | Hiring requirement | Form (fields from spec §27), then fulfilment mode shown as 3 explained cards (Candidate database / HR consultant / Both) with the fee terms in plain language for consultant mode | |
| 21a | Requirement detail | Status timeline; submitted candidates (accept/reject); joining confirmations | |
| 22 | Usage / credits | Bucket cards (source, total/used/left, expiry); ledger table (date, user, candidate, action, delta); explainer on what uses a credit | 0 credits |
| 22a | Company profile · Team · Settings · Analytics | | |

## Recruiter — `recruiter.genzhire.work` (theme `dark`, operational)

| # | Screen | Key content | Extra states |
|---|---|---|---|
| 22b | Login + MFA / MFA setup | | MFA enrolment forced on first login |
| 23 | Dashboard | My cases (with stage counts); today's interviews; reminders due (90-day confirmations); submitted awaiting employer feedback > 3 days | |
| 24 | Requirements | Table: employer, role, openings, filled, stage distribution bar, age, owner | |
| 24a | Case workspace | Brief (requirement + agreement summary) · Pipeline tab · Activity tab · Candidates tab | |
| 25 | Candidate pipeline | Kanban across stages (configured labels); card shows name, stage age, next action; filters by case | Stage entry needs a record → opens the right form (interview, offer, joining) |
| 26 | Candidate details | Full profile + case history across cases + screening notes + communications log | |
| 27 | Interview management | List/calendar toggle; schedule form; outcome capture | |
| 28 | Joining tracker | Offers → expected joining; confirmation status (recruiter ✓ / employer ✓) | Awaiting employer confirmation |
| 29 | 90-day tracker | Table sorted by due date; days remaining bar; reminder checkpoints (30/60/75/85/90 dots); "Still employed" / "Left" actions | Overdue confirmation (danger) |
| 30 | Billing | Read-only: my placements → billing status | |

## Admin — `admin.genzhire.work` (theme `dark`, dense)

| # | Screen | Key content |
|---|---|---|
| 31 | Dashboard | 13 KPI tiles (spec §32) in 2 rows; date range picker; 7 charts (registrations, jobs, applications, searches, profile views, hiring, revenue); queues summary (verification, moderation, abuse, alerts) |
| 32 | Users | Table + filters; user detail (roles, sessions, login history, activity, actions: suspend/reactivate/revoke sessions/delete) |
| 33 | Candidates | Table; detail with **access history** (who viewed, saved or accessed, recruiters), consents, applications |
| 34 | Employers | Table; detail: company, team, verification history, credits + ledger + grant/adjust, jobs, access activity, risk score |
| 34a | Verification queue | Split view: queue list + submission detail with checklist + approve/reject/request info |
| 35 | Jobs | Table; moderation queue with side-by-side preview and reason templates |
| 36 | Applications | Table (read-mostly) |
| 37 | Profile access logs | The table from spec §24: employer, candidate, date, time, action, basis, credits used, IP/device (hover), export |
| 38 | Recruitments | Requirements queue (open case: link agreement + assign recruiters); cases table; recruiter capacity |
| 39 | Billing | Consultant billing table by status; invoices; invoice builder; payment recording; agreements |
| 40 | Audit logs | Filterable immutable log; entity drill-down; hash-chain verification status |
| 41 | System settings | Grouped settings (Billing, Entitlements, Talent, Jobs, Security) with JSON-Schema-driven editors, a required "reason" on save, and a change history; pipeline stage editor; policy versions; skill list |
| 41a | Abuse reports · Security alerts · Data subject requests | Queues with SLA timers |

**Total: 41 spec screens + 15 supporting entries (the lettered rows; some, like 22a and 41a, are small groups of screens).** Phase 1 designs the high-fidelity versions of screens 1–5, 6, 7, 13, 18, 19, 22 and 31 first. These cover the MVP chain from §68 and set every pattern that the remaining screens reuse.
