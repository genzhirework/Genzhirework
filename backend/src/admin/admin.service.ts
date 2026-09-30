import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuthService } from '../auth/auth.service';
import { AuditService, canonicalJson } from '../common/audit.service';
import { grantEntitlement } from '../common/entitlements';
import { AuthGuard } from '../common/auth.guard';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import type { Principal, RequestMeta } from '../common/decorators';
import { badRequest, conflict, notFound, unprocessable } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { loadCandidate, presentCandidate } from '../candidate/profile.presenter';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
    private readonly auth: AuthService,
    private readonly guard: AuthGuard,
  ) {}

  // --------------------------------------------------------------- dashboard

  async metrics(from?: string, to?: string) {
    const f = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const t = to ? new Date(to) : new Date();
    const [m] = await this.prisma.$queryRaw<any[]>`
      SELECT
        (SELECT count(*)::int FROM candidates c WHERE NOT c.is_honeytoken AND c.deleted_at IS NULL) AS total_jobseekers,
        (SELECT count(*)::int FROM candidates c WHERE NOT c.is_honeytoken AND c.created_at BETWEEN ${f} AND ${t}) AS new_jobseekers,
        (SELECT count(*)::int FROM employers WHERE status = 'ACTIVE') AS active_employers,
        (SELECT count(*)::int FROM employers WHERE verification_status = 'VERIFIED') AS verified_employers,
        (SELECT count(*)::int FROM employer_verification WHERE status IN ('SUBMITTED','IN_REVIEW')) AS pending_verifications,
        (SELECT count(*)::int FROM jobs WHERE status = 'PUBLISHED') AS active_jobs,
        (SELECT count(*)::int FROM jobs WHERE status = 'PENDING_APPROVAL') AS pending_jobs,
        (SELECT count(*)::int FROM applications WHERE applied_at BETWEEN ${f} AND ${t}) AS applications,
        (SELECT count(*)::int FROM candidate_profile_views WHERE action = 'FULL_PROFILE_VIEW' AND created_at BETWEEN ${f} AND ${t}) AS profile_views,
        (SELECT coalesce(sum(-delta), 0)::int FROM entitlement_ledger l JOIN employer_entitlements e ON e.id = l.entitlement_id
          WHERE l.reason = 'CONSUME' AND e.source = 'FREE_ON_VERIFICATION' AND l.created_at BETWEEN ${f} AND ${t}) AS free_views_consumed,
        (SELECT count(*)::int FROM hiring_requirements WHERE status IN ('SUBMITTED','UNDER_REVIEW','ACTIVE','ON_HOLD')) AS open_requirements,
        (SELECT count(*)::int FROM recruitment_cases WHERE status IN ('OPEN','ON_HOLD')) AS active_cases,
        (SELECT count(*)::int FROM candidate_joinings WHERE tracking_status IN ('TRACKING','COMPLETED')) AS candidates_hired,
        (SELECT count(*)::int FROM candidate_joinings WHERE tracking_status = 'TRACKING') AS in_tracking,
        (SELECT count(*)::int FROM consultant_billing WHERE status = 'BILLABLE') AS billable,
        (SELECT count(*)::int FROM invoices WHERE status IN ('ISSUED','PARTIALLY_PAID','OVERDUE')) AS pending_invoices,
        (SELECT count(*)::int FROM invoices WHERE status = 'PAID') AS paid_invoices,
        (SELECT count(*)::int FROM security_alerts WHERE status = 'OPEN') AS open_alerts,
        (SELECT count(*)::int FROM abuse_reports WHERE status IN ('OPEN','INVESTIGATING')) AS open_reports`;
    const series = await this.prisma.$queryRaw<any[]>`
      WITH days AS (SELECT generate_series(${f}::date, ${t}::date, interval '1 day')::date AS d)
      SELECT d AS day,
        (SELECT count(*)::int FROM users u WHERE u.created_at::date = d) AS registrations,
        (SELECT count(*)::int FROM jobs j WHERE j.published_at::date = d) AS jobs,
        (SELECT count(*)::int FROM applications a WHERE a.applied_at::date = d) AS applications,
        (SELECT count(*)::int FROM analytics_events e WHERE e.event_name = 'talent.search_performed' AND e.occurred_at::date = d) AS searches,
        (SELECT count(*)::int FROM candidate_profile_views v WHERE v.action = 'FULL_PROFILE_VIEW' AND v.created_at::date = d) AS profile_views
      FROM days ORDER BY d`;
    return { ...m, series, from: f, to: t };
  }

  // ------------------------------------------------------------------ users

  users(q?: string, role?: string, status?: string, cursor?: string) {
    return this.page('users', cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT u.id, u.email, u.full_name, u.status, u.created_at, u.last_login_at, u.email_verified_at IS NOT NULL AS email_verified,
             array_agg(r.code) AS roles
      FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE (${q ?? null}::text IS NULL OR u.email ILIKE ${'%' + (q ?? '') + '%'} OR u.full_name ILIKE ${'%' + (q ?? '') + '%'})
        AND (${status ?? null}::text IS NULL OR u.status = ${status ?? null})
      GROUP BY u.id
      HAVING (${role ?? null}::text IS NULL OR ${role ?? null} = ANY(array_agg(r.code)))
      ORDER BY u.created_at DESC LIMIT 51 OFFSET ${offset}`);
  }

  private async page(key: string, cursor: string | undefined, fetch: (offset: number) => Promise<any[]>) {
    const binding = `admin:${key}`;
    const offset = decodeCursor<{ o: number }>(cursor, binding)?.o ?? 0;
    const rows = await fetch(offset);
    return { data: rows.slice(0, 50), page: { nextCursor: rows.length > 50 ? encodeCursor({ o: offset + 50 }, binding) : null, limit: 50 } };
  }

  async user(id: string) {
    const u = await this.prisma.users.findUnique({
      where: { id },
      select: {
        id: true, email: true, full_name: true, status: true, status_reason: true, created_at: true, last_login_at: true,
        email_verified_at: true, mfa_enabled: true, failed_login_count: true, locked_until: true,
        user_roles_user_roles_user_idTousers: { select: { roles: { select: { code: true } }, granted_at: true } },
      },
    });
    if (!u) throw notFound('User');
    const [logins, sessions, activity] = await Promise.all([
      this.prisma.login_history.findMany({ where: { user_id: id }, orderBy: { created_at: 'desc' }, take: 25 }),
      this.prisma.sessions.findMany({ where: { user_id: id, revoked_at: null, expires_at: { gt: new Date() } }, select: { id: true, app: true, ip_address: true, user_agent: true, last_used_at: true } }),
      this.prisma.audit_logs.findMany({ where: { actor_id: id }, orderBy: { created_at: 'desc' }, take: 25, select: { action: true, entity_type: true, entity_id: true, created_at: true } }),
    ]);
    return { ...u, roles: u.user_roles_user_roles_user_idTousers.map((r) => r.roles.code), user_roles_user_roles_user_idTousers: undefined, logins, sessions, activity };
  }

  async setUserStatus(admin: Principal, id: string, status: 'SUSPENDED' | 'ACTIVE', reason: string, meta: RequestMeta) {
    if (id === admin.userId) throw unprocessable('SELF_ACTION', 'You cannot change your own account status');
    const u = await this.prisma.users.findUnique({ where: { id } });
    if (!u) throw notFound('User');
    const sessions = await this.prisma.tx(async (tx) => {
      await tx.users.update({ where: { id }, data: { status, status_reason: reason, updated_at: new Date() } });
      let revoked: { id: string }[] = [];
      if (status === 'SUSPENDED') {
        revoked = await tx.sessions.findMany({ where: { user_id: id, revoked_at: null }, select: { id: true } });
        await tx.sessions.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: 'SUSPENDED' } });
      }
      await this.audit.record(tx, admin, meta, { action: status === 'SUSPENDED' ? 'user.suspended' : 'user.reactivated', entityType: 'user', entityId: id, metadata: { reason } });
      return revoked;
    });
    sessions.forEach((s) => this.guard.forgetSession(s.id));
    return { id, status };
  }

  // -------------------------------------------------------------- employers

  employers(q?: string, verification?: string, cursor?: string) {
    return this.page('employers', cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT e.id, e.name, e.status, e.verification_status, e.primary_domain, e.created_at, e.verified_at,
             (SELECT count(*)::int FROM jobs j WHERE j.employer_id = e.id AND j.status = 'PUBLISHED') AS active_jobs,
             (SELECT count(*)::int FROM employer_users m WHERE m.employer_id = e.id AND m.status = 'ACTIVE') AS members,
             (SELECT coalesce(sum(remaining_quantity), 0)::int FROM employer_entitlements x WHERE x.employer_id = e.id AND x.valid_until > now()) AS credits_remaining
      FROM employers e
      WHERE (${q ?? null}::text IS NULL OR e.name ILIKE ${'%' + (q ?? '') + '%'} OR e.primary_domain ILIKE ${'%' + (q ?? '') + '%'})
        AND (${verification ?? null}::text IS NULL OR e.verification_status = ${verification ?? null})
      ORDER BY e.created_at DESC LIMIT 51 OFFSET ${offset}`);
  }

  async employer(id: string) {
    const e = await this.prisma.employers.findUnique({ where: { id }, include: { companies: true } });
    if (!e) throw notFound('Employer');
    const [team, verifications, entitlements, ledger, jobs, access] = await Promise.all([
      this.prisma.employer_users.findMany({ where: { employer_id: id }, select: { company_role: true, status: true, designation: true, users_employer_users_user_idTousers: { select: { id: true, email: true, full_name: true, last_login_at: true } } } }),
      this.prisma.employer_verification.findMany({ where: { employer_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.employer_entitlements.findMany({ where: { employer_id: id }, orderBy: { created_at: 'desc' } }),
      this.prisma.entitlement_ledger.findMany({ where: { employer_id: id }, orderBy: { created_at: 'desc' }, take: 50 }),
      this.prisma.jobs.findMany({ where: { employer_id: id }, orderBy: { created_at: 'desc' }, take: 50, select: { id: true, title: true, status: true, created_at: true, published_at: true } }),
      this.prisma.$queryRaw<any[]>`
        SELECT v.action, v.access_basis, v.credits_consumed, v.created_at, c.first_name || ' ' || c.last_name AS candidate_name, u.email AS viewer
        FROM candidate_profile_views v JOIN candidates c ON c.id = v.candidate_id JOIN users u ON u.id = v.viewer_user_id
        WHERE v.employer_id = ${id}::uuid ORDER BY v.created_at DESC LIMIT 50`,
    ]);
    return { ...e, team, verifications, entitlements, ledger, jobs, access };
  }

  verificationQueue(status = 'OPEN') {
    const statuses = status === 'OPEN' ? ['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO'] : [status];
    return this.prisma.$queryRaw<any[]>`
      SELECT v.*, e.name AS employer_name, e.primary_domain, e.verification_status AS employer_status, u.email AS submitted_by_email,
             co.website AS company_website
      FROM employer_verification v JOIN employers e ON e.id = v.employer_id JOIN users u ON u.id = v.submitted_by
      LEFT JOIN LATERAL (SELECT website FROM companies WHERE employer_id = e.id ORDER BY created_at LIMIT 1) co ON true
      WHERE v.status = ANY(${statuses}) ORDER BY v.created_at ASC LIMIT 200`;
  }

  /** Approval grants the one-time free credits (D1) — idempotent via a unique index. */
  async decideVerification(admin: Principal, id: string, decision: 'approve' | 'reject' | 'request-info' | 'start-review', reason: string | undefined, meta: RequestMeta) {
    const v = await this.prisma.employer_verification.findUnique({ where: { id } });
    if (!v) throw notFound('Verification');
    if (['APPROVED', 'REJECTED'].includes(v.status)) throw conflict('ALREADY_DECIDED', 'This verification has already been decided');
    if ((decision === 'reject' || decision === 'request-info') && !reason?.trim()) throw unprocessable('REASON_REQUIRED', 'A reason is required');
    const status = { approve: 'APPROVED', reject: 'REJECTED', 'request-info': 'NEEDS_INFO', 'start-review': 'IN_REVIEW' }[decision];
    const freeViews = await this.settings.num('entitlements.free_profile_views');
    const validityDays = await this.settings.num('entitlements.free_validity_days');

    await this.prisma.tx(async (tx) => {
      await tx.employer_verification.update({
        where: { id },
        data: { status, reviewer_id: admin.userId, decision_reason: reason ?? null, ...(['APPROVED', 'REJECTED'].includes(status) && { decided_at: new Date() }) },
      });
      if (decision === 'approve') {
        await tx.employers.update({ where: { id: v.employer_id }, data: { verification_status: 'VERIFIED', verified_at: new Date(), updated_at: new Date() } });
        const existing = await tx.employer_entitlements.findFirst({ where: { employer_id: v.employer_id, entitlement_type: 'CANDIDATE_PROFILE_VIEW', source: 'FREE_ON_VERIFICATION' } });
        if (!existing && freeViews > 0) {
          await grantEntitlement(tx, {
            employerId: v.employer_id, quantity: freeViews, validDays: validityDays, source: 'FREE_ON_VERIFICATION',
            grantedBy: admin.userId, referenceType: 'verification', referenceId: id, note: 'Free profile views on verification',
          });
          await this.audit.record(tx, admin, meta, { action: 'entitlement.granted', entityType: 'employer', entityId: v.employer_id, employerId: v.employer_id, metadata: { quantity: freeViews, source: 'FREE_ON_VERIFICATION' } });
        }
      }
      if (decision === 'reject') await tx.employers.update({ where: { id: v.employer_id }, data: { verification_status: 'REJECTED', updated_at: new Date() } });
      await this.audit.record(tx, admin, meta, {
        action: decision === 'approve' ? 'employer.verified' : decision === 'reject' ? 'employer.verification_rejected' : `employer.verification_${status.toLowerCase()}`,
        entityType: 'employer', entityId: v.employer_id, employerId: v.employer_id, metadata: { verificationId: id },
      });
      if (decision !== 'start-review') {
        await this.notify.toEmployer(v.employer_id, {
          type: 'VERIFICATION_UPDATE',
          title: decision === 'approve' ? `Your company is verified — ${freeViews} free profile views added` : decision === 'reject' ? 'Verification was not approved' : 'More information needed for verification',
          body: reason ?? 'You can now unlock candidate profiles in Find talent.',
          link: '/company/verification',
        }, tx);
      }
    });
    return { id, status };
  }

  async grantCredits(admin: Principal, employerId: string, quantity: number, validDays: number, note: string, meta: RequestMeta) {
    const e = await this.prisma.employers.findUnique({ where: { id: employerId } });
    if (!e) throw notFound('Employer');
    return this.prisma.tx(async (tx) => {
      const ent = await grantEntitlement(tx, { employerId, quantity, validDays, source: 'ADMIN_GRANT', grantedBy: admin.userId, referenceType: 'admin_grant', note });
      await this.audit.record(tx, admin, meta, { action: 'entitlement.granted', entityType: 'employer', entityId: employerId, employerId, metadata: { quantity, validDays, note } });
      return { id: ent.id };
    });
  }

  async setEmployerStatus(admin: Principal, employerId: string, suspend: boolean, reason: string, meta: RequestMeta) {
    const e = await this.prisma.employers.findUnique({ where: { id: employerId } });
    if (!e) throw notFound('Employer');
    await this.prisma.tx(async (tx) => {
      await tx.employers.update({
        where: { id: employerId },
        data: suspend
          ? { status: 'SUSPENDED', verification_status: e.verification_status === 'VERIFIED' ? 'SUSPENDED' : e.verification_status }
          : { status: 'ACTIVE', verification_status: e.verification_status === 'SUSPENDED' ? 'VERIFIED' : e.verification_status },
      });
      if (suspend) await tx.jobs.updateMany({ where: { employer_id: employerId, status: 'PUBLISHED' }, data: { status: 'PAUSED' } });
      await this.audit.record(tx, admin, meta, { action: suspend ? 'employer.suspended' : 'employer.reinstated', entityType: 'employer', entityId: employerId, employerId, metadata: { reason } });
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------- jobs

  jobs(status?: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT j.id, j.title, j.status, j.work_mode, j.employment_type, j.created_at, j.published_at, j.moderation_reason,
             co.display_name AS company, e.verification_status, left(j.description, 600) AS description_preview,
             (SELECT coalesce(array_agg(l.city), '{}') FROM job_locations l WHERE l.job_id = j.id) AS cities,
             j.salary_min_paise, j.salary_max_paise,
             (SELECT count(*)::int FROM abuse_reports r WHERE r.target_type = 'JOB' AND r.target_id = j.id) AS reports
      FROM jobs j JOIN companies co ON co.id = j.company_id JOIN employers e ON e.id = j.employer_id
      WHERE (${status ?? null}::text IS NULL OR j.status = ${status ?? null})
      ORDER BY (j.status = 'PENDING_APPROVAL') DESC, j.created_at DESC LIMIT 200`;
  }

  async moderateJob(admin: Principal, id: string, approve: boolean, reason: string | undefined, meta: RequestMeta) {
    const j = await this.prisma.jobs.findUnique({ where: { id } });
    if (!j) throw notFound('Job');
    if (j.status !== 'PENDING_APPROVAL' && approve) throw conflict('INVALID_TRANSITION', 'Only pending jobs can be approved');
    if (!approve && !reason?.trim()) throw unprocessable('REASON_REQUIRED', 'A reason is required');
    const status = approve ? 'PUBLISHED' : j.status === 'PENDING_APPROVAL' ? 'REJECTED' : 'CLOSED';
    await this.prisma.tx(async (tx) => {
      await tx.jobs.update({
        where: { id },
        data: { status, moderated_by: admin.userId, moderation_reason: reason ?? null, ...(approve && { published_at: j.published_at ?? new Date() }), ...(status === 'CLOSED' && { closed_at: new Date() }), updated_at: new Date() },
      });
      await this.audit.record(tx, admin, meta, { action: approve ? 'job.approved' : status === 'REJECTED' ? 'job.rejected' : 'job.closed_by_admin', entityType: 'job', entityId: id, employerId: j.employer_id, metadata: { reason } });
      await this.notify.toEmployer(j.employer_id, {
        type: 'JOB_MODERATED', title: approve ? `"${j.title}" is live` : `"${j.title}" was ${status === 'REJECTED' ? 'not approved' : 'closed by GenZHire'}`,
        body: reason ?? 'Candidates can now find and apply to this job.', link: `/jobs/${id}`,
      }, tx);
    });
    return { id, status };
  }

  // ------------------------------------------------------------- candidates

  candidates(q?: string, cursor?: string) {
    return this.page('candidates', cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT c.id, c.first_name || ' ' || c.last_name AS name, u.email, c.city, u.status, c.created_at, p.profile_completion,
             v.level AS visibility, d.is_searchable,
             (SELECT count(*)::int FROM applications a WHERE a.candidate_id = c.id) AS applications,
             (SELECT count(*)::int FROM candidate_profile_views x WHERE x.candidate_id = c.id) AS access_events
      FROM candidates c JOIN users u ON u.id = c.user_id JOIN candidate_profiles p ON p.candidate_id = c.id
      JOIN candidate_visibility v ON v.candidate_id = c.id LEFT JOIN candidate_search_documents d ON d.candidate_id = c.id
      WHERE NOT c.is_honeytoken AND (${q ?? null}::text IS NULL OR u.email ILIKE ${'%' + (q ?? '') + '%'} OR (c.first_name || ' ' || c.last_name) ILIKE ${'%' + (q ?? '') + '%'})
      ORDER BY c.created_at DESC LIMIT 51 OFFSET ${offset}`);
  }

  async candidate(admin: Principal, id: string, meta: RequestMeta) {
    const c = await loadCandidate(this.prisma, id);
    if (!c) throw notFound('Candidate');
    await this.prisma.candidate_profile_views.create({
      data: { viewer_user_id: admin.userId, viewer_type: 'ADMIN', candidate_id: id, action: 'FULL_PROFILE_VIEW', access_basis: 'ADMIN', ip_address: meta.ip, user_agent: meta.userAgent, request_id: meta.requestId },
    });
    const [access, applications, consents] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
        SELECT v.action, v.access_basis, v.viewer_type, v.credits_consumed, v.created_at, u.email AS viewer, e.name AS employer
        FROM candidate_profile_views v JOIN users u ON u.id = v.viewer_user_id LEFT JOIN employers e ON e.id = v.employer_id
        WHERE v.candidate_id = ${id}::uuid ORDER BY v.created_at DESC LIMIT 100`,
      this.prisma.applications.findMany({ where: { candidate_id: id }, orderBy: { applied_at: 'desc' }, select: { id: true, status: true, applied_at: true, jobs: { select: { title: true, companies: { select: { display_name: true } } } } } }),
      this.prisma.candidate_consents.findMany({ where: { candidate_id: id }, orderBy: { created_at: 'desc' }, select: { purpose: true, granted: true, source: true, created_at: true } }),
    ]);
    return { profile: presentCandidate(c, 'CONTACT'), visibility: c.candidate_visibility, userStatus: c.users.status, access, applications, consents };
  }

  // ------------------------------------------------- requirements & recruiters

  requirements(status?: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT r.id, r.role_title, r.openings, r.status, r.fulfilment_mode, r.locations, r.work_mode, r.ctc_min_paise, r.ctc_max_paise,
             r.joining_timeline, r.created_at, co.display_name AS company, e.verification_status, e.id AS employer_id,
             c.id AS case_id, c.status AS case_status,
             (SELECT string_agg(rec.display_name, ', ') FROM recruitment_case_assignments a JOIN recruiters rec ON rec.id = a.recruiter_id
               WHERE a.case_id = c.id AND a.unassigned_at IS NULL) AS recruiters
      FROM hiring_requirements r JOIN companies co ON co.id = r.company_id JOIN employers e ON e.id = r.employer_id
      LEFT JOIN recruitment_cases c ON c.hiring_requirement_id = r.id
      WHERE (${status ?? null}::text IS NULL OR r.status = ${status ?? null})
      ORDER BY (r.status = 'SUBMITTED') DESC, r.created_at DESC LIMIT 200`;
  }

  /**
   * Opens a recruitment case. Uses the employer's ACTIVE agreement, or creates
   * one from the default settings (fee %, trigger days) — values are then
   * snapshotted onto each placement and never read from settings again.
   */
  async openCase(admin: Principal, requirementId: string, recruiterIds: string[], feePct: number | undefined, triggerDays: number | undefined, meta: RequestMeta) {
    const r = await this.prisma.hiring_requirements.findUnique({ where: { id: requirementId }, include: { employers: true } });
    if (!r) throw notFound('Requirement');
    if (r.fulfilment_mode === 'DATABASE') throw unprocessable('DATABASE_ONLY', 'This requirement does not use HR consultants');
    if (r.employers.verification_status !== 'VERIFIED') throw unprocessable('EMPLOYER_NOT_VERIFIED', 'Verify the employer before opening a case');
    const existing = await this.prisma.recruitment_cases.findUnique({ where: { hiring_requirement_id: requirementId } });
    if (existing) throw conflict('CASE_EXISTS', 'A case is already open for this requirement');
    const recruiters = await this.prisma.recruiters.findMany({ where: { id: { in: recruiterIds }, status: 'ACTIVE' } });
    if (!recruiterIds.length || recruiters.length !== new Set(recruiterIds).size) throw unprocessable('INVALID_RECRUITERS', 'Select at least one active recruiter');
    const defaultFee = await this.settings.num('billing.consultant_fee_percentage');
    const defaultDays = await this.settings.num('billing.payment_trigger_days');

    return this.prisma.tx(async (tx) => {
      let agreement = await tx.recruitment_agreements.findFirst({ where: { employer_id: r.employer_id, status: 'ACTIVE' }, orderBy: { created_at: 'desc' } });
      if (!agreement || feePct !== undefined || triggerDays !== undefined) {
        agreement = await tx.recruitment_agreements.create({
          data: {
            employer_id: r.employer_id, reference_no: `GZH-AGR-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`,
            fee_percentage: new Prisma.Decimal(feePct ?? defaultFee), payment_trigger_days: triggerDays ?? defaultDays,
            valid_from: new Date(), status: 'ACTIVE', created_by: admin.userId,
          },
        });
        await this.audit.record(tx, admin, meta, { action: 'agreement.created', entityType: 'recruitment_agreement', entityId: agreement.id, employerId: r.employer_id, metadata: { feePercentage: feePct ?? defaultFee, triggerDays: triggerDays ?? defaultDays } });
      }
      const cs = await tx.recruitment_cases.create({ data: { hiring_requirement_id: requirementId, employer_id: r.employer_id, agreement_id: agreement.id } });
      for (const [i, rid] of recruiterIds.entries()) {
        await tx.recruitment_case_assignments.create({ data: { case_id: cs.id, recruiter_id: rid, role: i === 0 ? 'OWNER' : 'CONTRIBUTOR', assigned_by: admin.userId } });
        const rec = recruiters.find((x) => x.id === rid)!;
        await this.notify.send({ userId: rec.user_id, app: 'recruiter', type: 'REQUIREMENT_ASSIGNED', title: `New requirement: ${r.role_title}`, body: `${r.openings} opening(s). Start sourcing.`, link: `/requirements/${cs.id}` }, tx);
      }
      await tx.hiring_requirements.update({ where: { id: requirementId }, data: { status: 'ACTIVE', updated_at: new Date() } });
      await this.audit.record(tx, admin, meta, { action: 'requirement.assigned', entityType: 'hiring_requirement', entityId: requirementId, employerId: r.employer_id, metadata: { caseId: cs.id, recruiterIds } });
      await this.notify.toEmployer(r.employer_id, { type: 'REQUIREMENT_ACTIVE', title: `A GenZHire recruiter is working on "${r.role_title}"`, body: 'Submitted candidates will appear on the requirement page.', link: `/requirements/${requirementId}` }, tx);
      return { caseId: cs.id, agreementId: agreement.id };
    });
  }

  recruiters() {
    return this.prisma.$queryRaw<any[]>`
      SELECT r.id, r.display_name, r.designation, r.status, r.max_active_cases, r.employee_code, u.email, u.last_login_at,
             (SELECT count(*)::int FROM recruitment_case_assignments a JOIN recruitment_cases c ON c.id = a.case_id
               WHERE a.recruiter_id = r.id AND a.unassigned_at IS NULL AND c.status IN ('OPEN','ON_HOLD')) AS active_cases
      FROM recruiters r JOIN users u ON u.id = r.user_id ORDER BY r.display_name`;
  }

  async createRecruiter(admin: Principal, email: string, fullName: string, designation: string | undefined, meta: RequestMeta) {
    const exists = await this.prisma.users.findUnique({ where: { email } });
    if (exists) throw conflict('EMAIL_EXISTS', 'A user with this email already exists');
    return this.prisma.tx(async (tx) => {
      const { user, temporaryPassword } = await this.auth.createStaffUser(tx, email, fullName, 'RECRUITER', admin.userId);
      const r = await tx.recruiters.create({ data: { user_id: user.id, display_name: fullName, designation: designation ?? null } });
      await this.audit.record(tx, admin, meta, { action: 'user.role_granted', entityType: 'user', entityId: user.id, metadata: { role: 'RECRUITER' } });
      // Shown once to the admin; the recruiter must change it after first login.
      return { recruiterId: r.id, email, temporaryPassword };
    });
  }

  cases() {
    return this.prisma.$queryRaw<any[]>`
      SELECT c.id, c.status, c.opened_at, r.role_title, r.openings, co.display_name AS company, ag.fee_percentage, ag.payment_trigger_days,
             (SELECT count(*)::int FROM recruitment_candidates rc WHERE rc.case_id = c.id) AS pipeline,
             (SELECT count(*)::int FROM recruitment_candidates rc WHERE rc.case_id = c.id AND rc.submitted_at IS NOT NULL) AS submitted,
             (SELECT count(*)::int FROM candidate_joinings j JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
               WHERE rc.case_id = c.id AND j.tracking_status IN ('TRACKING','COMPLETED')) AS joined,
             (SELECT string_agg(rec.display_name, ', ') FROM recruitment_case_assignments a JOIN recruiters rec ON rec.id = a.recruiter_id
               WHERE a.case_id = c.id AND a.unassigned_at IS NULL) AS recruiters
      FROM recruitment_cases c JOIN hiring_requirements r ON r.id = c.hiring_requirement_id JOIN companies co ON co.id = r.company_id
      JOIN recruitment_agreements ag ON ag.id = c.agreement_id ORDER BY c.opened_at DESC LIMIT 200`;
  }

  async waiveBilling(admin: Principal, id: string, reason: string, meta: RequestMeta) {
    const b = await this.prisma.consultant_billing.findUnique({ where: { id } });
    if (!b) throw notFound('Billing record');
    if (!['PENDING_TRIGGER', 'BILLABLE'].includes(b.status)) throw conflict('INVALID_TRANSITION', 'Only unbilled records can be waived');
    await this.prisma.tx(async (tx) => {
      await tx.consultant_billing.update({ where: { id }, data: { status: 'WAIVED', status_reason: reason, updated_at: new Date() } });
      await this.audit.record(tx, admin, meta, { action: 'billing.waived', entityType: 'consultant_billing', entityId: id, employerId: b.employer_id, metadata: { reason } });
    });
    return { id, status: 'WAIVED' };
  }

  // ------------------------------------------------------------------- logs

  accessLogs(employerId?: string, candidateId?: string, action?: string, cursor?: string) {
    return this.page(`access:${employerId}:${candidateId}:${action}`, cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT v.id, v.created_at, v.action, v.access_basis, v.viewer_type, v.credits_consumed, v.ip_address::text AS ip, v.user_agent,
             u.email AS viewer_email, e.name AS employer, e.id AS employer_id, c.id AS candidate_id, c.first_name || ' ' || c.last_name AS candidate
      FROM candidate_profile_views v JOIN users u ON u.id = v.viewer_user_id JOIN candidates c ON c.id = v.candidate_id
      LEFT JOIN employers e ON e.id = v.employer_id
      WHERE (${employerId ?? null}::uuid IS NULL OR v.employer_id = ${employerId ?? null}::uuid)
        AND (${candidateId ?? null}::uuid IS NULL OR v.candidate_id = ${candidateId ?? null}::uuid)
        AND (${action ?? null}::text IS NULL OR v.action = ${action ?? null})
      ORDER BY v.created_at DESC, v.id DESC LIMIT 51 OFFSET ${offset}`);
  }

  auditLogs(action?: string, entityType?: string, entityId?: string, cursor?: string) {
    return this.page(`audit:${action}:${entityType}:${entityId}`, cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.actor_role, a.actor_app, a.metadata, a.ip_address::text AS ip,
             u.email AS actor_email, encode(a.hash, 'hex') AS hash
      FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE (${action ?? null}::text IS NULL OR a.action ILIKE ${(action ?? '') + '%'})
        AND (${entityType ?? null}::text IS NULL OR a.entity_type = ${entityType ?? null})
        AND (${entityId ?? null}::text IS NULL OR a.entity_id = ${entityId ?? null})
      ORDER BY a.created_at DESC, a.id DESC LIMIT 51 OFFSET ${offset}`);
  }

  /** Recomputes the hash chain (docs/13-security.md §10). */
  async verifyAuditChain(limit = 5000) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, actor_id, action, entity_type, entity_id, employer_id, metadata, created_at, prev_hash, hash
      FROM audit_logs ORDER BY id ASC LIMIT ${limit}`;
    let prev: Buffer | null = null;
    for (const r of rows) {
      const canonical = canonicalJson({
        actor: r.actor_id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, employerId: r.employer_id,
        metadata: r.metadata ?? {}, createdAt: new Date(r.created_at).toISOString(),
      });
      const expected = createHash('sha256').update(prev ?? Buffer.alloc(0)).update(canonical).digest();
      const linkOk = (prev === null && r.prev_hash === null) || (prev !== null && r.prev_hash && Buffer.compare(prev, r.prev_hash) === 0);
      if (!linkOk || Buffer.compare(expected, r.hash) !== 0) {
        return { ok: false, checked: rows.indexOf(r), brokenAt: { id: Number(r.id), createdAt: r.created_at, action: r.action } };
      }
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  }

  // --------------------------------------------------------------- settings

  settingsList() {
    return this.prisma.system_settings.findMany({ orderBy: { key: 'asc' } });
  }

  async updateSetting(admin: Principal, key: string, value: unknown, reason: string, meta: RequestMeta) {
    const s = await this.prisma.system_settings.findUnique({ where: { key } });
    if (!s) throw notFound('Setting');
    const schema = s.schema as { type?: string; enum?: unknown[]; minimum?: number; maximum?: number; items?: { type?: string } };
    const fail = (m: string) => { throw badRequest('INVALID_SETTING', m); };
    if (schema.enum && !schema.enum.includes(value)) fail(`Must be one of: ${schema.enum.join(', ')}`);
    if (schema.type === 'number' || schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('Must be a number');
      if (schema.type === 'integer' && !Number.isInteger(value)) fail('Must be a whole number');
      if (schema.minimum !== undefined && (value as number) < schema.minimum) fail(`Must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && (value as number) > schema.maximum) fail(`Must be at most ${schema.maximum}`);
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') fail('Must be true or false');
    if (schema.type === 'array' && (!Array.isArray(value) || value.some((v) => typeof v !== 'number'))) fail('Must be a list of numbers');
    await this.prisma.tx(async (tx) => {
      await tx.system_settings_history.create({ data: { key, old_value: s.value as object, new_value: value as object, changed_by: admin.userId, reason } });
      await tx.system_settings.update({ where: { key }, data: { value: value as object, updated_by: admin.userId, updated_at: new Date() } });
      await this.audit.record(tx, admin, meta, { action: 'settings.changed', entityType: 'system_setting', entityId: key, metadata: { old: s.value, new: value, reason } });
    });
    this.settings.invalidate();
    return { key, value };
  }

  settingHistory(key: string) {
    return this.prisma.system_settings_history.findMany({ where: { key }, orderBy: { changed_at: 'desc' }, take: 50 });
  }

  // --------------------------------------------------------- trust & safety

  alerts(status = 'OPEN') {
    return this.prisma.security_alerts.findMany({ where: status === 'ALL' ? {} : { status }, orderBy: { created_at: 'desc' }, take: 200 });
  }

  async resolveAlert(admin: Principal, id: string, status: string, meta: RequestMeta) {
    await this.prisma.tx(async (tx) => {
      await tx.security_alerts.update({ where: { id }, data: { status, resolved_by: admin.userId } });
      await this.audit.record(tx, admin, meta, { action: 'security_alert.resolved', entityType: 'security_alert', entityId: id, metadata: { status } });
    });
    return { id, status };
  }

  reports(status?: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT r.*, u.email AS reporter_email,
             CASE WHEN r.target_type = 'JOB' THEN (SELECT j.title FROM jobs j WHERE j.id = r.target_id) END AS target_label
      FROM abuse_reports r LEFT JOIN users u ON u.id = r.reporter_id
      WHERE (${status ?? null}::text IS NULL OR r.status = ${status ?? null})
      ORDER BY r.created_at DESC LIMIT 200`;
  }

  async actionReport(admin: Principal, id: string, status: string, resolution: string, meta: RequestMeta) {
    await this.prisma.tx(async (tx) => {
      await tx.abuse_reports.update({ where: { id }, data: { status, resolution, handled_by: admin.userId } });
      await this.audit.record(tx, admin, meta, { action: 'abuse_report.actioned', entityType: 'abuse_report', entityId: id, metadata: { status } });
    });
    return { id, status };
  }

  applications(status?: string, cursor?: string) {
    const limit = clampLimit(50);
    return this.page(`apps:${status}`, cursor, (offset) => this.prisma.$queryRaw<any[]>`
      SELECT a.id, a.status, a.applied_at, j.title AS job_title, co.display_name AS company, c.first_name || ' ' || c.last_name AS candidate
      FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies co ON co.id = j.company_id JOIN candidates c ON c.id = a.candidate_id
      WHERE (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
      ORDER BY a.applied_at DESC LIMIT ${limit + 1} OFFSET ${offset}`);
  }
}
