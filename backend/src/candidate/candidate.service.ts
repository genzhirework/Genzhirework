import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import type { Principal, RequestMeta } from '../common/decorators';
import { conflict, notFound, unprocessable } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { CandidateIndexService } from './candidate-index.service';
import type {
  CertificationDto, EducationDto, ExperienceDto, ProjectDto, UpdateProfileDto,
} from './candidate.dto';
import { loadCandidate, presentCandidate } from './profile.presenter';

type Section = 'education' | 'experience' | 'projects' | 'certifications';

const toDate = (v?: string | null) => (v ? new Date(v) : null);

const SECTION_MAP = {
  education: (d: EducationDto) => ({
    level: d.level, degree: d.degree ?? null, specialization: d.specialization ?? null, institution: d.institution,
    university_board: d.universityBoard ?? null, start_year: d.startYear ?? null, graduation_year: d.graduationYear ?? null,
    is_pursuing: d.isPursuing ?? false, score_type: d.scoreType ?? null, score: d.score ?? null,
  }),
  experience: (d: ExperienceDto) => ({
    company_name: d.companyName, title: d.title, employment_type: d.employmentType, location: d.location ?? null,
    start_date: new Date(d.startDate), end_date: d.isCurrent ? null : toDate(d.endDate), is_current: d.isCurrent ?? false,
    description: d.description ?? null,
  }),
  projects: (d: ProjectDto) => ({
    title: d.title, description: d.description ?? null, role: d.role ?? null, project_url: d.projectUrl ?? null, repo_url: d.repoUrl ?? null,
  }),
  certifications: (d: CertificationDto) => ({
    name: d.name, issuer: d.issuer, issue_date: toDate(d.issueDate), credential_id: d.credentialId ?? null, credential_url: d.credentialUrl ?? null,
  }),
};

@Injectable()
export class CandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly index: CandidateIndexService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notify: NotifyService,
  ) {}

  private cid(p: Principal) {
    if (!p.candidateId) throw notFound('Candidate');
    return p.candidateId;
  }

  async me(p: Principal) {
    const id = this.cid(p);
    const [c, consents] = await Promise.all([loadCandidate(this.prisma, id), this.currentConsents(id)]);
    if (!c) throw notFound('Candidate');
    const completion = this.index.completionOf(c);
    return {
      id: c.id,
      firstName: c.first_name,
      lastName: c.last_name,
      email: c.contact_email,
      phone: c.contact_phone_e164,
      city: c.city,
      state: c.state,
      onboardingCompleted: !!c.onboarding_completed_at,
      profile: c.candidate_profiles,
      visibility: c.candidate_visibility,
      education: c.candidate_education,
      experience: c.candidate_experience,
      projects: c.candidate_projects,
      certifications: c.candidate_certifications,
      skills: c.candidate_skills.map((s) => ({ id: s.skills.id, name: s.skills.name, proficiency: s.proficiency })),
      resumes: c.resumes.map((r) => ({ id: r.id, label: r.label, isPrimary: r.is_primary, createdAt: r.created_at, file: r.files })),
      consents,
      completion,
    };
  }

  async updateProfile(p: Principal, d: UpdateProfileDto) {
    const id = this.cid(p);
    await this.prisma.tx(async (tx) => {
      await tx.candidates.update({
        where: { id },
        data: {
          ...(d.firstName !== undefined && { first_name: d.firstName }),
          ...(d.lastName !== undefined && { last_name: d.lastName }),
          ...(d.phone !== undefined && { contact_phone_e164: d.phone }),
          ...(d.city !== undefined && { city: d.city }),
          ...(d.state !== undefined && { state: d.state }),
          updated_at: new Date(),
        },
      });
      await tx.candidate_profiles.update({
        where: { candidate_id: id },
        data: {
          ...(d.headline !== undefined && { headline: d.headline }),
          ...(d.summary !== undefined && { summary: d.summary }),
          ...(d.targetRole !== undefined && { target_role: d.targetRole }),
          ...(d.currentJobTitle !== undefined && { current_job_title: d.currentJobTitle }),
          ...(d.employmentStatus !== undefined && { employment_status: d.employmentStatus }),
          ...(d.totalExperienceMonths !== undefined && { total_experience_months: d.totalExperienceMonths }),
          ...(d.expectedCtcMinPaise !== undefined && { expected_ctc_min_paise: BigInt(d.expectedCtcMinPaise) }),
          ...(d.expectedCtcMaxPaise !== undefined && { expected_ctc_max_paise: BigInt(d.expectedCtcMaxPaise) }),
          ...(d.availability !== undefined && { availability: d.availability }),
          ...(d.preferredWorkModes !== undefined && { preferred_work_modes: d.preferredWorkModes }),
          ...(d.preferredCities !== undefined && { preferred_cities: d.preferredCities }),
          ...(d.preferredEmploymentTypes !== undefined && { preferred_employment_types: d.preferredEmploymentTypes }),
          ...(d.links !== undefined && { links: d.links as object[] }),
          last_active_at: new Date(),
        },
      });
    });
    await this.index.refresh(id);
    return this.me(p);
  }

  async completeOnboarding(p: Principal) {
    const id = this.cid(p);
    const c = await loadCandidate(this.prisma, id);
    if (!c?.city || !c.candidate_education.length || c.candidate_skills.length < 3) {
      throw unprocessable('ONBOARDING_INCOMPLETE', 'Add your city, one education entry and at least 3 skills');
    }
    await this.prisma.candidates.update({ where: { id }, data: { onboarding_completed_at: new Date() } });
    await this.index.refresh(id);
    return this.me(p);
  }

  // ---- repeatable sections -------------------------------------------------

  private delegate(section: Section) {
    return {
      education: this.prisma.candidate_education,
      experience: this.prisma.candidate_experience,
      projects: this.prisma.candidate_projects,
      certifications: this.prisma.candidate_certifications,
    }[section] as any;
  }

  async addSection(p: Principal, section: Section, dto: any) {
    const id = this.cid(p);
    const count = await this.delegate(section).count({ where: { candidate_id: id } });
    if (count >= 20) throw unprocessable('LIMIT_REACHED', 'You can add up to 20 entries');
    const row = await this.delegate(section).create({ data: { candidate_id: id, ...(SECTION_MAP[section] as any)(dto) } });
    await this.index.refresh(id);
    return row;
  }

  async updateSection(p: Principal, section: Section, rowId: string, dto: any) {
    const id = this.cid(p);
    const res = await this.delegate(section).updateMany({ where: { id: rowId, candidate_id: id }, data: (SECTION_MAP[section] as any)(dto) });
    if (!res.count) throw notFound();
    await this.index.refresh(id);
    return { ok: true };
  }

  async deleteSection(p: Principal, section: Section, rowId: string) {
    const id = this.cid(p);
    const res = await this.delegate(section).deleteMany({ where: { id: rowId, candidate_id: id } });
    if (!res.count) throw notFound();
    await this.index.refresh(id);
  }

  async setSkills(p: Principal, skills: { skillId: number; proficiency?: string }[]) {
    const id = this.cid(p);
    const unique = [...new Map(skills.map((s) => [s.skillId, s])).values()];
    const known = await this.prisma.skills.count({ where: { id: { in: unique.map((s) => s.skillId) } } });
    if (known !== unique.length) throw unprocessable('UNKNOWN_SKILL', 'One or more skills are not recognised');
    await this.prisma.tx(async (tx) => {
      await tx.candidate_skills.deleteMany({ where: { candidate_id: id } });
      await tx.candidate_skills.createMany({
        data: unique.map((s, i) => ({ candidate_id: id, skill_id: s.skillId, proficiency: s.proficiency ?? null, sort_order: i })),
      });
    });
    await this.index.refresh(id);
    return { ok: true };
  }

  // ---- resumes -------------------------------------------------------------

  async addResume(p: Principal, fileId: string, label?: string) {
    const id = this.cid(p);
    const file = await this.prisma.files.findUnique({ where: { id: fileId } });
    if (!file || file.owner_user_id !== p.userId || file.purpose !== 'RESUME') throw notFound('File');
    const existing = await this.prisma.resumes.count({ where: { candidate_id: id, deleted_at: null } });
    if (existing >= 3) throw unprocessable('LIMIT_REACHED', 'You can keep up to 3 resumes. Delete one first.');
    const r = await this.prisma.resumes.create({
      data: { candidate_id: id, file_id: fileId, label: label ?? file.original_name.replace(/\.[^.]+$/, ''), is_primary: existing === 0 },
    });
    await this.audit.recordStandalone(p, null, { action: 'resume.uploaded', entityType: 'resume', entityId: r.id });
    await this.index.refresh(id);
    return r;
  }

  async patchResume(p: Principal, resumeId: string, isPrimary?: boolean, label?: string) {
    const id = this.cid(p);
    const r = await this.prisma.resumes.findFirst({ where: { id: resumeId, candidate_id: id, deleted_at: null } });
    if (!r) throw notFound('Resume');
    await this.prisma.tx(async (tx) => {
      if (isPrimary) await tx.resumes.updateMany({ where: { candidate_id: id }, data: { is_primary: false } });
      await tx.resumes.update({ where: { id: r.id }, data: { ...(isPrimary && { is_primary: true }), ...(label && { label }) } });
    });
    return { ok: true };
  }

  async deleteResume(p: Principal, resumeId: string) {
    const id = this.cid(p);
    const r = await this.prisma.resumes.findFirst({ where: { id: resumeId, candidate_id: id, deleted_at: null } });
    if (!r) throw notFound('Resume');
    await this.prisma.tx(async (tx) => {
      await tx.resumes.update({ where: { id: r.id }, data: { deleted_at: new Date(), is_primary: false } });
      if (r.is_primary) {
        const next = await tx.resumes.findFirst({ where: { candidate_id: id, deleted_at: null }, orderBy: { created_at: 'desc' } });
        if (next) await tx.resumes.update({ where: { id: next.id }, data: { is_primary: true } });
      }
      await this.audit.record(tx, p, null, { action: 'resume.deleted', entityType: 'resume', entityId: r.id });
    });
    await this.index.refresh(id);
  }

  // ---- privacy ---------------------------------------------------------------

  async setVisibility(p: Principal, level: string, openToWork: boolean | undefined, meta: RequestMeta) {
    const id = this.cid(p);
    await this.prisma.tx(async (tx) => {
      await tx.candidate_visibility.update({
        where: { candidate_id: id },
        data: { level, ...(openToWork !== undefined && { open_to_work: openToWork }), updated_at: new Date() },
      });
      await this.audit.record(tx, p, meta, { action: 'candidate.visibility_changed', entityType: 'candidate', entityId: id, metadata: { level } });
    });
    await this.index.refresh(id);
    return { level, openToWork };
  }

  async currentConsents(candidateId: string) {
    const rows = await this.prisma.$queryRaw<{ purpose: string; granted: boolean; created_at: Date }[]>`
      SELECT DISTINCT ON (purpose) purpose, granted, created_at FROM candidate_consents
      WHERE candidate_id = ${candidateId}::uuid ORDER BY purpose, created_at DESC`;
    return rows;
  }

  async setConsent(p: Principal, purpose: string, granted: boolean, meta: RequestMeta) {
    const id = this.cid(p);
    const policy = await this.prisma.policy_documents.findFirstOrThrow({ where: { type: 'PRIVACY_POLICY' }, orderBy: { published_at: 'desc' } });
    await this.prisma.tx(async (tx) => {
      await tx.candidate_consents.create({
        data: { candidate_id: id, purpose, granted, policy_document_id: policy.id, source: 'SETTINGS', ip_address: meta.ip, user_agent: meta.userAgent },
      });
      await this.audit.record(tx, p, meta, { action: 'candidate.consent_changed', entityType: 'candidate', entityId: id, metadata: { purpose, granted } });
    });
    await this.index.refresh(id);
    return this.currentConsents(id);
  }

  blockedEmployers(p: Principal) {
    return this.prisma.candidate_blocked_employers.findMany({
      where: { candidate_id: this.cid(p) },
      select: { employer_id: true, created_at: true, employers: { select: { name: true } } },
    });
  }

  searchEmployersToBlock(q: string) {
    if (!q || q.length < 2) return [];
    return this.prisma.employers.findMany({
      where: { name: { contains: q, mode: 'insensitive' }, status: 'ACTIVE' },
      select: { id: true, name: true },
      take: 10,
    });
  }

  async block(p: Principal, employerId: string, meta: RequestMeta) {
    const id = this.cid(p);
    const e = await this.prisma.employers.findUnique({ where: { id: employerId } });
    if (!e) throw notFound('Employer');
    await this.prisma.tx(async (tx) => {
      await tx.candidate_blocked_employers.upsert({
        where: { candidate_id_employer_id: { candidate_id: id, employer_id: employerId } },
        create: { candidate_id: id, employer_id: employerId },
        update: {},
      });
      await this.audit.record(tx, p, meta, { action: 'candidate.employer_blocked', entityType: 'candidate', entityId: id, metadata: { employerId } });
    });
    return { ok: true };
  }

  async unblock(p: Principal, employerId: string) {
    await this.prisma.candidate_blocked_employers.deleteMany({ where: { candidate_id: this.cid(p), employer_id: employerId } });
  }

  /** "Who viewed my profile" — company + action + date only. */
  async profileAccess(p: Principal) {
    return this.prisma.$queryRaw<{ company: string; action: string; created_at: Date }[]>`
      SELECT coalesce(co.display_name, e.name, 'GenZHire recruiter') AS company, v.action, v.created_at
      FROM candidate_profile_views v
      LEFT JOIN employers e ON e.id = v.employer_id
      LEFT JOIN LATERAL (SELECT display_name FROM companies WHERE employer_id = e.id ORDER BY created_at LIMIT 1) co ON true
      WHERE v.candidate_id = ${this.cid(p)}::uuid AND v.viewer_type <> 'ADMIN'
      ORDER BY v.created_at DESC LIMIT 100`;
  }

  async preview(p: Principal, as: 'CARD' | 'LOCKED' | 'FULL') {
    const c = await loadCandidate(this.prisma, this.cid(p));
    if (!c) throw notFound();
    const nameDisplay = await this.settings.str('talent.search_card_name_display');
    return presentCandidate(c, as, { nameDisplay });
  }

  // ---- saved jobs ------------------------------------------------------------

  savedJobs(p: Principal) {
    return this.prisma.saved_jobs.findMany({
      where: { candidate_id: this.cid(p) },
      orderBy: { created_at: 'desc' },
      include: {
        jobs: {
          select: {
            id: true, title: true, slug: true, status: true, work_mode: true, employment_type: true,
            salary_min_paise: true, salary_max_paise: true, salary_visible: true, experience_min_months: true,
            experience_max_months: true, published_at: true, application_deadline: true,
            companies: { select: { display_name: true, slug: true } },
            employers: { select: { verification_status: true } },
            job_locations: { select: { city: true } },
          },
        },
      },
    });
  }

  async saveJob(p: Principal, jobId: string) {
    const job = await this.prisma.jobs.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'PUBLISHED') throw notFound('Job');
    await this.prisma.saved_jobs.upsert({
      where: { candidate_id_job_id: { candidate_id: this.cid(p), job_id: jobId } },
      create: { candidate_id: this.cid(p), job_id: jobId },
      update: {},
    });
    return { saved: true };
  }

  async unsaveJob(p: Principal, jobId: string) {
    await this.prisma.saved_jobs.deleteMany({ where: { candidate_id: this.cid(p), job_id: jobId } });
  }

  // ---- contact requests --------------------------------------------------------

  contactRequests(p: Principal) {
    return this.prisma.contact_requests.findMany({
      where: { candidate_id: this.cid(p) },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, message: true, status: true, created_at: true, expires_at: true, responded_at: true,
        employers: { select: { name: true, verification_status: true } },
        jobs: { select: { id: true, title: true } },
      },
    });
  }

  async respondContact(p: Principal, requestId: string, accept: boolean, meta: RequestMeta) {
    const id = this.cid(p);
    const r = await this.prisma.contact_requests.findFirst({ where: { id: requestId, candidate_id: id } });
    if (!r) throw notFound('Contact request');
    if (r.status !== 'PENDING' || r.expires_at < new Date()) throw conflict('NOT_PENDING', 'This request is no longer pending');
    await this.prisma.tx(async (tx) => {
      await tx.contact_requests.update({ where: { id: r.id }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', responded_at: new Date() } });
      if (accept) {
        const validity = await this.settings.num('talent.unlock_validity_days');
        await tx.profile_unlocks.upsert({
          where: { employer_id_candidate_id_unlock_type: { employer_id: r.employer_id, candidate_id: id, unlock_type: 'CONTACT' } },
          create: { employer_id: r.employer_id, candidate_id: id, unlock_type: 'CONTACT', unlocked_by: r.requested_by, expires_at: new Date(Date.now() + validity * 86400_000) },
          update: { expires_at: new Date(Date.now() + validity * 86400_000), unlocked_at: new Date() },
        });
      }
      await this.audit.record(tx, p, meta, {
        action: accept ? 'candidate.contact_shared' : 'candidate.contact_declined',
        entityType: 'contact_request', entityId: r.id, employerId: r.employer_id,
      });
      const c = await tx.candidates.findUniqueOrThrow({ where: { id } });
      await this.notify.send({
        userId: r.requested_by,
        app: 'employer',
        type: accept ? 'CONTACT_ACCEPTED' : 'CONTACT_DECLINED',
        title: accept ? `${c.first_name} shared their contact details` : `${c.first_name} declined your contact request`,
        body: accept ? 'You can now see their email and phone on their profile.' : 'You can still review their profile.',
        link: `/talent/candidates/${id}`,
      }, tx);
    });
    return { ok: true };
  }
}
