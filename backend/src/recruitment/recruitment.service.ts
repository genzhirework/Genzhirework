import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import type { Principal, RequestMeta } from '../common/decorators';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService, Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { loadCandidate, presentCandidate } from '../candidate/profile.presenter';
import type { InterviewDto, OfferDto, RequirementDto } from './recruitment.dto';

/** Stage semantics that only the system may enter (docs/06-business-rules.md §7). */
const SYSTEM_ONLY = new Set(['SUBMITTED', 'JOINED', 'TRACKING', 'BILLABLE', 'INVOICED', 'PAID', 'OFFER']);
const TERMINAL = new Set(['REJECTED', 'WITHDRAWN', 'DROPPED', 'PAID']);

/** round_half_up(ctc × pct / 100) in paise — BigInt-safe, no floating point. */
export function consultantFee(annualCtcPaise: bigint, feePercentage: Prisma.Decimal | number | string): bigint {
  const pctHundredths = BigInt(new Prisma.Decimal(feePercentage).mul(100).toFixed(0)); // 8.33 → 833
  const numerator = annualCtcPaise * pctHundredths; // ÷ 10000
  return (numerator + 5000n) / 10000n;
}

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------- employer side

  async createRequirement(p: Principal, d: RequirementDto, meta: RequestMeta) {
    const emp = p.employerId!;
    if (d.ctcMinPaise && d.ctcMaxPaise && d.ctcMaxPaise < d.ctcMinPaise) throw unprocessable('INVALID_CTC', 'Maximum CTC must be at least the minimum');
    const known = await this.prisma.skills.count({ where: { id: { in: d.skillIds } } });
    if (known !== new Set(d.skillIds).size) throw unprocessable('UNKNOWN_SKILL', 'One or more skills are not recognised');
    const company = await this.prisma.companies.findFirstOrThrow({ where: { employer_id: emp }, orderBy: { created_at: 'asc' } });
    return this.prisma.tx(async (tx) => {
      const r = await tx.hiring_requirements.create({
        data: {
          employer_id: emp, company_id: company.id, created_by: p.userId, role_title: d.roleTitle, openings: d.openings,
          qualification: d.qualification ?? null, min_education_level: d.minEducationLevel ?? null,
          experience_min_months: d.experienceMinMonths, experience_max_months: d.experienceMaxMonths ?? null,
          locations: d.locations, work_mode: d.workMode,
          ctc_min_paise: d.ctcMinPaise !== undefined ? BigInt(d.ctcMinPaise) : null,
          ctc_max_paise: d.ctcMaxPaise !== undefined ? BigInt(d.ctcMaxPaise) : null,
          joining_timeline: d.joiningTimeline, fulfilment_mode: d.fulfilmentMode, notes: d.notes ?? null,
          status: d.fulfilmentMode === 'DATABASE' ? 'ACTIVE' : 'SUBMITTED',
        },
      });
      await tx.hiring_requirement_skills.createMany({ data: [...new Set(d.skillIds)].map((s) => ({ hiring_requirement_id: r.id, skill_id: s })) });
      await this.audit.record(tx, p, meta, { action: 'requirement.created', entityType: 'hiring_requirement', entityId: r.id, employerId: emp, metadata: { mode: d.fulfilmentMode } });
      return { id: r.id, status: r.status };
    });
  }

  employerRequirements(p: Principal) {
    return this.prisma.$queryRaw<any[]>`
      SELECT r.id, r.role_title, r.openings, r.status, r.fulfilment_mode, r.work_mode, r.locations, r.joining_timeline, r.created_at,
             (SELECT count(*)::int FROM recruitment_candidates rc JOIN recruitment_cases c ON c.id = rc.case_id
               WHERE c.hiring_requirement_id = r.id AND rc.submitted_at IS NOT NULL) AS submitted,
             (SELECT count(*)::int FROM recruitment_candidates rc JOIN recruitment_cases c ON c.id = rc.case_id
               JOIN candidate_joinings j ON j.recruitment_candidate_id = rc.id
               WHERE c.hiring_requirement_id = r.id AND j.tracking_status IN ('TRACKING','COMPLETED')) AS joined
      FROM hiring_requirements r WHERE r.employer_id = ${p.employerId!}::uuid ORDER BY r.created_at DESC`;
  }

  async employerRequirement(p: Principal, id: string) {
    const r = await this.prisma.hiring_requirements.findFirst({
      where: { id, employer_id: p.employerId! },
      include: { hiring_requirement_skills: { include: { skills: { select: { id: true, name: true } } } }, recruitment_cases: true },
    });
    if (!r) throw notFound('Requirement');
    const submissions = r.recruitment_cases
      ? await this.prisma.$queryRaw<any[]>`
          SELECT rc.id, rc.candidate_id, rc.submitted_at, rc.employer_decision, rc.employer_feedback,
                 c.first_name || ' ' || c.last_name AS candidate_name, cp.headline, s.label AS stage, s.semantic,
                 j.id AS joining_id, j.joining_date, j.tracking_status, j.employer_confirmed_at, j.recruiter_confirmed_at, j.billing_due_date
          FROM recruitment_candidates rc
          JOIN candidates c ON c.id = rc.candidate_id
          JOIN candidate_profiles cp ON cp.candidate_id = c.id
          JOIN pipeline_stages s ON s.id = rc.stage_id
          LEFT JOIN candidate_joinings j ON j.recruitment_candidate_id = rc.id
          WHERE rc.case_id = ${r.recruitment_cases.id}::uuid AND rc.submitted_at IS NOT NULL
          ORDER BY rc.submitted_at DESC`
      : [];
    return {
      ...r,
      skills: r.hiring_requirement_skills.map((s) => s.skills),
      hiring_requirement_skills: undefined,
      recruitment_cases: undefined,
      caseStatus: r.recruitment_cases?.status ?? null,
      submissions,
    };
  }

  async cancelRequirement(p: Principal, id: string, meta: RequestMeta) {
    const r = await this.prisma.hiring_requirements.findFirst({ where: { id, employer_id: p.employerId! } });
    if (!r) throw notFound('Requirement');
    if (['FILLED', 'CLOSED', 'CANCELLED'].includes(r.status)) throw conflict('INVALID_TRANSITION', 'This requirement is already closed');
    await this.prisma.tx(async (tx) => {
      await tx.hiring_requirements.update({ where: { id }, data: { status: 'CANCELLED', updated_at: new Date() } });
      await tx.recruitment_cases.updateMany({ where: { hiring_requirement_id: id, status: { in: ['OPEN', 'ON_HOLD'] } }, data: { status: 'CANCELLED', closed_at: new Date() } });
      await this.audit.record(tx, p, meta, { action: 'requirement.cancelled', entityType: 'hiring_requirement', entityId: id, employerId: p.employerId });
    });
    return { id, status: 'CANCELLED' };
  }

  private async employerSubmission(p: Principal, rcId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; case_id: string }[]>`
      SELECT rc.id, rc.case_id FROM recruitment_candidates rc JOIN recruitment_cases c ON c.id = rc.case_id
      WHERE rc.id = ${rcId}::uuid AND c.employer_id = ${p.employerId!}::uuid AND rc.submitted_at IS NOT NULL`;
    if (!rows.length) throw notFound('Submission');
    return rows[0];
  }

  async employerDecision(p: Principal, rcId: string, decision: string, feedback: string | undefined, meta: RequestMeta) {
    await this.employerSubmission(p, rcId);
    await this.prisma.tx(async (tx) => {
      await tx.recruitment_candidates.update({ where: { id: rcId }, data: { employer_decision: decision, employer_feedback: feedback ?? null, updated_at: new Date() } });
      await this.audit.record(tx, p, meta, { action: 'recruitment.employer_decision', entityType: 'recruitment_candidate', entityId: rcId, employerId: p.employerId, metadata: { decision } });
      await this.notifyRecruiters(tx, rcId, `Employer ${decision === 'ACCEPTED' ? 'accepted' : 'rejected'} a submitted candidate`, feedback ?? '');
    });
    return { ok: true };
  }

  async employerConfirmJoining(p: Principal, joiningId: string, meta: RequestMeta) {
    const j = await this.prisma.candidate_joinings.findUnique({ where: { id: joiningId } });
    if (!j) throw notFound('Joining');
    await this.employerSubmission(p, j.recruitment_candidate_id);
    if (j.employer_confirmed_at) return { ok: true };
    await this.prisma.tx(async (tx) => {
      await tx.candidate_joinings.update({ where: { id: joiningId }, data: { employer_confirmed_at: new Date(), employer_confirmed_by: p.userId } });
      await this.audit.record(tx, p, meta, { action: 'joining.confirmed', entityType: 'candidate_joining', entityId: joiningId, employerId: p.employerId, metadata: { side: 'EMPLOYER' } });
      await this.activateTracking(tx, joiningId);
    });
    return { ok: true };
  }

  async employerReportLeft(p: Principal, joiningId: string, leftOn: string, reason: string, meta: RequestMeta) {
    const j = await this.prisma.candidate_joinings.findUnique({ where: { id: joiningId } });
    if (!j) throw notFound('Joining');
    await this.employerSubmission(p, j.recruitment_candidate_id);
    return this.recordLeft(p, j.id, leftOn, reason, meta);
  }

  // ------------------------------------------------------------ tracking core

  private async stageBySemantic(tx: Tx | PrismaService, semantic: string) {
    return tx.pipeline_stages.findFirstOrThrow({ where: { semantic, is_active: true }, orderBy: { sort_order: 'asc' } });
  }

  /** Both sides confirmed → start 90-day tracking, create billing row + reminders. */
  private async activateTracking(tx: Tx, joiningId: string) {
    const j = await tx.candidate_joinings.findUniqueOrThrow({ where: { id: joiningId } });
    if (!j.recruiter_confirmed_at || !j.employer_confirmed_at || j.tracking_status !== 'AWAITING_CONFIRMATION') return;
    const rc = await tx.recruitment_candidates.findUniqueOrThrow({ where: { id: j.recruitment_candidate_id }, include: { recruitment_cases: { include: { recruitment_agreements: true } } } });
    const agreement = rc.recruitment_cases.recruitment_agreements;
    const offsets = await this.settings.get<number[]>('billing.reminder_offsets_days');
    await tx.candidate_joinings.update({ where: { id: joiningId }, data: { tracking_status: 'TRACKING' } });
    await tx.consultant_billing.create({
      data: {
        joining_id: joiningId, employer_id: rc.recruitment_cases.employer_id, agreement_id: agreement.id,
        annual_ctc_paise: j.annual_ctc_paise, fee_percentage: agreement.fee_percentage,
        fee_amount_paise: consultantFee(j.annual_ctc_paise, agreement.fee_percentage),
      },
    });
    for (const d of offsets) {
      const due = new Date(j.joining_date);
      due.setUTCDate(due.getUTCDate() + d);
      await tx.joining_reminders.create({ data: { joining_id: joiningId, day_offset: d, due_on: due } });
    }
    const tracking = await this.stageBySemantic(tx, 'TRACKING');
    await this.setStage(tx, rc.id, rc.stage_id, tracking.id, null, 'Joining confirmed by recruiter and employer');
    const joined = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM candidate_joinings j JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
      WHERE rc.case_id = ${rc.case_id}::uuid AND j.tracking_status IN ('TRACKING','COMPLETED')`;
    const req = await tx.hiring_requirements.findUniqueOrThrow({ where: { id: rc.recruitment_cases.hiring_requirement_id } });
    if (joined[0].n >= req.openings) {
      await tx.recruitment_cases.update({ where: { id: rc.case_id }, data: { status: 'FILLED' } });
      await tx.hiring_requirements.update({ where: { id: req.id }, data: { status: 'FILLED' } });
    }
  }

  private async setStage(tx: Tx, rcId: string, from: number | null, to: number, userId: string | null, note: string | null) {
    await tx.recruitment_candidates.update({ where: { id: rcId }, data: { stage_id: to, updated_at: new Date() } });
    await tx.recruitment_stage_history.create({ data: { recruitment_candidate_id: rcId, from_stage_id: from, to_stage_id: to, changed_by: userId, note } });
  }

  private async notifyRecruiters(tx: Tx, rcId: string, title: string, body: string) {
    const rc = await tx.recruitment_candidates.findUniqueOrThrow({ where: { id: rcId } });
    const assigned = await tx.recruitment_case_assignments.findMany({
      where: { case_id: rc.case_id, unassigned_at: null }, include: { recruiters: { select: { user_id: true } } },
    });
    for (const a of assigned) {
      await this.notify.send({ userId: a.recruiters.user_id, app: 'recruiter', type: 'RECRUITMENT_UPDATE', title, body: body || 'Open the case for details.', link: `/requirements/${rc.case_id}` }, tx);
    }
  }

  private async recordLeft(p: Principal, joiningId: string, leftOn: string, reason: string, meta: RequestMeta) {
    const j = await this.prisma.candidate_joinings.findUniqueOrThrow({ where: { id: joiningId } });
    if (['LEFT_EARLY', 'COMPLETED'].includes(j.tracking_status)) throw conflict('INVALID_TRANSITION', 'This joining is already closed');
    const left = new Date(leftOn);
    if (left < j.joining_date) throw unprocessable('INVALID_DATE', 'Leaving date cannot be before the joining date');
    await this.prisma.tx(async (tx) => {
      await tx.candidate_joinings.update({ where: { id: joiningId }, data: { tracking_status: 'LEFT_EARLY', left_on: left, left_reason: reason } });
      // D9: leaving before the trigger date means no fee (subject to agreement terms).
      await tx.consultant_billing.updateMany({
        where: { joining_id: joiningId, status: 'PENDING_TRIGGER' },
        data: { status: 'CANCELLED', status_reason: `Candidate left on ${leftOn}: ${reason}`, updated_at: new Date() },
      });
      const dropped = await this.stageBySemantic(tx, 'DROPPED');
      const rc = await tx.recruitment_candidates.findUniqueOrThrow({ where: { id: j.recruitment_candidate_id } });
      await this.setStage(tx, rc.id, rc.stage_id, dropped.id, p.userId, `Left before ${j.payment_trigger_days} days: ${reason}`);
      await tx.recruitment_candidates.update({ where: { id: rc.id }, data: { drop_reason: reason } });
      await this.audit.record(tx, p, meta, { action: 'joining.left_early_recorded', entityType: 'candidate_joining', entityId: joiningId, metadata: { leftOn } });
    });
    return { ok: true };
  }

  // ------------------------------------------------------------ recruiter side

  private async assignedCase(p: Principal, caseId: string) {
    if (p.aud === 'admin') return;
    const a = await this.prisma.recruitment_case_assignments.findFirst({ where: { case_id: caseId, recruiter_id: p.recruiterId!, unassigned_at: null } });
    if (!a) throw notFound('Case');
  }

  private async assignedCandidate(p: Principal, rcId: string) {
    const rc = await this.prisma.recruitment_candidates.findUnique({ where: { id: rcId }, include: { pipeline_stages: true } });
    if (!rc) throw notFound('Pipeline candidate');
    await this.assignedCase(p, rc.case_id);
    return rc;
  }

  stages() {
    return this.prisma.pipeline_stages.findMany({ where: { is_active: true }, orderBy: { sort_order: 'asc' } });
  }

  async dashboard(p: Principal) {
    const rid = p.recruiterId!;
    const [counts] = await this.prisma.$queryRaw<any[]>`
      SELECT
        (SELECT count(*)::int FROM recruitment_case_assignments a JOIN recruitment_cases c ON c.id = a.case_id
          WHERE a.recruiter_id = ${rid}::uuid AND a.unassigned_at IS NULL AND c.status IN ('OPEN','ON_HOLD')) AS open_cases,
        (SELECT count(*)::int FROM recruitment_candidates rc JOIN recruitment_case_assignments a ON a.case_id = rc.case_id AND a.unassigned_at IS NULL
          JOIN pipeline_stages s ON s.id = rc.stage_id WHERE a.recruiter_id = ${rid}::uuid AND NOT s.is_terminal) AS active_candidates,
        (SELECT count(*)::int FROM recruitment_candidates rc JOIN recruitment_case_assignments a ON a.case_id = rc.case_id AND a.unassigned_at IS NULL
          WHERE a.recruiter_id = ${rid}::uuid AND rc.submitted_at IS NOT NULL AND rc.employer_decision = 'PENDING') AS awaiting_feedback,
        (SELECT count(*)::int FROM candidate_joinings j JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
          JOIN recruitment_case_assignments a ON a.case_id = rc.case_id AND a.unassigned_at IS NULL
          WHERE a.recruiter_id = ${rid}::uuid AND j.tracking_status = 'TRACKING') AS in_tracking`;
    const interviews = await this.upcomingInterviews(p, 7);
    const due = await this.tracking(p, 21);
    return { ...counts, interviews, trackingDue: due };
  }

  cases(p: Principal) {
    const scope = p.aud === 'admin' ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM recruitment_case_assignments a WHERE a.case_id = c.id AND a.recruiter_id = ${p.recruiterId!}::uuid AND a.unassigned_at IS NULL)`;
    return this.prisma.$queryRaw<any[]>`
      SELECT c.id, c.status, c.opened_at, r.role_title, r.openings, r.locations, r.work_mode, r.joining_timeline,
             co.display_name AS company, ag.fee_percentage,
             (SELECT count(*)::int FROM recruitment_candidates rc WHERE rc.case_id = c.id) AS pipeline_count,
             (SELECT count(*)::int FROM recruitment_candidates rc WHERE rc.case_id = c.id AND rc.submitted_at IS NOT NULL) AS submitted,
             (SELECT count(*)::int FROM candidate_joinings j JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
               WHERE rc.case_id = c.id AND j.tracking_status IN ('TRACKING','COMPLETED')) AS joined,
             (SELECT string_agg(rec.display_name, ', ') FROM recruitment_case_assignments a JOIN recruiters rec ON rec.id = a.recruiter_id
               WHERE a.case_id = c.id AND a.unassigned_at IS NULL) AS recruiters
      FROM recruitment_cases c
      JOIN hiring_requirements r ON r.id = c.hiring_requirement_id
      JOIN companies co ON co.id = r.company_id
      JOIN recruitment_agreements ag ON ag.id = c.agreement_id
      WHERE true ${scope}
      ORDER BY c.status = 'OPEN' DESC, c.opened_at DESC`;
  }

  async caseDetail(p: Principal, caseId: string) {
    await this.assignedCase(p, caseId);
    const c = await this.prisma.recruitment_cases.findUnique({
      where: { id: caseId },
      include: {
        recruitment_agreements: { select: { reference_no: true, fee_percentage: true, payment_trigger_days: true, replacement_terms: true } },
        hiring_requirements: { include: { companies: { select: { display_name: true, website: true } }, hiring_requirement_skills: { include: { skills: { select: { id: true, name: true } } } } } },
      },
    });
    if (!c) throw notFound('Case');
    const pipeline = await this.prisma.$queryRaw<any[]>`
      SELECT rc.id, rc.candidate_id, rc.stage_id, rc.source, rc.submitted_at, rc.employer_decision, rc.employer_feedback,
             rc.screening_notes, rc.drop_reason, rc.updated_at, c.first_name || ' ' || c.last_name AS candidate_name, c.city,
             cp.headline, s.semantic, s.label AS stage_label,
             (SELECT count(*)::int FROM interviews i WHERE i.recruitment_candidate_id = rc.id) AS interviews,
             (SELECT json_build_object('id', o.id, 'status', o.status, 'annualCtcPaise', o.annual_ctc_paise, 'designation', o.designation, 'expectedJoiningDate', o.expected_joining_date)
                FROM offers o WHERE o.recruitment_candidate_id = rc.id ORDER BY o.created_at DESC LIMIT 1) AS offer,
             (SELECT json_build_object('id', j.id, 'joiningDate', j.joining_date, 'trackingStatus', j.tracking_status, 'billingDueDate', j.billing_due_date,
                                       'employerConfirmed', j.employer_confirmed_at IS NOT NULL, 'recruiterConfirmed', j.recruiter_confirmed_at IS NOT NULL)
                FROM candidate_joinings j WHERE j.recruitment_candidate_id = rc.id) AS joining
      FROM recruitment_candidates rc
      JOIN candidates c ON c.id = rc.candidate_id
      JOIN candidate_profiles cp ON cp.candidate_id = c.id
      JOIN pipeline_stages s ON s.id = rc.stage_id
      WHERE rc.case_id = ${caseId}::uuid
      ORDER BY rc.updated_at DESC`;
    const req = c.hiring_requirements;
    return {
      id: c.id, status: c.status, openedAt: c.opened_at, agreement: c.recruitment_agreements,
      requirement: {
        id: req.id, roleTitle: req.role_title, openings: req.openings, qualification: req.qualification,
        minEducationLevel: req.min_education_level, experienceMinMonths: req.experience_min_months,
        experienceMaxMonths: req.experience_max_months, locations: req.locations, workMode: req.work_mode,
        ctcMinPaise: req.ctc_min_paise, ctcMaxPaise: req.ctc_max_paise, joiningTimeline: req.joining_timeline,
        notes: req.notes, company: req.companies, skills: req.hiring_requirement_skills.map((s) => s.skills),
      },
      pipeline,
    };
  }

  async addCandidate(p: Principal, caseId: string, candidateId: string, source: string, notes: string | undefined, meta: RequestMeta) {
    await this.assignedCase(p, caseId);
    const cs = await this.prisma.recruitment_cases.findUniqueOrThrow({ where: { id: caseId } });
    if (!['OPEN', 'ON_HOLD'].includes(cs.status)) throw conflict('CASE_CLOSED', 'This case is closed');
    const doc = await this.prisma.candidate_search_documents.findUnique({ where: { candidate_id: candidateId } });
    const applied = await this.prisma.applications.count({ where: { candidate_id: candidateId, employer_id: cs.employer_id, status: { not: 'WITHDRAWN' } } });
    if (!doc?.is_searchable && applied === 0) throw notFound('Candidate');
    const blocked = await this.prisma.candidate_blocked_employers.findUnique({ where: { candidate_id_employer_id: { candidate_id: candidateId, employer_id: cs.employer_id } } });
    if (blocked) throw unprocessable('CANDIDATE_BLOCKED_EMPLOYER', 'This candidate has chosen not to be shown to this employer');
    const sourcing = await this.stageBySemantic(this.prisma, 'SOURCING');
    try {
      return await this.prisma.tx(async (tx) => {
        const rc = await tx.recruitment_candidates.create({
          data: { case_id: caseId, candidate_id: candidateId, stage_id: sourcing.id, sourced_by: p.recruiterId!, source, screening_notes: notes ?? null },
          select: { id: true },
        });
        await tx.recruitment_stage_history.create({ data: { recruitment_candidate_id: rc.id, to_stage_id: sourcing.id, changed_by: p.userId } });
        await this.audit.record(tx, p, meta, { action: 'recruitment.candidate_sourced', entityType: 'recruitment_candidate', entityId: rc.id, employerId: cs.employer_id, metadata: { candidateId, source } });
        return rc;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('ALREADY_IN_PIPELINE', 'This candidate is already in this case');
      throw e;
    }
  }

  async candidateDetail(p: Principal, rcId: string, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    const c = await loadCandidate(this.prisma, rc.candidate_id);
    if (!c) throw notFound('Candidate');
    await this.prisma.candidate_profile_views.create({
      data: {
        viewer_user_id: p.userId, viewer_type: p.aud === 'admin' ? 'ADMIN' : 'RECRUITER', candidate_id: c.id,
        action: 'FULL_PROFILE_VIEW', access_basis: p.aud === 'admin' ? 'ADMIN' : 'RECRUITER_CASE',
        ip_address: meta.ip, user_agent: meta.userAgent, request_id: meta.requestId,
      },
    });
    const history = await this.prisma.recruitment_stage_history.findMany({
      where: { recruitment_candidate_id: rcId }, orderBy: { created_at: 'asc' },
      select: { note: true, created_at: true, pipeline_stages_recruitment_stage_history_to_stage_idTopipeline_stages: { select: { label: true } }, users: { select: { full_name: true } } },
    });
    const interviews = await this.prisma.interviews.findMany({ where: { recruitment_candidate_id: rcId }, orderBy: { scheduled_start: 'asc' } });
    const offers = await this.prisma.offers.findMany({ where: { recruitment_candidate_id: rcId }, orderBy: { created_at: 'desc' } });
    const joining = await this.prisma.candidate_joinings.findUnique({ where: { recruitment_candidate_id: rcId } });
    return {
      id: rc.id, caseId: rc.case_id, stage: rc.pipeline_stages, source: rc.source, screeningNotes: rc.screening_notes,
      submittedAt: rc.submitted_at, employerDecision: rc.employer_decision, employerFeedback: rc.employer_feedback,
      profile: presentCandidate(c, 'CONTACT'),
      history: history.map((h) => ({ stage: h.pipeline_stages_recruitment_stage_history_to_stage_idTopipeline_stages.label, note: h.note, at: h.created_at, by: h.users?.full_name ?? 'System' })),
      interviews, offers, joining,
    };
  }

  async move(p: Principal, rcId: string, toStageId: number, note: string | undefined, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    const to = await this.prisma.pipeline_stages.findUnique({ where: { id: toStageId } });
    if (!to || !to.is_active) throw notFound('Stage');
    if (rc.stage_id === to.id) return { ok: true };
    if (TERMINAL.has(rc.pipeline_stages.semantic)) throw conflict('INVALID_TRANSITION', 'This candidate is in a closed stage');
    if (SYSTEM_ONLY.has(to.semantic)) {
      throw conflict('SYSTEM_STAGE', `Use the dedicated action to move to "${to.label}" (submit, offer or joining)`);
    }
    if (['REJECTED', 'WITHDRAWN', 'DROPPED'].includes(to.semantic) && !note?.trim()) {
      throw unprocessable('REASON_REQUIRED', 'Please add a reason');
    }
    if (to.semantic === 'INTERVIEW') {
      const n = await this.prisma.interviews.count({ where: { recruitment_candidate_id: rcId } });
      if (!n) throw unprocessable('INTERVIEW_REQUIRED', 'Schedule an interview first');
    }
    if (to.semantic === 'SELECTED' && rc.employer_decision !== 'ACCEPTED') {
      throw unprocessable('EMPLOYER_ACCEPTANCE_REQUIRED', 'The employer must accept this candidate before selection');
    }
    const joined = await this.prisma.candidate_joinings.findUnique({ where: { recruitment_candidate_id: rcId } });
    if (joined && joined.tracking_status !== 'LEFT_EARLY') throw conflict('INVALID_TRANSITION', 'Joined candidates are managed from the 90-day tracker');
    await this.prisma.tx(async (tx) => {
      await this.setStage(tx, rcId, rc.stage_id, to.id, p.userId, note ?? null);
      if (['REJECTED', 'WITHDRAWN', 'DROPPED'].includes(to.semantic)) await tx.recruitment_candidates.update({ where: { id: rcId }, data: { drop_reason: note } });
      await this.audit.record(tx, p, meta, { action: 'recruitment.stage_changed', entityType: 'recruitment_candidate', entityId: rcId, metadata: { from: rc.pipeline_stages.code, to: to.code } });
    });
    return { ok: true };
  }

  async submit(p: Principal, rcId: string, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    if (rc.submitted_at) throw conflict('ALREADY_SUBMITTED', 'Already submitted to the employer');
    if (!['SCREENING', 'SHORTLISTED'].includes(rc.pipeline_stages.semantic)) throw conflict('INVALID_TRANSITION', 'Shortlist the candidate before submitting');
    const submitted = await this.stageBySemantic(this.prisma, 'SUBMITTED');
    const cs = await this.prisma.recruitment_cases.findUniqueOrThrow({ where: { id: rc.case_id }, include: { hiring_requirements: true } });
    await this.prisma.tx(async (tx) => {
      await tx.recruitment_candidates.update({ where: { id: rcId }, data: { submitted_at: new Date(), employer_decision: 'PENDING' } });
      await this.setStage(tx, rcId, rc.stage_id, submitted.id, p.userId, 'Submitted to employer');
      await this.audit.record(tx, p, meta, { action: 'recruitment.candidate_submitted', entityType: 'recruitment_candidate', entityId: rcId, employerId: cs.employer_id });
      await this.notify.toEmployer(cs.employer_id, {
        type: 'CANDIDATE_SUBMITTED', title: `New candidate for ${cs.hiring_requirements.role_title}`,
        body: 'Your GenZHire recruiter submitted a candidate for review.', link: `/requirements/${cs.hiring_requirement_id}`,
      }, tx);
    });
    return { ok: true };
  }

  async scheduleInterview(p: Principal, rcId: string, d: InterviewDto, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    if (!rc.submitted_at || rc.employer_decision !== 'ACCEPTED') throw unprocessable('EMPLOYER_ACCEPTANCE_REQUIRED', 'The employer must accept the submission before interviews');
    const start = new Date(d.scheduledStart), end = new Date(d.scheduledEnd);
    if (end <= start) throw unprocessable('INVALID_TIME', 'End time must be after start time');
    const count = await this.prisma.interviews.count({ where: { recruitment_candidate_id: rcId } });
    const interviewStage = await this.stageBySemantic(this.prisma, 'INTERVIEW');
    return this.prisma.tx(async (tx) => {
      const i = await tx.interviews.create({
        data: {
          recruitment_candidate_id: rcId, round_no: count + 1, round_name: d.roundName, mode: d.mode, scheduled_start: start, scheduled_end: end,
          location_or_link: d.locationOrLink ?? null, interviewer_names: d.interviewerNames ?? null, created_by: p.userId,
        },
      });
      if (rc.pipeline_stages.semantic === 'SUBMITTED') await this.setStage(tx, rcId, rc.stage_id, interviewStage.id, p.userId, `Interview scheduled: ${d.roundName}`);
      await this.audit.record(tx, p, meta, { action: 'recruitment.interview_scheduled', entityType: 'interview', entityId: i.id });
      return i;
    });
  }

  async updateInterview(p: Principal, id: string, status?: string, outcome?: string, feedback?: string) {
    const i = await this.prisma.interviews.findUnique({ where: { id } });
    if (!i?.recruitment_candidate_id) throw notFound('Interview');
    await this.assignedCandidate(p, i.recruitment_candidate_id);
    return this.prisma.interviews.update({ where: { id }, data: { ...(status && { status }), ...(outcome && { outcome }), ...(feedback !== undefined && { feedback }) } });
  }

  upcomingInterviews(p: Principal, days = 30) {
    return this.prisma.$queryRaw<any[]>`
      SELECT i.id, i.round_name, i.mode, i.scheduled_start, i.scheduled_end, i.status, i.outcome, i.location_or_link,
             rc.id AS recruitment_candidate_id, rc.case_id, c.first_name || ' ' || c.last_name AS candidate_name, r.role_title, co.display_name AS company
      FROM interviews i
      JOIN recruitment_candidates rc ON rc.id = i.recruitment_candidate_id
      JOIN recruitment_cases cs ON cs.id = rc.case_id
      JOIN hiring_requirements r ON r.id = cs.hiring_requirement_id
      JOIN companies co ON co.id = r.company_id
      JOIN candidates c ON c.id = rc.candidate_id
      JOIN recruitment_case_assignments a ON a.case_id = cs.id AND a.unassigned_at IS NULL AND a.recruiter_id = ${p.recruiterId!}::uuid
      WHERE i.scheduled_start > now() - interval '1 day' AND i.scheduled_start < now() + make_interval(days => ${days}::int)
      ORDER BY i.scheduled_start`;
  }

  async offer(p: Principal, rcId: string, d: OfferDto, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    if (rc.pipeline_stages.semantic !== 'SELECTED') throw unprocessable('SELECTION_REQUIRED', 'Mark the candidate as Selected before recording an offer');
    const offerStage = await this.stageBySemantic(this.prisma, 'OFFER');
    return this.prisma.tx(async (tx) => {
      const o = await tx.offers.create({
        data: {
          recruitment_candidate_id: rcId, designation: d.designation, annual_ctc_paise: BigInt(d.annualCtcPaise),
          offer_date: new Date(d.offerDate), expected_joining_date: new Date(d.expectedJoiningDate), created_by: p.userId,
        },
      });
      await this.setStage(tx, rcId, rc.stage_id, offerStage.id, p.userId, `Offer: ${d.designation}`);
      await this.audit.record(tx, p, meta, { action: 'recruitment.offer_recorded', entityType: 'offer', entityId: o.id });
      return o;
    });
  }

  async offerStatus(p: Principal, offerId: string, status: string) {
    const o = await this.prisma.offers.findUnique({ where: { id: offerId } });
    if (!o) throw notFound('Offer');
    await this.assignedCandidate(p, o.recruitment_candidate_id);
    if (o.status !== 'EXTENDED') throw conflict('INVALID_TRANSITION', 'This offer is already closed');
    return this.prisma.offers.update({ where: { id: offerId }, data: { status } });
  }

  async recordJoining(p: Principal, rcId: string, joiningDate: string, meta: RequestMeta) {
    const rc = await this.assignedCandidate(p, rcId);
    const offer = await this.prisma.offers.findFirst({ where: { recruitment_candidate_id: rcId, status: 'ACCEPTED' }, orderBy: { created_at: 'desc' } });
    if (!offer) throw unprocessable('OFFER_ACCEPTANCE_REQUIRED', 'Record an accepted offer first');
    const existing = await this.prisma.candidate_joinings.findUnique({ where: { recruitment_candidate_id: rcId } });
    if (existing) throw conflict('ALREADY_RECORDED', 'Joining already recorded');
    const cs = await this.prisma.recruitment_cases.findUniqueOrThrow({ where: { id: rc.case_id }, include: { recruitment_agreements: true } });
    const joinedStage = await this.stageBySemantic(this.prisma, 'JOINED');
    return this.prisma.tx(async (tx) => {
      const j = await tx.candidate_joinings.create({
        data: {
          recruitment_candidate_id: rcId, offer_id: offer.id, joining_date: new Date(joiningDate), annual_ctc_paise: offer.annual_ctc_paise,
          recruiter_confirmed_by: p.userId, recruiter_confirmed_at: new Date(), payment_trigger_days: cs.recruitment_agreements.payment_trigger_days,
        },
      });
      await this.setStage(tx, rcId, rc.stage_id, joinedStage.id, p.userId, `Joined on ${joiningDate} (awaiting employer confirmation)`);
      await this.audit.record(tx, p, meta, { action: 'joining.confirmed', entityType: 'candidate_joining', entityId: j.id, employerId: cs.employer_id, metadata: { side: 'RECRUITER' } });
      await this.notify.toEmployer(cs.employer_id, {
        type: 'JOINING_CONFIRMATION', title: 'Please confirm a candidate joining',
        body: `Confirm the joining date ${joiningDate} to start the ${cs.recruitment_agreements.payment_trigger_days}-day period.`,
        link: `/requirements/${cs.hiring_requirement_id}`,
      }, tx);
      await this.activateTracking(tx, j.id);
      return j;
    });
  }

  tracking(p: Principal, dueWithinDays?: number) {
    const scope = p.aud === 'admin' ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM recruitment_case_assignments a WHERE a.case_id = rc.case_id AND a.recruiter_id = ${p.recruiterId!}::uuid AND a.unassigned_at IS NULL)`;
    const due = dueWithinDays ? Prisma.sql`AND j.billing_due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date + ${dueWithinDays}::int` : Prisma.empty;
    return this.prisma.$queryRaw<any[]>`
      SELECT j.id, j.joining_date, j.billing_due_date, j.payment_trigger_days, j.tracking_status, j.annual_ctc_paise,
             j.still_employed_confirmed_at, j.employer_confirmed_at, j.recruiter_confirmed_at, j.left_on,
             (j.billing_due_date - (now() AT TIME ZONE 'Asia/Kolkata')::date) AS days_remaining,
             ((now() AT TIME ZONE 'Asia/Kolkata')::date - j.joining_date) AS days_elapsed,
             c.first_name || ' ' || c.last_name AS candidate_name, r.role_title, co.display_name AS company, rc.case_id,
             b.status AS billing_status, b.fee_amount_paise, b.fee_percentage,
             (SELECT json_agg(json_build_object('dayOffset', jr.day_offset, 'dueOn', jr.due_on, 'sent', jr.sent_at IS NOT NULL) ORDER BY jr.day_offset)
                FROM joining_reminders jr WHERE jr.joining_id = j.id) AS reminders
      FROM candidate_joinings j
      JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
      JOIN recruitment_cases cs ON cs.id = rc.case_id
      JOIN hiring_requirements r ON r.id = cs.hiring_requirement_id
      JOIN companies co ON co.id = r.company_id
      JOIN candidates c ON c.id = rc.candidate_id
      LEFT JOIN consultant_billing b ON b.joining_id = j.id
      WHERE true ${scope} ${due}
      ORDER BY j.tracking_status = 'TRACKING' DESC, j.billing_due_date`;
  }

  async stillEmployed(p: Principal, joiningId: string, meta: RequestMeta) {
    const j = await this.prisma.candidate_joinings.findUnique({ where: { id: joiningId } });
    if (!j) throw notFound('Joining');
    await this.assignedCandidate(p, j.recruitment_candidate_id);
    if (j.tracking_status !== 'TRACKING') throw conflict('INVALID_TRANSITION', 'Only joinings in tracking can be confirmed');
    await this.prisma.tx(async (tx) => {
      await tx.candidate_joinings.update({ where: { id: joiningId }, data: { still_employed_confirmed_at: new Date(), still_employed_confirmed_by: p.userId } });
      await this.audit.record(tx, p, meta, { action: 'joining.still_employed_confirmed', entityType: 'candidate_joining', entityId: joiningId });
    });
    return { ok: true };
  }

  async recruiterLeft(p: Principal, joiningId: string, leftOn: string, reason: string, meta: RequestMeta) {
    const j = await this.prisma.candidate_joinings.findUnique({ where: { id: joiningId } });
    if (!j) throw notFound('Joining');
    await this.assignedCandidate(p, j.recruitment_candidate_id);
    return this.recordLeft(p, joiningId, leftOn, reason, meta);
  }

  billing(p: Principal) {
    if (p.aud !== 'recruiter' && p.aud !== 'admin') throw forbidden();
    const scope = p.aud === 'admin' ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM recruitment_case_assignments a WHERE a.case_id = rc.case_id AND a.recruiter_id = ${p.recruiterId!}::uuid AND a.unassigned_at IS NULL)`;
    return this.prisma.$queryRaw<any[]>`
      SELECT b.id, b.status, b.annual_ctc_paise, b.fee_percentage, b.fee_amount_paise, b.billable_at, b.status_reason, b.created_at,
             j.joining_date, j.billing_due_date, c.first_name || ' ' || c.last_name AS candidate_name, co.display_name AS company, r.role_title
      FROM consultant_billing b
      JOIN candidate_joinings j ON j.id = b.joining_id
      JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
      JOIN recruitment_cases cs ON cs.id = rc.case_id
      JOIN hiring_requirements r ON r.id = cs.hiring_requirement_id
      JOIN companies co ON co.id = r.company_id
      JOIN candidates c ON c.id = rc.candidate_id
      WHERE true ${scope}
      ORDER BY b.created_at DESC`;
  }

  /**
   * Daily billing trigger (docs/06-business-rules.md §8): due date reached AND a
   * "still employed" confirmation at/after day (trigger − 5) → BILLABLE.
   * Never bills on assumption; unconfirmed rows stay PENDING_TRIGGER.
   */
  async runBillingTrigger() {
    const due = await this.prisma.$queryRaw<{ id: string; recruitment_candidate_id: string; employer_id: string }[]>`
      SELECT j.id, j.recruitment_candidate_id, b.employer_id
      FROM candidate_joinings j JOIN consultant_billing b ON b.joining_id = j.id
      WHERE j.tracking_status = 'TRACKING' AND b.status = 'PENDING_TRIGGER'
        AND j.billing_due_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
        AND j.still_employed_confirmed_at IS NOT NULL
        AND (j.still_employed_confirmed_at AT TIME ZONE 'Asia/Kolkata')::date >= j.joining_date + (j.payment_trigger_days - 5)`;
    const billable = await this.stageBySemantic(this.prisma, 'BILLABLE');
    for (const row of due) {
      await this.prisma.tx(async (tx) => {
        await tx.consultant_billing.update({ where: { joining_id: row.id }, data: { status: 'BILLABLE', billable_at: new Date(), updated_at: new Date() } });
        await tx.candidate_joinings.update({ where: { id: row.id }, data: { tracking_status: 'COMPLETED' } });
        const rc = await tx.recruitment_candidates.findUniqueOrThrow({ where: { id: row.recruitment_candidate_id } });
        await this.setStage(tx, rc.id, rc.stage_id, billable.id, null, 'Trigger period completed');
        await this.audit.record(tx, null, null, { action: 'billing.status_changed', entityType: 'consultant_billing', entityId: row.id, employerId: row.employer_id, metadata: { to: 'BILLABLE' } });
      });
    }
    return due.length;
  }

  async runReminders() {
    const rows = await this.prisma.$queryRaw<{ id: string; day_offset: number; joining_id: string; recruitment_candidate_id: string; candidate_name: string }[]>`
      SELECT jr.id, jr.day_offset, jr.joining_id, j.recruitment_candidate_id, c.first_name || ' ' || c.last_name AS candidate_name
      FROM joining_reminders jr
      JOIN candidate_joinings j ON j.id = jr.joining_id AND j.tracking_status = 'TRACKING'
      JOIN recruitment_candidates rc ON rc.id = j.recruitment_candidate_id
      JOIN candidates c ON c.id = rc.candidate_id
      WHERE jr.sent_at IS NULL AND jr.due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date`;
    for (const r of rows) {
      await this.prisma.tx(async (tx) => {
        await this.notifyRecruiters(tx, r.recruitment_candidate_id, `Day ${r.day_offset} check: ${r.candidate_name}`, 'Confirm the candidate is still employed in the 90-day tracker.');
        await tx.joining_reminders.update({ where: { id: r.id }, data: { sent_at: new Date() } });
      });
    }
    return rows.length;
  }
}
