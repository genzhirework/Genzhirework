# K. Component Architecture

## 1. Repository layout (Nx monorepo)

```
genzhire/
├─ apps/
│  ├─ web/                 Angular SSR — genzhire.work (public + jobseeker)
│  ├─ employer/            Angular SPA — employer.genzhire.work
│  ├─ recruiter/           Angular SPA — recruiter.genzhire.work
│  ├─ admin/               Angular SPA — admin.genzhire.work
│  ├─ api/                 NestJS HTTP API (modular monolith)
│  ├─ worker/              NestJS standalone app: BullMQ consumers + schedulers + outbox relay
│  └─ e2e/                 Playwright suites per app
├─ libs/
│  ├─ ui/                  Design system (tokens, components, Storybook)          tag: scope:shared,type:ui
│  ├─ contracts/           Generated OpenAPI client + shared enums/status maps    tag: scope:shared,type:contracts
│  ├─ web-shared/          Frontend infra: auth, http interceptors, error pages,
│  │                       permission directive, i18n, formatters (₹, dates)      tag: scope:shared,type:util
│  ├─ feature-talent/      Candidate card/profile views shared by employer,
│  │                       recruiter, admin and the candidate "preview"           tag: scope:shared,type:feature
│  ├─ web/feature-*/       Jobseeker features (jobs, apply, profile, settings…)   tag: scope:web
│  ├─ employer/feature-*/  tag: scope:employer
│  ├─ recruiter/feature-*/ tag: scope:recruiter
│  ├─ admin/feature-*/     tag: scope:admin
│  └─ server/
│     ├─ kernel/           audit, outbox, files, settings, idempotency, errors, db   tag: scope:server,type:kernel
│     ├─ identity/  candidate/  employer/  jobs/  applications/
│     ├─ talent/  recruitment/  billing/  notifications/  administration/
│     │                    one Nx lib per bounded context                          tag: scope:server,type:context
│     └─ db/               Drizzle schema, migrations, seeds
├─ tools/                  generators, the RBAC-matrix test generator, contrast checker
└─ docs/                   this package
```

**Module boundary rules** (`@nx/enforce-module-boundaries`):

- `scope:employer` may depend on `scope:shared` only, never on `scope:admin`, and likewise for the other apps.
- `type:context` may depend on `type:kernel` and on **the public `index.ts`** of the contexts listed upstream of it in [09-architecture.md](09-architecture.md#dependency-rules-checked-in-ci-with-nx-enforce-module-boundaries-tags).
- Frontend libraries may never import `scope:server`.

## 2. Frontend architecture (Angular)

- **Standalone components, signals for local and feature state, RxJS for streams** (HTTP, SSE, debounced search). Zoneless change detection where the Angular version supports it as stable.
- **No global store library** in the MVP. Each feature has a `*.store.ts` (an injectable service built on signals) that exposes `state`, `computed` selectors and `methods`. Add NgRx SignalStore only if a feature grows past that.
- **Data access.** The generated client in `libs/contracts` (ng-openapi-gen) is wrapped by a small repository per feature. Components never call `HttpClient` directly.
- **Routing.** Lazy-loaded feature routes. `canMatch` guards check the session and permissions for **UX only**. The server enforces everything.
- **Forms.** Typed Reactive Forms. The validators mirror the server's DTO rules (length, format), and the server's `errors[]` are mapped back onto fields by the `ProblemDetailsFormAdapter`.
- **HTTP interceptors** (in `web-shared`):
  1. `authInterceptor` attaches the access token. On a 401 it runs a single-flight refresh and retries once.
  2. `csrfInterceptor` sets `X-Requested-With`.
  3. `idempotencyInterceptor` adds a key to the endpoints that require one.
  4. `problemInterceptor` turns problem+json into typed `AppError`s, which feed the toast service or the page error state.
- **Page state pattern.** Every routed page renders through `<gh-page-state [status]>`, which chooses between content, skeleton, empty, error, 403 and 404. This makes "never a blank page" (spec §52) structural rather than something each page has to remember.
- **SSR (apps/web only).** Pages to server-render: homepage, `/jobs`, job details, company pages, legal. Authenticated `/app/*` routes render on the client. `TransferState` avoids fetching data twice after hydration.
- **Shared talent views.** `libs/feature-talent` holds `CandidateCardComponent`, `CandidateProfileComponent` (inputs: `profile`, `accessLevel`, `mode: 'employer'|'recruiter'|'admin'|'self-preview'`). The candidate's "preview as employer" uses the same components as the employer app, so the preview cannot show something different from what employers actually see.

### Example: employer talent feature slice

```
libs/employer/feature-talent-search/
├─ talent-search.routes.ts
├─ talent-search.page.ts           // shell: toolbar + filters + results; uses <gh-page-state>
├─ talent-search.store.ts          // signals: query, results, cursor, credits; rxMethod for search
├─ components/
│  ├─ search-filters.component.ts  // reactive form ↔ CandidateSearchQuery
│  └─ results-list.component.ts    // uses libs/feature-talent CandidateCard
└─ talent-search.store.spec.ts
```

## 3. Backend architecture (NestJS)

Each context library has the same internal shape:

```
libs/server/talent/src/
├─ index.ts                     // PUBLIC: TalentModule, TalentFacade, event types
├─ talent.module.ts
├─ api/                         // controllers + request/response DTOs (class-validator + swagger)
│  ├─ candidate-search.controller.ts
│  └─ candidate-access.controller.ts
├─ application/                 // use cases (one class per command/query)
│  ├─ unlock-candidate.command.ts
│  ├─ search-candidates.query.ts
│  └─ ...
├─ domain/                      // pure TS, no Nest/DB imports: policies, value objects, state machines
│  ├─ candidate-access.policy.ts
│  ├─ credit-consumption.ts
│  └─ unlock-rules.ts
├─ infrastructure/
│  ├─ postgres-candidate-search.adapter.ts   // implements CandidateSearchPort
│  ├─ entitlement.repository.ts
│  └─ search-indexer.consumer.ts             // (registered in worker only)
└─ talent.facade.ts             // what other contexts may call
```

**Cross-cutting request pipeline** (applied globally in `apps/api`):

```
Helmet headers → request-id → body size limit → rate limiter (Redis, per route policy)
→ AuthGuard (JWT verify, aud check, session not revoked, MFA claim if role requires)
→ PermissionGuard (@RequirePermission / @Public / @SelfOnly — missing = deny)
→ ValidationPipe (whitelist: true, forbidNonWhitelisted: true, transform)
→ IdempotencyInterceptor → controller → use case (transaction via UnitOfWork)
→ ProblemDetailsFilter (maps domain errors → problem+json; hides internals)
```

**Transactions.** A `UnitOfWork` gives each use case a Drizzle transaction. `AuditLog.record()` and `Outbox.publish()` take that transaction as an argument, so the change, its audit row and its event are committed together or not at all.

**Configuration.** Typed `ConfigModule` for environment variables (secrets come from AWS Secrets Manager at boot). `SettingsService` provides the business settings from `system_settings`, cached in Redis for 60 seconds and cleared on the `settings.changed` event. **Business rules never read `process.env`.**

**Why Drizzle (decision D12).** The core flows need `ON CONFLICT … WHERE`, `FOR UPDATE`, generated columns, `tsvector`, array operators and partitioned tables. Drizzle expresses all of these in typed SQL and keeps migrations as plain SQL files. With Prisma, each of these would need raw queries. If the team prefers Prisma, only the `infrastructure/` folders change, because the domain and application layers don't import the ORM.

## 4. Shared contracts

- Status enums and their display maps live in `libs/contracts/status/*.ts`, for example `APPLICATION_STATUS = { APPLIED: { candidateLabel: 'Applied', employerLabel: 'Applied', tone: 'neutral' }, … }`. `StatusBadge` in both the frontend and the email templates reads these maps, so the wording stays consistent (spec §75 "inconsistent terminology").
- The OpenAPI document is generated in CI (`nx run api:openapi`) and diffed against `main` with `oasdiff`. A breaking change fails the build unless the version is raised.
