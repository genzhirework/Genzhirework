# G. RBAC Matrix

## 1. Model

Access is decided in **three layers**. A request must pass all three, and anything not explicitly allowed is denied.

1. **Audience (which app).** The access token's `aud` claim must be one of the audiences the route allows. For example, an employer token is rejected on `/api/v1/admin/*` even if the same person also holds ADMIN.
2. **Permission (what action).** Permission codes are granted through `roles → role_permissions`. Every controller handler must carry a `@RequirePermission('…')` decorator. A CI test lists every route and **fails if any route has no permission, `@Public()` or `@SelfOnly()` marker**.
3. **Scope (which rows).** Policy functions in the domain services, such as `CandidateAccessPolicy` and `TenantScope`, restrict queries. Employer queries are always filtered by `employer_id` taken from the token's `employer_users` membership, **never from the request**.

Adding a role later (such as MODERATOR) is a data change: insert the role and its permission rows. No code changes. Each role stores `requires_mfa`.

Employer users additionally have a **company role** (`employer_users.company_role`). The platform role `EMPLOYER` gives access to the employer app. The company role then narrows which employer permissions apply:

| Company role | Employer permissions it keeps |
|---|---|
| `COMPANY_ADMIN` | all EMPLOYER permissions |
| `HR_MANAGER` | all except `employer.team.manage` and `employer.verification.submit` |
| `COMPANY_RECRUITER` | jobs.manage (only jobs they posted, or jobs shared with them), applications.*, talent.* except `talent.unlock` if the admin turns it off, requirements.read |
| `VIEWER` | read-only permissions |

## 2. Roles

| Role | App | MFA | Notes |
|---|---|---|---|
| `JOBSEEKER` | genzhire.work | optional | |
| `EMPLOYER` | employer. | optional (recommended to COMPANY_ADMIN) | Scoped by company role |
| `RECRUITER` | recruiter. | **required** | SISTECHWORK staff only. Accounts are created by an admin, never through self-signup. |
| `ADMIN` | admin. | **required** | |
| `SUPER_ADMIN` *(future)* | admin. | required + WebAuthn | The only role that can grant ADMIN or change security settings |
| `MODERATOR` *(future)* | admin. | required | Only the job moderation, verification and abuse queues |
| `RECRUITMENT_AGENCY` *(future)* | employer. | optional | An employer with `account_type=AGENCY` and several companies |

## 3. Permission matrix

✓ = allowed · S = only on their own records · T = only within their employer (tenant) · A = only on cases assigned to them · ✗ = denied

| Permission code | JOBSEEKER | EMPLOYER | RECRUITER | ADMIN |
|---|---|---|---|---|
| **Identity** | | | | |
| `auth.session.manage` | S | S | S | S |
| `users.read` / `users.manage` | ✗ | ✗ | ✗ | ✓ |
| `users.roles.assign` | ✗ | ✗ | ✗ | ✓ (SUPER_ADMIN later) |
| **Candidate data** | | | | |
| `candidate.profile.edit` | S | ✗ | ✗ | ✗ (admin may only hide or anonymise, as moderation) |
| `candidate.privacy.manage` | S | ✗ | ✗ | ✗ |
| `candidate.applications.manage` | S | ✗ | ✗ | ✗ |
| `candidate.contact_requests.respond` | S | ✗ | ✗ | ✗ |
| **Jobs** | | | | |
| `jobs.read.public` | ✓ | ✓ | ✓ | ✓ |
| `jobs.manage` | ✗ | T | ✗ | ✓ |
| `jobs.moderate` | ✗ | ✗ | ✗ | ✓ |
| `jobs.apply` | S | ✗ | ✗ | ✗ |
| **Applications** | | | | |
| `applications.read` | S | T | A (applications to the case employer's jobs) | ✓ |
| `applications.manage` | ✗ | T | ✗ | ✓ (read-mostly; changes are audited) |
| **Talent database** | | | | |
| `talent.search` | ✗ | T | ✓ | ✓ |
| `talent.view` (locked preview) | ✗ | T | ✓ | ✓ |
| `talent.unlock` (uses a credit) | ✗ | T + verified | ✗ (not needed: access comes from the case) | ✗ (not needed: admin reads through ADMIN basis, audited) |
| `talent.resume.download` | ✗ | T + FULL | A | ✓ (audited) |
| `talent.contact` | ✗ | T | A | ✓ (audited) |
| `talent.save` / `talent.note` / `talent.share` | ✗ | T | A (own notes) | ✗ |
| **Employer account** | | | | |
| `employer.dashboard.read` / `employer.analytics.read` | ✗ | T | ✗ | ✓ |
| `employer.company.manage` | ✗ | T | ✗ | ✓ |
| `employer.team.manage` | ✗ | T (COMPANY_ADMIN) | ✗ | ✓ |
| `employer.verification.submit` | ✗ | T (COMPANY_ADMIN) | ✗ | ✗ |
| `employer.verification.review` | ✗ | ✗ | ✗ | ✓ |
| `employer.usage.read` | ✗ | T | ✗ | ✓ |
| `entitlements.manage` | ✗ | ✗ | ✗ | ✓ |
| **Recruitment** | | | | |
| `requirements.manage` | ✗ | T | ✗ | ✓ |
| `requirements.read` | ✗ | T | A | ✓ |
| `requirements.assign` | ✗ | ✗ | ✗ | ✓ |
| `recruitment.pipeline.manage` | ✗ | ✗ | A | ✓ |
| `recruitment.review` (accept submissions, confirm joining) | ✗ | T | ✗ | ✓ |
| `recruitment.joining.confirm` | ✗ | T (employer side) | A (recruiter side) | ✓ |
| `recruitment.stages.configure` | ✗ | ✗ | ✗ | ✓ |
| **Billing** | | | | |
| `billing.read` | ✗ | T (their invoices) | A (read-only, no amounts from other cases) | ✓ |
| `billing.manage` (agreements, invoices, payments) | ✗ | ✗ | ✗ | ✓ |
| **Platform** | | | | |
| `notifications.read` | S | S | S | S |
| `audit.read` / `access_logs.read` | ✗ | ✗ | ✗ | ✓ |
| `access_logs.export` | ✗ | ✗ | ✗ | ✓ (itself audited) |
| `settings.manage` | ✗ | ✗ | ✗ | ✓ |
| `abuse.report` | ✓ | ✓ | ✓ | ✓ |
| `abuse.moderate` / `security.alerts.manage` | ✗ | ✗ | ✗ | ✓ |
| `privacy.dsr.manage` | ✗ | ✗ | ✗ | ✓ |

## 4. Candidate access policy (pseudocode)

This function is the only place that decides how much of a candidate profile a caller may see. The search, profile, resume and contact endpoints all call it.

```ts
resolveCandidateAccess(viewer, candidateId): AccessDecision {
  const c = candidates.findActive(candidateId);             // excludes deleted
  if (!c) return NOT_FOUND;

  switch (viewer.audience) {
    case 'employer': {
      const emp = viewer.employer;                           // from membership, not the request
      if (emp.status !== 'ACTIVE') return FORBIDDEN;
      if (blockedEmployers.has(c.id, emp.id)) return NOT_FOUND;
      if (applications.exists(c.id, emp.id))    return FULL('APPLICATION');
      if (submissions.exists(c.id, emp.id))     return FULL('RECRUITER_SUBMISSION');
      if (c.visibility === 'HIDDEN' || c.visibility === 'APPLICATION_ONLY') return NOT_FOUND;
      if (!c.searchable) return NOT_FOUND;
      if (unlocks.active(emp.id, c.id))         return FULL('ACTIVE_UNLOCK');
      return LOCKED({ canUnlock: emp.verified && viewer.can('talent.unlock') });
    }
    case 'recruiter': {
      if (cases.assignedCandidate(viewer.recruiterId, c.id)) return FULL('RECRUITER_CASE');
      if (c.searchable) return LOCKED({ canAddToCase: true });
      if (applications.toEmployerWithAssignedCase(c.id, viewer.recruiterId)) return LOCKED({ canAddToCase: true });
      return NOT_FOUND;
    }
    case 'admin':
      return FULL('ADMIN');                                  // always logged in the access log
    default:
      return FORBIDDEN;
  }
}
```

Access through an application covers the whole employer (tenant). `HIDDEN` does not remove access that already exists through an application or a recruiter submission.

## 5. Tests that enforce this matrix

- **Generated authorization tests.** For every route × each of the 4 audiences × each relevant company role, there is an expected allow/deny result derived from this matrix. The suite fails on any mismatch or on any route missing from the matrix.
- **Cross-tenant (IDOR) tests.** Employer A asks for Employer B's job, application, folder, note or ledger by ID → 404 every time.
- **Audience confusion tests.** Each app's token is sent to every other app's routes → 403.
