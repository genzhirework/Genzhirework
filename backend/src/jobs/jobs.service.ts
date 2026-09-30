import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import type { Principal, RequestMeta } from '../common/decorators';
import { conflict, notFound, unprocessable } from '../common/errors';
import { PrismaService, Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import type { JobDto } from './jobs.dto';

export interface JobSearchQuery {
  q?: string;
  city?: string;
  workMode?: string;
  employmentType?: string;
  expMax?: string;
  salaryMin?: string;
  postedWithin?: string;
  skills?: string;
  company?: string;
  sort?: string;
  cursor?: string;
  limit?: string;
}

/** Transitions allowed from each job status (docs/06-business-rules.md §6). */
const JOB_ACTIONS: Record<string, string[]> = {
  submit: ['DRAFT', 'REJECTED'],
  pause: ['PUBLISHED'],
  resume: ['PAUSED'],
  close: ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'PAUSED'],
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------ public search

  async search(q: JobSearchQuery, viewer?: Principal) {
    const limit = clampLimit(q.limit, 20, 30);
    const binding = `jobs:${viewer?.userId ?? 'anon'}:${JSON.stringify({ ...q, cursor: undefined, limit })}`;
    const offset = decodeCursor<{ o: number }>(q.cursor, binding)?.o ?? 0;
    const maxDepth = viewer ? 1000 : 400; // anonymous visitors page through at most 20 pages
    if (offset >= maxDepth) return { data: [], page: { nextCursor: null, limit }, totalEstimate: 0 };

    const where: Prisma.Sql[] = [Prisma.sql`j.status = 'PUBLISHED'`, Prisma.sql`e.status = 'ACTIVE'`];
    const text = q.q?.trim().slice(0, 100);
    if (text) where.push(Prisma.sql`(j.search_vector @@ websearch_to_tsquery('english', ${text}) OR j.title ILIKE ${'%' + text + '%'})`);
    if (q.city) where.push(Prisma.sql`EXISTS (SELECT 1 FROM job_locations l WHERE l.job_id = j.id AND l.city ILIKE ${q.city})`);
    if (q.workMode) where.push(Prisma.sql`j.work_mode = ANY(${q.workMode.split(',')})`);
    if (q.employmentType) where.push(Prisma.sql`j.employment_type = ANY(${q.employmentType.split(',')})`);
    if (q.expMax && Number.isFinite(+q.expMax)) where.push(Prisma.sql`j.experience_min_months <= ${+q.expMax}`);
    if (q.salaryMin && Number.isFinite(+q.salaryMin)) where.push(Prisma.sql`coalesce(j.salary_max_paise, j.salary_min_paise, 0) >= ${BigInt(+q.salaryMin)}`);
    if (q.postedWithin && Number.isFinite(+q.postedWithin)) where.push(Prisma.sql`j.published_at >= now() - make_interval(days => ${+q.postedWithin})`);
    if (q.company) where.push(Prisma.sql`co.slug = ${q.company}`);
    const skillIds = (q.skills ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (skillIds.length) where.push(Prisma.sql`EXISTS (SELECT 1 FROM job_skills s WHERE s.job_id = j.id AND s.skill_id = ANY(${skillIds}))`);

    const order = text && q.sort !== 'recent'
      ? Prisma.sql`ts_rank_cd(j.search_vector, websearch_to_tsquery('english', ${text})) DESC, j.published_at DESC, j.id`
      : Prisma.sql`j.published_at DESC, j.id`;
    const whereSql = Prisma.join(where, ' AND ');

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT ${this.cardColumns()}
      FROM jobs j JOIN employers e ON e.id = j.employer_id JOIN companies co ON co.id = j.company_id
      WHERE ${whereSql}
      ORDER BY ${order}
      LIMIT ${limit + 1} OFFSET ${offset}`;
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM jobs j JOIN employers e ON e.id = j.employer_id JOIN companies co ON co.id = j.company_id
      WHERE ${whereSql}`;
    const hasMore = rows.length > limit && offset + limit < maxDepth;
    return {
      data: rows.slice(0, limit),
      page: { nextCursor: hasMore ? encodeCursor({ o: offset + limit }, binding) : null, limit },
      totalEstimate: n,
    };
  }

  private cardColumns() {
    return Prisma.sql`
      j.id, j.title, j.slug, j.work_mode, j.employment_type, j.experience_min_months, j.experience_max_months,
      CASE WHEN j.salary_visible THEN j.salary_min_paise END AS salary_min_paise,
      CASE WHEN j.salary_visible THEN j.salary_max_paise END AS salary_max_paise,
      j.salary_period, j.published_at, j.application_deadline, j.openings,
      json_build_object('name', co.display_name, 'slug', co.slug, 'logoFileId', co.logo_file_id,
                        'verified', e.verification_status = 'VERIFIED') AS company,
      (SELECT coalesce(array_agg(l.city ORDER BY l.city), '{}') FROM job_locations l WHERE l.job_id = j.id) AS cities,
      (SELECT coalesce(array_agg(s.name ORDER BY js.is_mandatory DESC, s.name), '{}')
         FROM job_skills js JOIN skills s ON s.id = js.skill_id WHERE js.job_id = j.id) AS skills`;
  }

  async featured() {
    return this.prisma.$queryRaw<any[]>`
      SELECT ${this.cardColumns()}
      FROM jobs j JOIN employers e ON e.id = j.employer_id JOIN companies co ON co.id = j.company_id
      WHERE j.status = 'PUBLISHED' AND e.status = 'ACTIVE' AND e.verification_status = 'VERIFIED'
      ORDER BY j.published_at DESC LIMIT 6`;
  }

  async publicDetail(id: string, viewer?: Principal) {
    const job = await this.prisma.jobs.findUnique({
      where: { id },
      include: {
        companies: true,
        employers: { select: { verification_status: true, status: true } },
        job_locations: true,
        job_skills: { include: { skills: { select: { id: true, name: true } } } },
      },
    });
    const visible = job && (job.status === 'PUBLISHED' || job.status === 'CLOSED') && job.employers.status === 'ACTIVE';
    if (!visible) throw notFound('Job');
    let viewerState: Record<string, unknown> | undefined;
    if (viewer?.candidateId) {
      const [saved, app] = await Promise.all([
        this.prisma.saved_jobs.findUnique({ where: { candidate_id_job_id: { candidate_id: viewer.candidateId, job_id: id } } }),
        this.prisma.applications.findUnique({ where: { job_id_candidate_id: { job_id: id, candidate_id: viewer.candidateId } } }),
      ]);
      viewerState = { saved: !!saved, applied: !!app, applicationId: app?.id ?? null, applicationStatus: app?.status ?? null };
    }
    return {
      id: job.id,
      title: job.title,
      slug: job.slug,
      status: job.status,
      department: job.department,
      description: job.description,
      responsibilities: job.responsibilities,
      requirements: job.requirements,
      minEducationLevel: job.min_education_level,
      qualifications: job.qualifications,
      experienceMinMonths: job.experience_min_months,
      experienceMaxMonths: job.experience_max_months,
      salaryMinPaise: job.salary_visible ? job.salary_min_paise : null,
      salaryMaxPaise: job.salary_visible ? job.salary_max_paise : null,
      salaryPeriod: job.salary_period,
      workMode: job.work_mode,
      employmentType: job.employment_type,
      openings: job.openings,
      applicationDeadline: job.application_deadline,
      publishedAt: job.published_at,
      locations: job.job_locations.map((l) => ({ city: l.city, state: l.state })),
      skills: job.job_skills.map((s) => ({ id: s.skills.id, name: s.skills.name, mandatory: s.is_mandatory })),
      company: {
        name: job.companies.display_name,
        slug: job.companies.slug,
        website: job.companies.website,
        industry: job.companies.industry,
        sizeBand: job.companies.size_band,
        description: job.companies.description,
        logoFileId: job.companies.logo_file_id,
        verified: job.employers.verification_status === 'VERIFIED',
      },
      viewerState,
    };
  }

  async company(slug: string) {
    const c = await this.prisma.companies.findUnique({ where: { slug }, include: { employers: true } });
    if (!c || c.employers.verification_status !== 'VERIFIED' || c.employers.status !== 'ACTIVE') throw notFound('Company');
    return {
      name: c.display_name, slug: c.slug, website: c.website, industry: c.industry, sizeBand: c.size_band,
      foundedYear: c.founded_year, description: c.description, hqCity: c.hq_city, logoFileId: c.logo_file_id, verified: true,
    };
  }

  async report(p: Principal, jobId: string, reason: string, details?: string) {
    const job = await this.prisma.jobs.findUnique({ where: { id: jobId } });
    if (!job) throw notFound('Job');
    await this.prisma.abuse_reports.create({
      data: { reporter_id: p.userId, target_type: 'JOB', target_id: jobId, reason, details: details ?? null },
    });
    return { ok: true };
  }

  skills(q?: string) {
    const text = (q ?? '').trim();
    return this.prisma.skills.findMany({
      where: {
        merged_into: null,
        ...(text && { OR: [{ name: { contains: text, mode: 'insensitive' } }, { aliases: { has: text.toLowerCase() } }] }),
      },
      select: { id: true, name: true, category: true },
      orderBy: { name: 'asc' },
      take: text ? 15 : 500,
    });
  }

  // --------------------------------------------------------------- employer

  private employerId(p: Principal) {
    if (!p.employerId) throw notFound('Employer');
    return p.employerId;
  }

  async employerJobs(p: Principal, status?: string) {
    const emp = this.employerId(p);
    return this.prisma.$queryRaw<any[]>`
      SELECT j.id, j.title, j.status, j.work_mode, j.employment_type, j.openings, j.published_at, j.created_at,
             j.application_deadline, j.moderation_reason,
             (SELECT coalesce(array_agg(l.city), '{}') FROM job_locations l WHERE l.job_id = j.id) AS cities,
             (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id) AS applicants,
             (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id AND a.status = 'APPLIED') AS new_applicants
      FROM jobs j
      WHERE j.employer_id = ${emp}::uuid ${status ? Prisma.sql`AND j.status = ${status}` : Prisma.empty}
      ORDER BY j.created_at DESC LIMIT 200`;
  }

  async employerJob(p: Principal, id: string) {
    const job = await this.prisma.jobs.findFirst({
      where: { id, employer_id: this.employerId(p) },
      include: { job_locations: true, job_skills: { include: { skills: { select: { id: true, name: true } } } } },
    });
    if (!job) throw notFound('Job');
    const { search_vector: _sv, ...rest } = job as typeof job & { search_vector?: unknown };
    return { ...rest, skills: job.job_skills.map((s) => s.skills), locations: job.job_locations };
  }

  private jobData(d: JobDto) {
    if (d.salaryMinPaise && d.salaryMaxPaise && d.salaryMaxPaise < d.salaryMinPaise) {
      throw unprocessable('INVALID_SALARY', 'Maximum salary must be at least the minimum');
    }
    if (d.experienceMaxMonths !== undefined && d.experienceMaxMonths < d.experienceMinMonths) {
      throw unprocessable('INVALID_EXPERIENCE', 'Maximum experience must be at least the minimum');
    }
    return {
      title: d.title.trim(),
      department: d.department ?? null,
      description: d.description,
      responsibilities: d.responsibilities ?? null,
      requirements: d.requirements ?? null,
      min_education_level: d.minEducationLevel ?? null,
      qualifications: d.qualifications ?? [],
      experience_min_months: d.experienceMinMonths,
      experience_max_months: d.experienceMaxMonths ?? null,
      salary_min_paise: d.salaryMinPaise !== undefined ? BigInt(d.salaryMinPaise) : null,
      salary_max_paise: d.salaryMaxPaise !== undefined ? BigInt(d.salaryMaxPaise) : null,
      salary_period: d.salaryPeriod ?? 'ANNUAL',
      salary_visible: d.salaryVisible ?? true,
      work_mode: d.workMode,
      employment_type: d.employmentType,
      openings: d.openings,
      application_deadline: d.applicationDeadline ? new Date(d.applicationDeadline) : null,
    };
  }

  private async writeChildren(tx: Tx, jobId: string, d: JobDto) {
    const known = await tx.skills.count({ where: { id: { in: d.skillIds } } });
    if (known !== new Set(d.skillIds).size) throw unprocessable('UNKNOWN_SKILL', 'One or more skills are not recognised');
    await tx.job_locations.deleteMany({ where: { job_id: jobId } });
    await tx.job_skills.deleteMany({ where: { job_id: jobId } });
    const locs = [...new Map(d.locations.map((l) => [`${l.city.trim()}|${l.state.trim()}`, l])).values()];
    await tx.job_locations.createMany({ data: locs.map((l) => ({ job_id: jobId, city: l.city.trim(), state: l.state.trim() })) });
    await tx.job_skills.createMany({ data: [...new Set(d.skillIds)].map((s) => ({ job_id: jobId, skill_id: s })) });
  }

  async create(p: Principal, d: JobDto, meta: RequestMeta) {
    const emp = this.employerId(p);
    const employer = await this.prisma.employers.findUniqueOrThrow({ where: { id: emp } });
    if (employer.status !== 'ACTIVE' || employer.verification_status === 'REJECTED' || employer.verification_status === 'SUSPENDED') {
      throw unprocessable('EMPLOYER_NOT_ALLOWED', 'Your employer account cannot post jobs right now');
    }
    const company = await this.prisma.companies.findFirstOrThrow({ where: { employer_id: emp }, orderBy: { created_at: 'asc' } });
    const slug = `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${randomBytes(3).toString('hex')}`;
    return this.prisma.tx(async (tx) => {
      const job = await tx.jobs.create({
        data: { ...this.jobData(d), employer_id: emp, company_id: company.id, posted_by_user_id: p.userId, slug, status: 'DRAFT' },
        select: { id: true, status: true, slug: true },
      });
      await this.writeChildren(tx, job.id, d);
      await this.audit.record(tx, p, meta, { action: 'job.created', entityType: 'job', entityId: job.id, employerId: emp });
      return job;
    });
  }

  async update(p: Principal, id: string, d: JobDto, meta: RequestMeta) {
    const emp = this.employerId(p);
    const job = await this.prisma.jobs.findFirst({ where: { id, employer_id: emp } });
    if (!job) throw notFound('Job');
    if (job.status === 'CLOSED') throw conflict('JOB_CLOSED', 'Closed jobs cannot be edited. Duplicate it instead.');
    let nextStatus = job.status;
    if (job.status === 'PUBLISHED' && !(await this.autoApprove(emp))) {
      const before = await this.employerJob(p, id);
      const fingerprint = (x: { title: string; min: unknown; max: unknown; cities: string[]; skills: number[] }) =>
        JSON.stringify([x.title.trim(), String(x.min ?? ''), String(x.max ?? ''), [...x.cities].sort(), [...x.skills].sort()]);
      const changed =
        fingerprint({ title: before.title, min: before.salary_min_paise, max: before.salary_max_paise, cities: before.locations.map((l) => l.city), skills: before.skills.map((s) => s.id) }) !==
        fingerprint({ title: d.title, min: d.salaryMinPaise, max: d.salaryMaxPaise, cities: d.locations.map((l) => l.city.trim()), skills: d.skillIds });
      if (changed) nextStatus = 'PENDING_APPROVAL';
    }
    return this.prisma.tx(async (tx) => {
      await tx.jobs.update({ where: { id }, data: { ...this.jobData(d), status: nextStatus, updated_at: new Date() } });
      await this.writeChildren(tx, id, d);
      if (job.status === 'PUBLISHED') {
        await this.audit.record(tx, p, meta, { action: 'job.published_edit', entityType: 'job', entityId: id, employerId: emp, metadata: { resubmitted: nextStatus !== job.status } });
      }
      return { id, status: nextStatus };
    });
  }

  private async autoApprove(employerId: string) {
    const [e, auto, reports] = await Promise.all([
      this.prisma.employers.findUniqueOrThrow({ where: { id: employerId } }),
      this.settings.bool('jobs.auto_approve_verified_employers'),
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int n FROM abuse_reports r JOIN jobs j ON j.id = r.target_id
        WHERE r.target_type = 'JOB' AND j.employer_id = ${employerId}::uuid AND r.status IN ('OPEN','INVESTIGATING','ACTIONED')`,
    ]);
    return auto && e.verification_status === 'VERIFIED' && reports[0].n === 0;
  }

  async action(p: Principal, id: string, action: keyof typeof JOB_ACTIONS, meta: RequestMeta) {
    const emp = this.employerId(p);
    const job = await this.prisma.jobs.findFirst({ where: { id, employer_id: emp } });
    if (!job) throw notFound('Job');
    if (!JOB_ACTIONS[action]?.includes(job.status)) {
      throw conflict('INVALID_TRANSITION', `A ${job.status.toLowerCase().replace('_', ' ')} job cannot be ${action === 'submit' ? 'submitted' : action + 'd'}`);
    }
    let status: string;
    let publishedAt = job.published_at;
    if (action === 'submit') {
      const employer = await this.prisma.employers.findUniqueOrThrow({ where: { id: emp } });
      if (employer.verification_status !== 'VERIFIED') {
        const today = await this.prisma.jobs.count({ where: { employer_id: emp, updated_at: { gte: new Date(Date.now() - 86400_000) }, status: 'PENDING_APPROVAL' } });
        if (today >= 3) throw unprocessable('DAILY_LIMIT', 'Unverified employers can submit 3 jobs per day. Verify your company to lift this limit.');
      }
      status = (await this.autoApprove(emp)) ? 'PUBLISHED' : 'PENDING_APPROVAL';
      if (status === 'PUBLISHED') publishedAt = new Date();
    } else {
      status = { pause: 'PAUSED', resume: 'PUBLISHED', close: 'CLOSED' }[action as 'pause' | 'resume' | 'close'];
    }
    await this.prisma.tx(async (tx) => {
      await tx.jobs.update({
        where: { id },
        data: { status, published_at: publishedAt, ...(status === 'CLOSED' && { closed_at: new Date() }), moderation_reason: action === 'submit' ? null : job.moderation_reason, updated_at: new Date() },
      });
      await this.audit.record(tx, p, meta, { action: `job.${action === 'submit' ? 'submitted' : action + 'd'}`, entityType: 'job', entityId: id, employerId: emp, metadata: { status } });
    });
    return { id, status };
  }
}
