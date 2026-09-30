# F. API Specification (v1)

This document is a readable contract. In Phase 1 it becomes an OpenAPI 3.1 document generated from the NestJS DTOs (`@nestjs/swagger`). The Angular clients are generated from that document, and CI fails if the API changes in a breaking way without the version going up.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | Each frontend calls **its own origin**: `https://employer.genzhire.work/api/v1/...`. The CDN routes `/api/*` to the API cluster. Keeping everything same-origin means host-only cookies and no CORS (see [13-security.md](13-security.md#3-sessions-asvs-v3)). |
| Auth | `Authorization: Bearer <access JWT>` (10 min, kept in memory only). The refresh token is in a `__Host-gh_rt` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`). |
| App binding | The access token's `aud` claim is `jobseeker` \| `employer` \| `recruiter` \| `admin`. Each route declares which audiences may call it. A token for the wrong audience gets 403. |
| CSRF | State-changing requests need `X-Requested-With: genzhire` and the `Origin` header must match. The refresh endpoint also depends on `SameSite=Strict`. |
| Format | JSON with camelCase. Dates are ISO-8601 (`date` values are `YYYY-MM-DD`). Money is an integer number of **paise** in fields ending `…Paise`. |
| Idempotency | `Idempotency-Key` (UUID) is **required** on: unlock, contact request, apply, payment record, invoice issue. The response is cached for 24 hours per key and user. |
| Pagination | `?limit=` (default 20, max 50; candidate search max 25) and `&cursor=` (opaque, base64url-encoded, HMAC-signed). Response: `{ "data": [...], "page": { "nextCursor": "…" \| null, "limit": 20 } }`. **No total counts on large collections** except candidate/job search, where the total is an estimate (`"totalEstimate": 1284`). |
| Errors | RFC 9457 `application/problem+json`: `{ "type", "title", "status", "code", "detail", "errors": [{ "field", "code", "message" }], "requestId" }`. `code` is stable and machine-readable (`NO_CREDITS`, `EMPLOYER_NOT_VERIFIED`, `INVALID_TRANSITION`, …). |
| Status codes | 200/201/204 · 400 validation · 401 unauthenticated · 402 `NO_CREDITS` · 403 forbidden (a wrong role, or **not allowed to read**) · 404 not found **or not visible** (the API doesn't distinguish, so it can't be used to find out which candidates exist) · 409 conflict/transition · 422 business-rule failure · 429 rate limited (with `Retry-After`) |
| Rate limits | Response headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. The limits are listed in [13-security.md](13-security.md#6-rate-limits). |

Permission codes in the tables come from [08-rbac.md](08-rbac.md). **Scope** says which rows the caller can reach: `self` = their own records · `tenant` = their employer's records · `assigned` = cases assigned to the recruiter · `all` = admin.

## 2. Auth — `/api/v1/auth`

| Method & path | Body / query | Response | Notes |
|---|---|---|---|
| POST `/register/candidate` | email, password, firstName, lastName, ageConfirmed, consents[] | 201 `{}` | Always gives the same answer, so you can't tell whether an email is already registered. CAPTCHA after 3 requests per IP per hour. |
| POST `/register/employer` | email, password, firstName, lastName, companyName, designation | 201 | Creates the user + employer + company + employer_user(COMPANY_ADMIN) |
| POST `/verify-email` | token | 204 | |
| POST `/resend-verification` | email | 202 | |
| POST `/login` | email, password, (captchaToken) | 200 `{ accessToken, expiresIn, user, mfaRequired }` | When `mfaRequired` is true, the token only has scope `mfa`. |
| POST `/mfa/verify` | code \| recoveryCode | 200 full token | |
| POST `/mfa/setup` → `/mfa/enable` | — / code | otpauth URI → recovery codes | |
| POST `/refresh` | cookie | 200 new access token + rotated cookie | If an old refresh token is used again, every session in that family is revoked and an alert is raised. |
| POST `/logout` | — | 204 | |
| POST `/logout-all` | — | 204 | Revokes all of the user's sessions in all apps. |
| GET `/sessions` · DELETE `/sessions/{id}` | | | |
| POST `/password/forgot` · `/password/reset` · `/password/change` | | | A reset revokes all sessions. |
| GET `/me` | | user, roles, permissions (for UI hints only), employer context | |

## 3. Public jobs — `/api/v1/jobs`

| Method & path | Auth | Notes |
|---|---|---|
| GET `/jobs?q=&city=&workMode=&expMax=&salaryMin=&employmentType=&education=&postedWithin=&skills=&companyId=&sort=relevance\|recent&cursor=` | optional | Only PUBLISHED jobs. Anonymous users can page through at most 20 pages. |
| GET `/jobs/{id}` | optional | Includes `company` with its `verified` badge. Signed-in candidates also get `viewerState {saved, applied, applicationId}`. |
| GET `/jobs/{id}/similar` | optional | |
| GET `/companies/{slug}` · `/companies/{slug}/jobs` | public | Verified employers only. |
| POST `/jobs/{id}/report` | jobseeker | Abuse report. |

## 4. Candidate self-service — `/api/v1/candidate` (aud=jobseeker, scope=self)

| Method & path | Notes |
|---|---|
| GET/PATCH `/profile` | Basic info, headline, summary, preferences. The response includes `completion { percent, missing[] }`. |
| GET/POST/PATCH/DELETE `/education[/{id}]`, `/experience[/{id}]`, `/projects[/{id}]`, `/certifications[/{id}]` | |
| PUT `/skills` | `[{ skillId, proficiency }]`, at most 30 |
| GET `/skills/suggest?q=` | Typeahead over the skill list |
| GET `/profile/preview?as=card\|locked\|unlocked` | The same data an employer would get. Built by the same serializer the employer endpoints use. |
| GET/POST `/resumes` · PATCH `/resumes/{id}` (primary/label) · DELETE | The POST body is `{ fileId }`, taken from the files flow. |
| GET/PUT `/visibility` | level, openToWork |
| GET/POST/DELETE `/blocked-employers` | Search is by company name. The response returns only the ID and display name. |
| GET `/consents` · POST `/consents` | `{ purpose, granted }`. Each call adds a new row. |
| GET `/profile-access` | "Who viewed me": `[{ company, action, date }]` |
| GET `/applications?status=` · GET `/applications/{id}` (with timeline) · POST `/applications/{id}/withdraw` | |
| POST `/jobs/{jobId}/apply` | `{ resumeId, coverNote }` + Idempotency-Key. 409 `ALREADY_APPLIED`, 422 `JOB_NOT_OPEN`, 422 `RESUME_NOT_READY` |
| GET/PUT/DELETE `/saved-jobs[/{jobId}]` | |
| GET `/recommended-jobs` | Deterministic: skill overlap + preferences |
| GET `/contact-requests` · POST `/contact-requests/{id}/accept\|decline` | |
| POST `/data-export` · POST `/account/delete` | Creates a `data_subject_requests` row. Deletion has a 14-day grace period. |

## 5. Files — `/api/v1/files` (any authenticated audience)

| Step | Call |
|---|---|
| 1 | POST `/files/uploads` `{ purpose, fileName, sizeBytes, mimeType }` → `{ fileId, uploadUrl, headers, expiresIn: 300 }`. This is a presigned **PUT to the quarantine bucket**, with purpose-specific limits on size and type. |
| 2 | The client PUTs the bytes directly to storage. |
| 3 | POST `/files/{fileId}/complete` → 202. The worker sniffs the real file type, runs a virus scan, strips metadata, and moves the file to the clean bucket or marks it `REJECTED`. |
| 4 | GET `/files/{fileId}/status` (poll) — the result also arrives by SSE or as a notification. |

There is **no** generic "download file" endpoint. Each kind of download goes through the endpoint for its resource (resume, invoice, …), and that endpoint checks permission before issuing a 60-second signed GET URL.

## 6. Employer — `/api/v1/employer` (aud=employer, scope=tenant)

| Method & path | Permission | Notes |
|---|---|---|
| GET `/dashboard` | `employer.dashboard.read` | KPI counts plus the credit balance |
| GET/PATCH `/company` · PUT `/company/logo` | `employer.company.manage` | |
| GET/POST `/verification` | `employer.verification.submit` | |
| POST `/verification/official-email` → `/confirm` | same | |
| GET `/team` · POST `/team/invites` · PATCH/DELETE `/team/{employerUserId}` | `employer.team.manage` | |
| GET/POST `/jobs` · GET/PATCH `/jobs/{id}` | `jobs.manage` | |
| POST `/jobs/{id}/submit\|pause\|resume\|close\|duplicate` | `jobs.manage` | Guarded by the state machine |
| GET `/applications?jobId=&status=&cursor=` · GET `/applications/{id}` | `applications.read` | Opening one moves APPLIED to VIEWED |
| POST `/applications/{id}/status` | `applications.manage` | `{ toStatus, note, confirm: true }` for moves marked ✱ in the business rules |
| POST `/applications/bulk-status` | `applications.manage` | At most 50 at a time. Always needs confirmation. |
| GET `/applications/{id}/resume` | `applications.read` | 60 s signed URL, watermarked, audited |
| GET `/entitlements` | `employer.usage.read` | Buckets with total, used, remaining, validUntil |
| GET `/entitlements/ledger?cursor=` | `employer.usage.read` | Each movement, with its candidate reference |
| CRUD `/folders` · GET/POST/DELETE `/saved-candidates` | `talent.save` | Saving needs the candidate to be accessible (unlocked or applied) |
| CRUD `/candidates/{candidateId}/notes` | `talent.note` | |
| GET/POST `/hiring-requirements` · GET/PATCH `/{id}` · POST `/{id}/cancel` | `requirements.manage` | |
| GET `/recruitment/submissions?requirementId=` · POST `/recruitment/submissions/{id}/decision` | `recruitment.review` | Accept or reject a candidate the recruiter submitted |
| POST `/recruitment/joinings/{id}/confirm` · `/left` | `recruitment.review` | The employer's side of joining and early-leave confirmation |
| GET `/analytics?from=&to=` | `employer.analytics.read` | |

## 7. Candidate search & access — `/api/v1/search/candidates`, `/api/v1/candidates` (aud=employer|recruiter|admin)

| Method & path | Permission | Notes |
|---|---|---|
| POST `/search/candidates` | `talent.search` | Body below. Returns cards only, with `totalEstimate` and `credits { remaining }` for employers. Rate limit: 30/min per user and 600/day. |
| GET `/candidates/{id}` | `talent.view` | Returns `{ access: { level: "LOCKED"\|"FULL", basis, unlockCost, creditsRemaining, unlockExpiresAt }, profile }`. When locked, `profile` holds only the locked-preview fields. **No side-effects**, apart from a FULL_PROFILE_VIEW access-log row when a full profile is returned. |
| POST `/candidates/{id}/unlock` | `talent.unlock` | Idempotency-Key. Returns 200 FULL, or 402 `NO_CREDITS`, 403 `EMPLOYER_NOT_VERIFIED`, 404, or 429 `DAILY_UNLOCK_CAP`. |
| GET `/candidates/{id}/resume` | `talent.resume.download` | Needs FULL access. Signed URL, watermark. |
| POST `/candidates/{id}/contact-requests` | `talent.contact` | `{ message, jobId? }` + Idempotency-Key |
| GET `/candidates/{id}/contact` | `talent.contact` | Only after the candidate accepts (or as the setting allows). Audited ★. |
| POST `/candidates/compare` | `talent.view` | `{ ids: [≤3] }`. Every candidate must already be FULL. |
| POST `/candidates/{id}/share` | `talent.share` | `{ employerUserIds[] }` inside the same tenant. Free. |

Search request body:

```json
{
  "q": "data analyst",
  "skills": { "all": [12, 44], "any": [91] },
  "cities": ["Chennai", "Coimbatore"],
  "educationLevels": ["UG"],
  "degrees": ["B.Tech", "B.E."],
  "graduationYear": { "min": 2025, "max": 2026 },
  "experienceMonths": { "max": 12 },
  "expectedCtcPaise": { "max": 60000000 },
  "availability": ["IMMEDIATE", "WITHIN_30_DAYS"],
  "employmentStatus": ["FRESHER", "STUDENT"],
  "workModes": ["ONSITE", "HYBRID"],
  "industries": [],
  "certifications": ["AWS Cloud Practitioner"],
  "excludeUnlocked": false,
  "sort": "relevance | recently_active | graduation_year",
  "limit": 25,
  "cursor": null
}
```

Card response item:

```json
{
  "candidateId": "01927…",
  "displayName": "Rahul K.",
  "initials": "RK",
  "headline": "Aspiring Data Analyst | Python · SQL",
  "targetRole": "Data Analyst",
  "education": { "degree": "B.Tech", "specialization": "IT", "graduationYear": 2026 },
  "city": "Chennai",
  "skills": ["Python", "SQL", "Excel", "Power BI", "Statistics", "Pandas"],
  "experienceMonths": 6,
  "availability": "IMMEDIATE",
  "expectedCtcBand": "3–5 LPA",
  "profileCompletion": 86,
  "verified": { "email": true, "phone": true },
  "viewerState": { "unlocked": false, "saved": false, "applied": false }
}
```

## 8. Recruiter — `/api/v1/recruitment` (aud=recruiter; scope=assigned; admin=all)

| Method & path | Notes |
|---|---|
| GET `/cases?status=&mine=true` · GET `/cases/{id}` | The case brief is the requirement plus the agreement summary. Recruiters see the fee %, never the invoice totals of other cases. |
| GET `/cases/{id}/pipeline` | Grouped by stage |
| POST `/cases/{id}/candidates` | `{ candidateId, source, notes }`. Needs the candidate to be searchable, or to have applied to one of this employer's jobs. Grants `RECRUITER_CASE` access. |
| POST `/pipeline/{recruitmentCandidateId}/move` | `{ toStageId, note }`. Checked against the rules for each semantic. |
| POST `/pipeline/{id}/submit` | Moves to SUBMITTED and notifies the employer |
| CRUD `/interviews` (+ `/interviews/{id}/outcome`) | |
| POST `/pipeline/{id}/offer` · PATCH `/offers/{id}` | |
| POST `/pipeline/{id}/joining` · POST `/joinings/{id}/confirm` · POST `/joinings/{id}/left` · POST `/joinings/{id}/still-employed` | |
| GET `/tracking?dueWithinDays=` | The 90-day tracker |
| GET `/billing?status=` | Read-only |
| GET `/employers` · `/employers/{id}` | Only employers with a case assigned to this recruiter |
| GET `/reports/funnel?from=&to=` | |

## 9. Billing — `/api/v1/billing` (aud=admin; perm `billing.manage`)

| Method & path | Notes |
|---|---|
| CRUD `/agreements` · POST `/agreements/{id}/activate\|terminate` | |
| GET `/consultant-billing?status=` · POST `/{id}/waive` | |
| POST `/invoices` `{ consultantBillingIds[] }` → DRAFT · POST `/invoices/{id}/issue` (assigns the number, renders the PDF, emails it) · POST `/invoices/{id}/void` | |
| GET `/invoices/{id}/pdf` | Signed URL |
| POST `/invoices/{id}/payments` · POST `/payments/{id}/reverse` | Idempotency-Key |

## 10. Notifications — `/api/v1/notifications` (any audience; scope=self+app)

GET `/notifications?unread=&cursor=` · POST `/{id}/read` · POST `/read-all` · GET `/unread-count` · GET `/stream` (SSE, heartbeat every 25 s) · GET/PUT `/preferences`

## 11. Admin — `/api/v1/admin` (aud=admin, MFA required)

| Area | Endpoints |
|---|---|
| Dashboard | GET `/metrics?from=&to=` · GET `/metrics/timeseries?metric=registrations\|jobs\|applications\|searches\|profile_views\|hires\|revenue&interval=day\|week` |
| Users | GET `/users?q=&role=&status=` · GET `/users/{id}` · `/users/{id}/login-history` · `/users/{id}/activity` · POST `/users/{id}/suspend\|reactivate\|revoke-sessions` · POST/DELETE `/users/{id}/roles` · POST `/users/{id}/delete` (follows the retention policy) |
| Candidates | GET `/candidates` · `/candidates/{id}` · `/candidates/{id}/access-history` |
| Employers | GET `/employers` · `/employers/{id}` · POST `/employers/{id}/suspend\|reinstate` · POST `/employers/{id}/entitlements` (grant) · POST `/entitlements/{id}/adjust\|refund` (a reason is required) |
| Verification | GET `/verification-queue` · POST `/verifications/{id}/start-review\|approve\|reject\|request-info` |
| Jobs | GET `/jobs` · GET `/jobs/moderation-queue` · POST `/jobs/{id}/approve\|reject\|close` |
| Applications | GET `/applications` |
| Requirements & recruitment | GET `/hiring-requirements` · POST `/hiring-requirements/{id}/open-case` `{ agreementId, recruiterIds[] }` · GET `/recruitment/cases` · POST `/cases/{id}/assign` · CRUD `/recruiters` |
| Logs | GET `/access-logs?employerId=&candidateId=&action=&from=&to=` · GET `/audit-logs?actorId=&action=&entityType=&entityId=&from=&to=` · POST `/access-logs/export` (async, itself audited) |
| Trust & safety | GET `/abuse-reports` · POST `/abuse-reports/{id}/action` · GET `/security-alerts` · POST `/security-alerts/{id}/resolve` |
| Settings | GET `/settings` · PUT `/settings/{key}` `{ value, reason }` (checked against the setting's JSON Schema) · GET `/settings/{key}/history` · CRUD `/pipeline-stages` · CRUD `/policies` · CRUD `/skills` (+ merge) |
| Privacy | GET `/data-subject-requests` · POST `/{id}/complete` |
