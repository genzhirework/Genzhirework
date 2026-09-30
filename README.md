# GenZHire.work

Fresher-focused hiring platform by **SISTECHWORK Private Limited**. The code has three parts:

- a NestJS API on Supabase Postgres (`backend/`)
- four Angular apps sharing one design system (`frontend/`)
- end-to-end test suites (`tests/`)

The design package (PRD, schema, API spec, RBAC, business rules, security and more) is in [`docs/`](docs/README.md).

| App | Dev URL | Production host | Theme |
|---|---|---|---|
| Jobseeker + public site | http://localhost:4200 | genzhire.work | light, brand-dark hero |
| Employer | http://localhost:4201 | employer.genzhire.work | dark |
| Recruiter (HR consultant) | http://localhost:4202 | recruiter.genzhire.work | dark |
| Admin | http://localhost:4203 | admin.genzhire.work | dark |
| API | http://localhost:3000/api/v1 | proxied at `/api` on each host | — |

## Run locally

Prerequisites: Node 22+ (tested on Node 24) and the Supabase database, which has already been migrated and seeded.

```bash
# 1. API
cd backend
npm install
npm run build && npm start          # or: npm run dev  (watch mode)

# 2. Frontends — one terminal each (each dev server proxies /api to :3000)
cd frontend
npm install
npm run start:web                   # :4200
npm run start:employer              # :4201
npm run start:recruiter             # :4202
npm run start:admin                 # :4203
```

**First admin:** `admin@genzhire.work`. The password was printed once by the seed script. Change it after signing in, under **Account** in the admin app.

**Recruiters** are created by an admin (Recruiters → Add recruiter). The admin sees a temporary password once.

**Email** has no provider configured yet. Verification and reset links are written to the API console. `REQUIRE_EMAIL_VERIFICATION=false` in development.

## Deploy on Railway

Five services from this one repo, each with its own URL. In each service's **Settings**, set the root directory and the config file path. The config path is absolute and does not follow the root directory.

| Service | Root directory | Config file | Variables |
|---|---|---|---|
| `api` | `/backend` | `/backend/railway.json` | `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `CURSOR_SECRET`, `NODE_ENV=production`, `PORT=3000`, `COOKIE_SECURE=true`, `REQUIRE_EMAIL_VERIFICATION=false`, `STORAGE_DIR=/data/storage` |
| `web` | `/frontend` | `/frontend/railway.json` | `APP=web`, `API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:3000` |
| `employer` | `/frontend` | `/frontend/railway.json` | `APP=employer`, `API_URL=…` (same) |
| `recruiter` | `/frontend` | `/frontend/railway.json` | `APP=recruiter`, `API_URL=…` (same) |
| `admin` | `/frontend` | `/frontend/railway.json` | `APP=admin`, `API_URL=…` (same) |

- **API service:**
  - Attach a **volume** mounted at `/data`. Resumes and logos are stored on disk, and they are lost on redeploy without it.
  - Leave the API without a public domain. The frontends reach it over Railway's private network.
- **Frontend services:** give each one a public domain (Settings → Networking → Generate domain). Each serves its Angular build with [`frontend/server.mjs`](frontend/server.mjs) and proxies `/api` to the API on the same origin. The refresh cookie is `SameSite=Strict`, so the API must not be called cross-origin.
- **Migrations** are not run on deploy. Run `npm run db:migrate` from a machine that has `DIRECT_URL`.

## Database (Supabase)

- All tables are in a **private `genzhire` schema**. Supabase's Data API (`anon` / `authenticated` roles) has no access to it; the migration revokes it explicitly. All access goes through the API, which enforces RBAC.
- The API connects as **`genzhire_app`**, a least-privilege role:
  - `search_path` is pinned on the role itself.
  - It has no UPDATE, DELETE or TRUNCATE on the append-only tables (audit log, access log, credit ledger, consents, login history, settings history).
  - Triggers enforce the same rule for every role.
- Migrations and seeding use the owner connection (`DIRECT_URL`).

```bash
cd backend
npm run db:migrate        # apply SQL migrations (prisma/migrations/*)
npm run db:seed           # roles/permissions, policies, pipeline stages, 122 skills, first admin (idempotent)
APP_DB_PASSWORD=... npm run db:setup-role   # (re)create genzhire_app; put its URL in DATABASE_URL
npm run db:pull && npm run db:generate      # after schema changes (SQL-first migrations)
npm run db:reset-dev      # DEV ONLY: wipe transactional data, keep admin + seed
```

Configuration lives in `backend/.env` (gitignored). `backend/.env.example` documents every variable.

## Tests

```bash
cd tests && npm install && npx playwright install chromium
# with the API running:
ADMIN_PASSWORD=... node api-e2e.mjs      # 74 API checks
# with the API + four apps running (ng serve, or: node serve-dist.mjs after `npm run build:all`):
ADMIN_PASSWORD=... node ui-e2e.mjs       # 26 browser checks, screenshots in tests/output/
cd ../backend && npm run db:reset-dev    # clean up the test data afterwards
```

The API suite covers:
- security: CSRF, audience isolation, tenant isolation, no contact data in search responses
- the MVP chain: register → verify → 50 credits → post → apply → review
- credits: 6 concurrent unlocks charge exactly 1 credit, repeat unlocks are free, the ledger matches
- contact requests
- the recruitment pipeline through to 90-day tracking, including the fee check ₹6,00,000 × 8.33% = ₹49,980
- refresh-token rotation and reuse detection
- audit hash-chain verification

The UI suite runs the same chain through the real screens and fails on any browser console error.

## What's built

| Area | Status |
|---|---|
| Auth | Register, login per app, refresh rotation with reuse detection, logout / logout-all, sessions list, login history, password change and reset, lockout, rate limits |
| RBAC | Deny-by-default guard (audience → permission → tenant scope). Role → permission matrix from `docs/08-rbac.md`, seeded to the DB |
| Candidate | 3-step onboarding, full profile (all sections), resumes with type sniffing and watermarked downloads, completion score, visibility levels, consents, blocked employers, "who viewed me", contact requests, preview-as-employer |
| Jobs and applications | Post, moderate, and auto-publish for verified employers. Public search and details. One-screen apply. Kanban and table with confirmed transitions. Candidate timeline. Notifications |
| Talent database | Postgres full-text + filter search, masked cards, locked/full/contact access levels, credit unlock transaction, saved candidates and folders, notes, compare API, usage ledger |
| Recruitment | Hiring requirements, admin opens a case (agreement snapshot), recruiter pipeline with a guard on each stage, submissions, interviews, offers, joining confirmed by both sides, 90-day tracker with reminders, automatic BILLABLE trigger, fee calculation |
| Admin | KPI dashboard and charts, users/candidates/employers/recruiters, verification queue (grants credits), job moderation with scam heuristics, requirements → cases, billing (waive), access logs, hash-chained audit log with verification, security alerts and abuse reports, settings editor with history |

## Not built yet (tracked in `docs/15-roadmap.md`)

- **MFA (TOTP)** for admin and recruiter. The design requires it, but it is not implemented yet. **Do this before production.**
- Email/SMS providers. Links are only logged today.
- Invoices (GST, gapless numbering, PDF) and payment recording (Phase 5). Billing records and fees exist.
- Team invitations for employers.
- Supabase Storage or S3 with malware scanning. Files are stored on local disk behind a storage abstraction and checked by magic bytes only.
- Angular SSR for SEO on public pages.
- Paid credits/subscriptions, AI matching, OpenSearch (Phase 6).

## Operational notes from testing

- **Region latency:** the Supabase project is in **Seoul (ap-northeast-2)**. The measured round trip from the development machine was about 116 ms per query. Deploy the API **in the same region as the database**, or move the database to Mumbai (ap-south-1) as planned in `docs/14-deployment.md`.
- **Use the session pooler (5432) with Prisma.** Through the transaction pooler (6543, `pgbouncer=true`), Prisma measured about 5× slower per query.
- **Server clocks:** the development machine's clock was 32 s ahead of the database. Code that compares validity windows now uses the database clock, but keep NTP enabled on API servers.
- **Rate limits** are in memory (per process). Use a Redis store before running more than one API instance.
