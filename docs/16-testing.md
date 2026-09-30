# O. Testing Strategy

## 1. Test pyramid & tooling

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Jest (API), Vitest/Jest (Angular) | Domain policies, state machines, fee maths, date maths, serializers, stores, pipes | every PR |
| Component | Angular Testing Library + Storybook interaction tests + **axe** | Every `libs/ui` component, and feature components in each state (loading/empty/error/403/404) | every PR |
| Integration | Jest + **Testcontainers** (real Postgres 17, Redis, MinIO) | Use cases through the repositories, transactions, constraints, the outbox, and queue consumers | every PR |
| Contract | OpenAPI diff (`oasdiff`) + generated client compile | API compatibility | every PR |
| Authorization | Generated from [08-rbac.md](08-rbac.md) | Every route × audience × company role → allow/deny, IDOR, audience confusion | every PR |
| End-to-end | **Playwright** (Chromium, WebKit, mobile viewport 375) | Critical journeys J1–J7 on staging-like data | PR smoke; full on `main` |
| Visual regression | Playwright screenshots of Storybook stories (3 themes) | Design-system drift | every PR touching `libs/ui` |
| Performance | **k6** | Candidate search, job search, apply, unlock under load | nightly on staging + before release |
| Security | Semgrep, gitleaks, Trivy, npm audit, OWASP ZAP baseline; a third-party pen test before MVP launch and every year after | | PR / release / yearly |
| Accessibility | axe (automated) + a manual screen-reader pass (NVDA + VoiceOver) per release on the 12 key screens | WCAG 2.2 AA | release |

**Coverage targets.** Domain and application layers ≥ 90% lines, and **100% of the transitions in each state machine**. Overall ≥ 75%. Coverage is a guardrail, not the goal. The critical-behaviour tests below must exist whatever the percentage says.

## 2. Critical-behaviour tests (must exist before the related feature ships)

### Entitlements (the §68 question "does the 50-profile entitlement work?")

1. First unlock uses 1 credit, and the ledger, the access log and the audit log each gain exactly one row.
2. Unlocking again within the window: no credit used, access basis `ACTIVE_UNLOCK`.
3. Another user from the same employer: no credit used.
4. After the window expires: 1 credit used, and the unlock row is renewed.
5. **Concurrency:** 20 parallel unlock requests for the *same* candidate → exactly 1 credit used. 60 parallel unlocks of *different* candidates against 50 credits → exactly 50 succeed and 10 get `NO_CREDITS`, and `used_quantity` never exceeds `total_quantity`. This runs against real Postgres with a connection pool (Testcontainers), not PGlite.
6. Bucket choice: the bucket expiring first is used first. Expired buckets are ignored.
7. Unverified employer → 403 with no DB writes. Candidate blocked or hidden → 404 with no DB writes.
8. Idempotency: the same key sent twice → the same response and one credit.
9. Refund and adjust keep the reconciler invariant. The reconciler finds a deliberately corrupted row.
10. The free grant happens only once, even if an employer is verified, suspended and then reinstated.

### Candidate data exposure

- **Serializer snapshot tests.** For each access level (card, locked, full, contact), the JSON has exactly the allowed fields. A new field on the profile model fails the test until it has been assigned to a level.
- Search responses never contain `email`, `phone`, `lastName`, `resume` or `links`. A property-based test over random profiles checks this.
- `APPLICATION_ONLY`, `HIDDEN`, withdrawn consent and the blocked-employer list each remove the candidate from search within one indexer cycle. The blocked-employer check also applies immediately at query time.

### Billing

- Fee: ₹6,00,000 × 8.33% = ₹49,980. Rounding is half-up at the paise level. Checked with property tests over CTC ranges.
- Due date = joining + trigger days (calendar days), with dates in Asia/Kolkata. Tests cover year-end and leap years (joining 2027-12-15 → 2028-03-14).
- Changing `billing.consultant_fee_percentage` does not change existing billing rows.
- Left before the due date → CANCELLED. No BILLABLE without the day-85 "still employed" confirmation.
- Invoice numbers are gapless under concurrent issuing and roll over at the FY boundary (1 April). CGST+SGST vs. IGST depends on the place of supply.

### State machines

Table-driven tests generated from the transition tables in [06-business-rules.md](06-business-rules.md): every allowed transition succeeds, and every other pair returns `INVALID_TRANSITION`. The pipeline's semantic guards are tested too (for example, OFFER can't be entered without an offer row).

### Security

- Auth: lockout, refresh-token reuse revokes the session family, logout-all takes effect in under 1 second, and admin routes reject a token without MFA.
- Rate limits return 429 with `Retry-After` at the configured thresholds.
- File pipeline: EICAR test file → INFECTED; a PDF containing JavaScript → REJECTED; a `.exe` renamed to `.pdf` → REJECTED by the type sniff.
- Audit: the app role cannot UPDATE or DELETE `audit_logs`. The hash-chain checker detects a tampered row.

## 3. Test data

- **Factories** (`tools/factories`) build valid aggregates: `aCandidate().withSkills('Python','SQL').graduated(2026)`.
- **Seed profiles** for staging and load tests: 500k synthetic candidates generated with realistic distributions (Indian cities, degrees, skills), 10k employers, 50k jobs. There is never any production personal data outside production.
- Honeytoken fixtures are included, so the tests confirm they never appear in KPIs.

## 4. Performance budgets (k6, staging, 500k candidates)

| Scenario | Load | p95 budget |
|---|---|---|
| Candidate search, mixed filters | 50 req/s | 800 ms |
| Job search (anonymous) | 100 req/s | 300 ms |
| Unlock | 10 req/s | 300 ms |
| Apply | 20 req/s | 400 ms |
| Public job page (SSR, cached) | 200 req/s | TTFB 200 ms |

## 5. Release quality gates

A release is blocked if any of these holds:
- a failing test in the suites above;
- a new high or critical finding from Semgrep, Trivy or ZAP;
- an axe violation on the key screens;
- a breaking OpenAPI change without a version bump;
- a p95 budget regression greater than 20%;
- the entitlement reconciler reports a mismatch in staging.
