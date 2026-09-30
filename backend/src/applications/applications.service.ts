import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import type { Principal, RequestMeta } from '../common/decorators';
import { AppError, conflict, notFound, unprocessable } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService } from '../common/prisma.service';
import { loadCandidate, presentCandidate } from '../candidate/profile.presenter';
import { FilesService } from '../files/files.service';

/**
 * Allowed employer moves (docs/06-business-rules.md §5). `confirm` marks moves
 * that require an explicit confirmation flag; `back` marks backward moves which
 * are not notified to the candidate.
 */
const TRANSITIONS: Record<string, Record<string, { confirm?: boolean; back?: boolean }>> = {
  APPLIED: { SCREENING: {}, SHORTLISTED: {}, INTERVIEW: {}, REJECTED: { confirm: true } },
  VIEWED: { SCREENING: {}, SHORTLISTED: {}, INTERVIEW: {}, REJECTED: { confirm: true } },
  SCREENING: { SHORTLISTED: {}, INTERVIEW: {}, REJECTED: { confirm: true } },
  SHORTLISTED: { SCREENING: { back: true }, INTERVIEW: {}, SELECTED: { confirm: true }, REJECTED: { confirm: true } },
  INTERVIEW: { SHORTLISTED: { back: true }, SELECTED: { confirm: true }, REJECTED: { confirm: true } },
  SELECTED: { INTERVIEW: { back: true, confirm: true }, REJECTED: { confirm: true } },
  REJECTED: { SCREENING: { back: true, confirm: true } },
  WITHDRAWN: {},
};

export const CANDIDATE_LABEL: Record<string, string> = {
  APPLIED: 'Applied', VIEWED: 'Viewed', SCREENING: 'In review', SHORTLISTED: 'Shortlisted',
  INTERVIEW: 'Interview', SELECTED: 'Selected', REJECTED: 'Not selected', WITHDRAWN: 'Withdrawn',
};

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------- candidate

  async apply(p: Principal, jobId: string, resumeId: string, coverNote?: string) {
    const cid = p.candidateId!;
    const job = await this.prisma.jobs.findUnique({ where: { id: jobId }, include: { job_skills: true, employers: true } });
    if (!job || job.employers.status !== 'ACTIVE') throw notFound('Job');
    if (job.status !== 'PUBLISHED' || (job.application_deadline && job.application_deadline < new Date(new Date().toDateString()))) {
      throw unprocessable('JOB_NOT_OPEN', 'This job is no longer accepting applications');
    }
    const blocked = await this.prisma.candidate_blocked_employers.findUnique({
      where: { candidate_id_employer_id: { candidate_id: cid, employer_id: job.employer_id } },
    });
    if (blocked) throw unprocessable('EMPLOYER_BLOCKED', 'You have blocked this employer. Unblock them in Privacy settings to apply.');
    const resume = await this.prisma.resumes.findFirst({ where: { id: resumeId, candidate_id: cid, deleted_at: null }, include: { files: true } });
    if (!resume) throw notFound('Resume');
    if (resume.files.scan_status !== 'CLEAN') throw unprocessable('RESUME_NOT_READY', 'Your resume is still being checked');

    const c = await loadCandidate(this.prisma, cid);
    if (!c) throw notFound('Candidate');
    const candidateSkills = new Set(c.candidate_skills.map((s) => s.skill_id));
    const jobSkills = job.job_skills.map((s) => s.skill_id);
    const matchScore = jobSkills.length ? Math.round((jobSkills.filter((s) => candidateSkills.has(s)).length / jobSkills.length) * 100) : null;

    try {
      return await this.prisma.tx(async (tx) => {
        const app = await tx.applications.create({
          data: {
            job_id: jobId, employer_id: job.employer_id, candidate_id: cid, resume_id: resume.id, resume_file_id: resume.file_id,
            cover_note: coverNote?.trim() || null, profile_snapshot: presentCandidate(c, 'FULL') as object, match_score: matchScore,
          },
          select: { id: true, status: true, applied_at: true },
        });
        await tx.application_status_history.create({ data: { application_id: app.id, to_status: 'APPLIED', changed_by: p.userId } });
        await this.notify.send({
          userId: p.userId, app: 'jobseeker', type: 'APPLICATION_SUBMITTED',
          title: `Application sent: ${job.title}`, body: 'You can track its status in Applications.', link: `/app/applications/${app.id}`,
        }, tx);
        await this.notify.toEmployer(job.employer_id, {
          type: 'NEW_APPLICATION', title: `New applicant for ${job.title}`,
          body: `${c.first_name} ${c.last_name} applied.`, link: `/jobs/${job.id}/applications`,
        }, tx);
        return app;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('ALREADY_APPLIED', 'You have already applied to this job');
      throw e;
    }
  }

  async mine(p: Principal, status?: string) {
    const rows = await this.prisma.applications.findMany({
      where: { candidate_id: p.candidateId!, ...(status && { status }) },
      orderBy: { applied_at: 'desc' },
      select: {
        id: true, status: true, applied_at: true, status_changed_at: true,
        jobs: { select: { id: true, title: true, status: true, work_mode: true, companies: { select: { display_name: true } }, job_locations: { select: { city: true } } } },
      },
    });
    return rows.map((r) => ({ ...r, statusLabel: CANDIDATE_LABEL[r.status] }));
  }

  async mineOne(p: Principal, id: string) {
    const a = await this.prisma.applications.findFirst({
      where: { id, candidate_id: p.candidateId! },
      include: {
        jobs: { select: { id: true, title: true, status: true, work_mode: true, employment_type: true, companies: { select: { display_name: true } }, job_locations: { select: { city: true } } } },
        application_status_history: { orderBy: { created_at: 'asc' }, select: { to_status: true, created_at: true, from_status: true } },
        resumes: { select: { label: true } },
      },
    });
    if (!a) throw notFound('Application');
    // Backward moves are internal to the employer; candidates see forward progress only.
    const order = ['APPLIED', 'VIEWED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED'];
    const timeline = a.application_status_history
      .filter((h) => !h.from_status || order.indexOf(h.to_status) > order.indexOf(h.from_status) || ['REJECTED', 'WITHDRAWN'].includes(h.to_status))
      .map((h) => ({ status: h.to_status, label: CANDIDATE_LABEL[h.to_status], at: h.created_at }));
    return {
      id: a.id, status: a.status, statusLabel: CANDIDATE_LABEL[a.status], appliedAt: a.applied_at, coverNote: a.cover_note,
      resumeLabel: a.resumes?.label ?? null, job: a.jobs, timeline,
    };
  }

  async withdraw(p: Principal, id: string) {
    const a = await this.prisma.applications.findFirst({ where: { id, candidate_id: p.candidateId! } });
    if (!a) throw notFound('Application');
    if (['SELECTED', 'REJECTED', 'WITHDRAWN'].includes(a.status)) throw conflict('INVALID_TRANSITION', 'This application can no longer be withdrawn');
    await this.prisma.tx(async (tx) => {
      await tx.applications.update({ where: { id }, data: { status: 'WITHDRAWN', status_changed_at: new Date() } });
      await tx.application_status_history.create({ data: { application_id: id, from_status: a.status, to_status: 'WITHDRAWN', changed_by: p.userId } });
    });
    return { id, status: 'WITHDRAWN' };
  }

  // -------------------------------------------------------------- employer

  async employerList(p: Principal, jobId?: string, status?: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT a.id, a.status, a.applied_at, a.status_changed_at, a.match_score, a.job_id, j.title AS job_title,
             c.id AS candidate_id, c.first_name || ' ' || c.last_name AS candidate_name, c.city,
             a.profile_snapshot->>'headline' AS headline,
             a.profile_snapshot->'education' AS education,
             (a.profile_snapshot->'skills') AS skills
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      JOIN candidates c ON c.id = a.candidate_id
      WHERE a.employer_id = ${p.employerId!}::uuid
        AND a.status <> 'WITHDRAWN'
        AND (${jobId ?? null}::uuid IS NULL OR a.job_id = ${jobId ?? null}::uuid)
        AND (${status ?? null}::text IS NULL OR a.status = ${status ?? null})
      ORDER BY a.applied_at DESC
      LIMIT 500`;
  }

  private async owned(p: Principal, id: string) {
    const a = await this.prisma.applications.findFirst({ where: { id, employer_id: p.employerId! } });
    if (!a) throw notFound('Application');
    return a;
  }

  async employerOne(p: Principal, id: string, meta: RequestMeta) {
    let a = await this.owned(p, id);
    const c = await loadCandidate(this.prisma, a.candidate_id);
    if (!c) throw notFound('Candidate');
    await this.prisma.tx(async (tx) => {
      if (a.status === 'APPLIED') {
        a = await tx.applications.update({ where: { id }, data: { status: 'VIEWED', status_changed_at: new Date() } });
        await tx.application_status_history.create({ data: { application_id: id, from_status: 'APPLIED', to_status: 'VIEWED', changed_by: null } });
        await this.notify.send({
          userId: c.user_id, app: 'jobseeker', type: 'APPLICATION_STATUS_CHANGED',
          title: 'Your application was viewed', body: 'The employer has opened your application.', link: `/app/applications/${id}`,
        }, tx);
      }
      await tx.candidate_profile_views.create({
        data: {
          viewer_user_id: p.userId, viewer_type: 'EMPLOYER', employer_id: p.employerId!, candidate_id: c.id,
          action: 'FULL_PROFILE_VIEW', access_basis: 'APPLICATION', ip_address: meta.ip, user_agent: meta.userAgent, request_id: meta.requestId,
        },
      });
    });
    const job = await this.prisma.jobs.findUniqueOrThrow({ where: { id: a.job_id }, select: { id: true, title: true } });
    const history = await this.prisma.application_status_history.findMany({
      where: { application_id: id }, orderBy: { created_at: 'asc' },
      select: { from_status: true, to_status: true, note: true, created_at: true, users: { select: { full_name: true } } },
    });
    return {
      id: a.id, status: a.status, appliedAt: a.applied_at, coverNote: a.cover_note, matchScore: a.match_score,
      job, history, candidate: presentCandidate(c, 'CONTACT'), allowedTransitions: TRANSITIONS[a.status] ?? {},
    };
  }

  async changeStatus(p: Principal, id: string, to: string, note: string | undefined, confirmed: boolean, meta: RequestMeta) {
    const a = await this.owned(p, id);
    const rule = TRANSITIONS[a.status]?.[to];
    if (!rule) throw conflict('INVALID_TRANSITION', `Cannot move an application from ${a.status} to ${to}`);
    if (rule.confirm && !confirmed) throw new AppError(428, 'CONFIRMATION_REQUIRED', 'Please confirm this status change');
    const job = await this.prisma.jobs.findUniqueOrThrow({ where: { id: a.job_id }, select: { title: true } });
    const cand = await this.prisma.candidates.findUniqueOrThrow({ where: { id: a.candidate_id }, select: { user_id: true } });
    await this.prisma.tx(async (tx) => {
      await tx.applications.update({ where: { id }, data: { status: to, status_changed_at: new Date() } });
      await tx.application_status_history.create({ data: { application_id: id, from_status: a.status, to_status: to, changed_by: p.userId, note: note ?? null } });
      await this.audit.record(tx, p, meta, { action: 'application.status_changed', entityType: 'application', entityId: id, employerId: p.employerId, metadata: { from: a.status, to } });
      if (!rule.back) {
        await this.notify.send({
          userId: cand.user_id, app: 'jobseeker', type: 'APPLICATION_STATUS_CHANGED',
          title: `${job.title}: ${CANDIDATE_LABEL[to]}`,
          body: to === 'REJECTED' ? 'The employer has decided not to move forward. Keep going — new roles are posted every day.' : `Your application status is now "${CANDIDATE_LABEL[to]}".`,
          link: `/app/applications/${id}`,
        }, tx);
      }
    });
    return { id, status: to, allowedTransitions: TRANSITIONS[to] ?? {} };
  }

  async resume(p: Principal, id: string, meta: RequestMeta) {
    const a = await this.owned(p, id);
    const emp = await this.prisma.employers.findUniqueOrThrow({ where: { id: p.employerId! } });
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: p.userId } });
    const out = await this.files.watermarkedResume(a.resume_file_id, `Downloaded by ${emp.name} · ${user.email} · ${new Date().toISOString()} · GenZHire`);
    await this.prisma.tx(async (tx) => {
      await tx.candidate_profile_views.create({
        data: {
          viewer_user_id: p.userId, viewer_type: 'EMPLOYER', employer_id: emp.id, candidate_id: a.candidate_id,
          action: 'RESUME_DOWNLOAD', access_basis: 'APPLICATION', ip_address: meta.ip, user_agent: meta.userAgent, request_id: meta.requestId,
        },
      });
      await this.audit.record(tx, p, meta, { action: 'candidate.resume_downloaded', entityType: 'candidate', entityId: a.candidate_id, employerId: emp.id, metadata: { applicationId: id } });
    });
    return out;
  }
}
