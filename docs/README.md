# GenZHire.work — Pre-Implementation Design Package

Product of **SISTECHWORK Private Limited**. Status: **DRAFT — awaiting approval. No implementation starts until this package is approved.**

| # | Deliverable | File |
|---|---|---|
| A | Product Requirements Document | [01-prd.md](01-prd.md) |
| B | Sitemap (all four applications) | [02-sitemap.md](02-sitemap.md) |
| C | User journeys | [03-user-journeys.md](03-user-journeys.md) |
| D | Database ER diagram | [04-er-diagram.md](04-er-diagram.md) |
| E | Database schema (runnable DDL) | [05-schema.sql](05-schema.sql) |
| — | Business rules: visibility, credits, verification, statuses, billing, audit events (spec §73 items 4–10) | [06-business-rules.md](06-business-rules.md) |
| F | API specification | [07-api-spec.md](07-api-spec.md) |
| G | RBAC matrix | [08-rbac.md](08-rbac.md) |
| H | Bounded-context / service architecture | [09-architecture.md](09-architecture.md) |
| I | UI/UX design system | [10-design-system.md](10-design-system.md) |
| J | Screen inventory | [11-screen-inventory.md](11-screen-inventory.md) |
| K | Component architecture (frontend + backend code layout) | [12-component-architecture.md](12-component-architecture.md) |
| L | Security & privacy architecture | [13-security.md](13-security.md) |
| M | Deployment architecture | [14-deployment.md](14-deployment.md) |
| N | Development roadmap | [15-roadmap.md](15-roadmap.md) |
| O | Testing strategy | [16-testing.md](16-testing.md) |

---

## Decisions that need sign-off

The spec leaves these open or says "consider". Each has a recommended default that the rest of the package already assumes. Changing one affects the documents listed in the last column.

| # | Decision | Recommended default | Why | Affects |
|---|---|---|---|---|
| D1 | When do the 50 free profile views get granted? | **When the employer is verified**, not at signup. The 50 views belong to the company account, not to each user. | Stops people signing up again and again to harvest resumes, which is the main abuse risk for a free allowance. | 06, 07 |
| D2 | Does opening the same candidate again cost another credit? | **No, for 90 days** (`profile_view.unlock_validity_days`). The unlock is shared by everyone on the employer's team. | Covers "repeated refreshes" and "saved profiles" from spec §19 with one rule. | 06, 05 |
| D3 | How do employers get a candidate's phone and email? | **The candidate approves a contact request.** An admin can switch this to `ENTITLEMENT` or `INCLUDED_WITH_UNLOCK`. | Matches the spec's "controlled candidate-contact mechanism" and India's DPDP consent rules. | 06, 07, 13 |
| D4 | Does downloading a resume cost a separate credit? | **No. It is included once the profile is unlocked**, with a cap of 20 downloads per user per day, and each PDF is watermarked with the employer's name. | Less friction. The watermark makes a leaked resume traceable to the employer who downloaded it. | 06, 13 |
| D5 | What name appears on search result cards? | **First name + last initial** ("Rahul K."). The full name shows after unlock. This is configurable. | **Differs from spec §22** (which shows the full name). Full names on cards make scraping easier. | 06, 11 |
| D6 | How long are the free views valid? | **12 months** from the grant date. | Stops unused credits from piling up forever. | 06 |
| D7 | What can an unverified employer do? | They can post jobs (each job waits for admin approval) and browse search cards. They **cannot unlock profiles** until verified. | Implements spec §35. | 06, 08 |
| D8 | Minimum candidate age | **18+**, confirmed by the candidate at signup. | Under DPDP, anyone under 18 needs verifiable parental consent. The product doesn't need minors. | 06, 13 |
| D9 | Candidate leaves before 90 days | Their billing record becomes `CANCELLED` and **nothing is billed**. Replacement terms follow the agreement. | The spec charges only after 90 days are completed. Legal/finance to confirm against the recruitment agreement. | 06 |
| D10 | Tax on consultant invoices | **18% GST** as a setting, with invoice numbers in the format `GZH/{FY}/{seq}`. | Finance to confirm GST treatment, SAC code and invoice format. | 05, 06 |
| D11 | Cloud / region | **AWS ap-south-1 (Mumbai)** | Low latency for Indian users and data stays in India. | 14 |
| D12 | ORM | **Drizzle ORM**. SQL-first migrations. | We need row locks, `ON CONFLICT`, `tsvector` search and partitioning without falling back to raw SQL. The alternative is Prisma. | 12 |
| D13 | Monorepo tool | **Nx** (Angular + NestJS in one workspace) | One design system shared by all four frontends. Changes can be scoped to what they affect. | 12, 14 |

## As built (2026-09-29) — where the implementation differs from these documents

| Decision / doc | Planned | Built | Why |
|---|---|---|---|
| D11 Hosting | AWS Mumbai | **Supabase Postgres, Seoul (ap-northeast-2)**, private `genzhire` schema, `genzhire_app` role | Product owner's choice of Supabase. Move to Mumbai, or run the API in Seoul, to cut the ~116 ms round trip. |
| D12 ORM | Drizzle | **Prisma 6** over SQL-first migrations (`prisma migrate deploy` + `db pull`), using the `relationJoins` preview feature | Product owner's Supabase setup used Prisma. Complex SQL (unlock, search, audit) runs through `$queryRaw`. |
| D13 Monorepo | Nx | **Angular CLI multi-project workspace** plus `libs/core` and `libs/ui` via TS path aliases | Fewer tools for the MVP. Module boundaries are kept by folder convention. |
| 13-security §3 | EdDSA JWT via KMS | **HS256** JWT with a 48-byte random secret in `.env` | No KMS yet. Swap when deploying. |
| 13-security §2 | TOTP MFA required for admin/recruiter | **Not implemented yet** | Must be done before production. |
| 13-security §8 | S3 quarantine + ClamAV | **Local disk** storage adapter, magic-byte sniffing, PDF script/encryption rejection | Supabase Storage keys not provided yet. |
| 09-architecture §3 | BullMQ worker + outbox | **In-process hourly scheduler** with an advisory lock; notifications written inline | No Redis yet. `outbox_events` exists for the move. |
| 12-component-architecture | Angular SSR for public pages | **SPA** (SSR not enabled yet) | Planned before SEO launch. |

## Where this package differs from the spec

- **Entitlements.** The spec's table list names `usage_entitlements`, while §18 names `employer_entitlements`. This package uses `employer_entitlements` (credit buckets) plus an append-only `entitlement_ledger`. `remaining_quantity` is computed by the database, so it cannot drift from the total and used counts.
- **Primary button colour.** White text on `#1683FF` has a contrast ratio of 3.7:1, below the 4.5:1 that WCAG AA requires for normal text. So buttons with text use the darker `#0A6BDB`, and `#1683FF` stays the brand accent (focus rings, icons, links on dark backgrounds, charts). Details are in [10-design-system.md](10-design-system.md#23-accessibility-corrections).
- **Organisation model.** The schema has both `employers` and `companies`. An **employer** is the account holder: it owns users, credits and verification. A **company** is the public brand shown on jobs. Today each employer has one company. The split lets a recruitment agency post jobs for several client companies later without a migration.
