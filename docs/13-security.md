# L. Security & Privacy Architecture

The baseline is **OWASP ASVS 4.0.3 Level 2** for the whole platform, with Level 3 authentication controls for ADMIN and RECRUITER. Each section below names the ASVS chapter it covers.

## 1. Threat model summary

| Threat (spec §36) | Main controls |
|---|---|
| Fake employers / fake jobs / payment scams | Employer verification with credits unlocked only after it (D1, D7), job moderation, report button on every job, and a "GenZHire never asks candidates for money" banner plus a scam-keyword detector on job text |
| Resume harvesting / candidate scraping | Credits, a 90-day unlock window, daily unlock caps, capped search depth, masked names on search cards, rate limits, velocity detection, **honeytoken profiles**, watermarked resumes, no bulk export for employers, signed cursors |
| Credential stuffing / account takeover | Rate limits per IP and per account, breached-password check, progressive CAPTCHA, lockout with exponential backoff, MFA, alerts on new devices, refresh-token reuse detection |
| Insider misuse (recruiter/admin) | Least privilege, MFA, every access to candidate data logged (including admin), a hash-chained audit log, and a quarterly access review |
| Data leakage via API | Deny-by-default guards, response serializers per access level (fields are never "hidden in the UI" — they are never sent), 404 for anything the caller can't see, tenant scope taken from the session |
| Malicious uploads | Presigned uploads to a quarantine bucket, magic-byte type sniffing, a malware scan, metadata stripped, clean files served only through signed URLs with `Content-Disposition: attachment` |

## 2. Authentication (ASVS V2)

- **Passwords.** Minimum 10 characters and maximum 128. No composition rules. Checked against a breached-password list (k-anonymity HIBP range API, falling back to a bundled top-100k list). Hashed with **argon2id** (m = 19 MiB, t = 2, p = 1; revisited once a year).
- **Login throttling.** At most 5 failures per account per 15 minutes, then an exponential lock (1, 5, 15, 60 min). 20 attempts per IP per 10 minutes triggers a CAPTCHA (Cloudflare Turnstile or hCaptcha). Error messages are generic.
- **MFA.** TOTP (RFC 6238) plus 10 single-use recovery codes stored as hashes. Required for ADMIN and RECRUITER, enrolled at first login. SUPER_ADMIN (future) will need WebAuthn. MFA is asked for again before sensitive admin actions if the last MFA was more than 12 hours ago (settings, role grants, credit adjustments, exports).
- **Email verification** is required before any use of an account. Invite links for employer teams are single-use and expire in 7 days.
- **OTP** (Phase 2+). 6 digits, valid 5 minutes, maximum 5 attempts, and at most 3 sends per hour per destination. SMS goes through a DLT-registered template.

## 3. Sessions (ASVS V3)

- **Same-origin API.** Each frontend reaches the API at `https://<app-host>/api/*` through the CDN. Cookies are therefore **host-only for each app** (`__Host-gh_rt`), so a jobseeker session cookie can never reach the employer app. No CORS is needed, and cookies never have to be shared across subdomains.
- **Access token.** A JWT signed with **EdDSA**, using keys held in KMS and rotated every 90 days (JWKS kid). It expires in 10 minutes and carries claims `sub, aud, sid, roles, emp (employer id), mfa (timestamp)`. It is kept in memory only, never in localStorage.
- **Refresh token.** 256 bits of random data. Only its SHA-256 hash is stored, in `sessions`. It is rotated every time it is used. If a previous token is used again, the whole session is revoked and a `REFRESH_TOKEN_REUSE` alert is raised. It has a sliding expiry: 30 days for candidates and employers, **12 hours idle / 7 days absolute** for recruiters and admins.
- **Revocation.** Logout, logout-all, password change or reset, suspension and role changes revoke sessions. The access-token guard checks `sid` against a Redis revocation set, so a revocation takes effect in under a second.

## 4. Access control (ASVS V4)

The three layers (audience → permission → scope) are defined in [08-rbac.md](08-rbac.md). Rules that apply everywhere:

- **Tenant scope** always comes from the session's employer membership. IDs in the URL are looked up *within* that scope.
- UUIDv7 IDs aren't secret, so access control never relies on IDs being hard to guess.
- Admins read candidate data through the same access log as everyone else (`access_basis = ADMIN`).

## 5. Input, output & API (ASVS V5, V13)

- `ValidationPipe` with whitelisted DTOs. Unknown fields are rejected. Payload caps are 100 KB by default, and file bytes never pass through the API.
- **SQL injection.** Only parameterised queries (Drizzle). Dynamic sort and filter fields are mapped through allow-lists. A lint rule flags `sql.raw`.
- **XSS.**
  - Angular escapes output by default. Rich text in job descriptions is sanitized on the server with an allow-list (`p, ul, ol, li, strong, em, a[href^=https]`) and then rendered with `[innerHTML]` through Angular's sanitizer.
  - `bypassSecurityTrust*` is banned by lint.
  - The CSP is `default-src 'self'; script-src 'self'` plus a nonce for SSR; `object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`.
  - Trusted Types are enforced on the SPAs.
- **CSRF.** Cookies are `SameSite=Strict`, and the refresh cookie is only read by `POST /auth/refresh`. The API also requires the `X-Requested-With` header and checks `Origin`/`Sec-Fetch-Site` on every non-GET request.
- **Headers** (Helmet): HSTS (2 years, preload), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, mic and geolocation off), COOP/CORP same-origin.
- **Errors.** problem+json only. Stack traces, SQL errors and internal IDs never reach the client. Every error carries a `requestId` for support.
- **Mass assignment.** Separate create and update DTOs. `status`, `employerId`, `verification_status` and `used_quantity` can never be set from the request body.

## 6. Rate limits

Redis sliding-window limits, keyed by the combination shown. When a limit is exceeded the API returns 429 with `Retry-After`, and repeated breaches feed the security detector.

| Endpoint group | Limit |
|---|---|
| `POST /auth/login` | 5 / 15 min per account · 20 / 10 min per IP |
| `POST /auth/register/*`, `/password/forgot`, `/resend-verification` | 3 / hour per IP, and per email |
| OTP send | 3 / hour per destination |
| `POST /search/candidates` | 30 / min and 600 / day per employer user · 2,000 / day per employer |
| `GET /candidates/{id}` | 60 / min per user |
| `POST /candidates/{id}/unlock` | 20 / 10 min per user · daily cap setting (100) · 500 / day per employer |
| Resume download | 20 / day per user |
| `POST /employer/jobs` (create/submit) | 20 / day per employer (unverified: 3 / day) |
| Public `GET /jobs` | 120 / min per IP (anonymous) |
| Everything else (authenticated) | 300 / min per user |

## 7. Anti-scraping (spec §61)

1. **Structural limits.** Page size ≤ 25, results reachable ≤ 500. The cursor is HMAC-signed and tied to the user and query, so it can't be replayed or forged. There is no endpoint that lists candidates without a query, and no export for employers.
2. **Economic limit.** Credits with a 90-day unlock window.
3. **Behavioural detection** (a worker runs every 5 minutes over `candidate_profile_views` and analytics events):
   - More than 40 unlocks in 30 minutes.
   - Unlocking results in rank order across many pages.
   - A high unlock rate with no follow-up actions (no saves, notes or contacts).
   - Several employer accounts on the same device fingerprint or IP.
   - Search queries with very wide filters, run repeatedly.

   When a pattern is found, the detector raises a `SCRAPING_VELOCITY` alert and **throttles automatically**: unlocks require a CAPTCHA and are capped at 5 per hour until an admin reviews.
4. **Honeytokens.** A handful of fake candidate profiles (`candidates.is_honeytoken = true`) with realistic but unique details. They are searchable, and are left out of all KPI and count queries. Any unlock of one raises a HIGH alert. If one of their unique email addresses ever receives mail, that proves the data left the platform.
5. **Leak tracing.** Every resume PDF is watermarked with the employer, the user and a timestamp, and every access is logged.

## 8. Files (ASVS V12, spec §39)

```
Client → POST /files/uploads (purpose, name, size, type)
       ← presigned PUT → s3://gzh-quarantine/<random-key>   (size + content-type enforced by policy; 5 min)
Client → PUT bytes
Client → POST /files/{id}/complete
Worker → HEAD + magic-byte sniff (PDF/DOCX/DOC for resumes; JPEG/PNG/WebP for images)
       → ClamAV scan (ECS sidecar, signatures updated hourly)
       → PDF: reject if encrypted or JavaScript; strip metadata / images: re-encode + strip EXIF
       → copy to s3://gzh-files/<random-key>, delete from quarantine, mark CLEAN
       → or mark REJECTED/INFECTED + notify the user
Download → endpoint for that resource checks permission → access log → watermark (resumes) → 60 s signed GET, Content-Disposition: attachment
```

The buckets are private: block-public-access, SSE-KMS encryption, versioning on, and access only through a VPC endpoint for the tasks.

## 9. Data protection & privacy (ASVS V8/V9, DPDP Act 2023)

> **Legal review required.** India's Digital Personal Data Protection Act 2023 and its Rules apply, with a phased compliance timeline. The controls below are an engineering baseline, and SISTECHWORK's counsel must confirm the notices, retention periods and grievance timelines.

| Obligation | Implementation |
|---|---|
| Notice | A clear, itemised privacy notice at signup (purposes, what data, who sees it, rights). Versioned in `policy_documents`. |
| Consent per purpose | `candidate_consents` records each purpose separately. Discovery by employers (`DATABASE_DISCOVERY`) is **a separate consent** from account services. Withdrawing consent is as easy as giving it. |
| Children | 18+ only (D8). An account found to belong to a minor is closed. |
| Data minimisation | No DOB, gender, caste, religion, marital status, full address or ID numbers are collected from candidates. |
| Rights | Access (export JSON + PDF), correction (the profile editor), erasure (14-day grace, then anonymise), grievance (a form plus a named Grievance Officer page). DSR requests are tracked in `data_subject_requests` with due dates. |
| Purpose limitation | Employers agree in their terms to use candidate data only for recruiting. Contact details are released only with the candidate's approval (D3). |
| Security safeguards | TLS 1.2+ everywhere. Encryption at rest (RDS, S3, and Redis with KMS). Sensitive columns (`mfa_secret_enc`) are also encrypted at the application layer. Backups are encrypted. |
| Breach response | A runbook: detect → contain → assess → notify the Data Protection Board and affected people within the required timelines → review. The audit logs support the forensics. |
| Retention | Active accounts: while active. Inactive candidate (no login for 24 months): reminder, then anonymise at 27 months. Applications: 24 months after the job closes. Access logs and audit logs: 3 years (billing records: 8 years, per the Indian tax record-keeping rules). All values come from settings and are enforced by the `maintenance` worker. |

**Anonymisation on deletion:**
- Replace name and contact details with tokens.
- Delete resumes and photos from storage.
- Keep aggregate and billing-relevant rows, pointing at an anonymised stub.
- Audit rows keep the ID but not the personal data. Audit metadata never held personal data in the first place.

## 10. Logging, monitoring, audit (ASVS V7)

- Structured JSON logs (pino) with `requestId`, `userId`, `aud` and route. **Personal data is redacted by the logger** (email, phone, name, tokens and authorization headers are filtered by path).
- Audit log integrity:
  - `hash = SHA-256(prev_hash ‖ canonical_json(row))`.
  - A nightly job checks the chain and signs the day's last hash into an S3 Object Lock (WORM) bucket.
  - The app database role can only INSERT and SELECT on audit tables.
- Security alerts go to the admin UI and to email/Slack for HIGH and CRITICAL.

## 11. Secrets & supply chain (ASVS V14)

- Secrets live in AWS Secrets Manager and are injected at task start. Nothing is committed in `.env` files. A gitleaks pre-commit hook and CI step enforce this.
- Dependencies: lockfile committed, `npm audit` + Dependabot/Renovate, SBOM (CycloneDX) per build, container image scan (Trivy), minimal distroless base images, non-root containers.
- CI runs SAST (Semgrep with OWASP rulesets), ESLint security rules, and DAST (OWASP ZAP baseline against staging) on every release.
