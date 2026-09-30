import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import type { Principal, RequestMeta } from '../common/decorators';
import { conflict, notFound, unprocessable } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { TalentService } from '../talent/talent.service';
import type { CompanyDto, VerificationDto } from './employer.dto';

const REG_PATTERNS: Record<string, RegExp> = {
  GSTIN: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  CIN: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  LLPIN: /^[A-Z]{3}-\d{4}$/,
  UDYAM: /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/,
};

@Injectable()
export class EmployerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly talent: TalentService,
  ) {}

  async dashboard(p: Principal) {
    const emp = p.employerId!;
    const [counts] = await this.prisma.$queryRaw<any[]>`
      SELECT
        (SELECT count(*)::int FROM jobs WHERE employer_id = ${emp}::uuid AND status = 'PUBLISHED') AS active_jobs,
        (SELECT count(*)::int FROM jobs WHERE employer_id = ${emp}::uuid AND status = 'PENDING_APPROVAL') AS pending_jobs,
        (SELECT count(*)::int FROM applications WHERE employer_id = ${emp}::uuid AND status <> 'WITHDRAWN') AS applicants,
        (SELECT count(*)::int FROM applications WHERE employer_id = ${emp}::uuid AND applied_at > now() - interval '7 days') AS applicants_7d,
        (SELECT count(*)::int FROM applications WHERE employer_id = ${emp}::uuid AND status = 'SHORTLISTED') AS shortlisted,
        (SELECT count(DISTINCT candidate_id)::int FROM saved_candidates WHERE employer_id = ${emp}::uuid) AS saved,
        (SELECT count(*)::int FROM hiring_requirements WHERE employer_id = ${emp}::uuid AND status IN ('SUBMITTED','UNDER_REVIEW','ACTIVE','ON_HOLD')) AS open_requirements`;
    const recent = await this.prisma.$queryRaw<any[]>`
      SELECT a.id, a.status, a.applied_at, a.match_score, j.title AS job_title, c.first_name || ' ' || c.last_name AS candidate_name
      FROM applications a JOIN jobs j ON j.id = a.job_id JOIN candidates c ON c.id = a.candidate_id
      WHERE a.employer_id = ${emp}::uuid AND a.status <> 'WITHDRAWN' ORDER BY a.applied_at DESC LIMIT 6`;
    const employer = await this.prisma.employers.findUniqueOrThrow({ where: { id: emp }, select: { name: true, verification_status: true } });
    const pendingVerification = await this.prisma.employer_verification.findFirst({
      where: { employer_id: emp }, orderBy: { created_at: 'desc' }, select: { status: true, decision_reason: true },
    });
    return { ...counts, credits: await this.talent.credits(emp), recent, employer, latestVerification: pendingVerification };
  }

  async company(p: Principal) {
    const c = await this.prisma.companies.findFirst({ where: { employer_id: p.employerId! }, orderBy: { created_at: 'asc' } });
    if (!c) throw notFound('Company');
    const e = await this.prisma.employers.findUniqueOrThrow({ where: { id: p.employerId! }, select: { verification_status: true, primary_domain: true, name: true } });
    return { ...c, verificationStatus: e.verification_status, primaryDomain: e.primary_domain };
  }

  async updateCompany(p: Principal, d: CompanyDto, meta: RequestMeta) {
    const c = await this.prisma.companies.findFirst({ where: { employer_id: p.employerId! }, orderBy: { created_at: 'asc' } });
    if (!c) throw notFound('Company');
    if (d.logoFileId) {
      const f = await this.prisma.files.findUnique({ where: { id: d.logoFileId } });
      if (!f || f.owner_user_id !== p.userId || f.purpose !== 'COMPANY_LOGO') throw notFound('Logo');
    }
    await this.prisma.tx(async (tx) => {
      await tx.companies.update({
        where: { id: c.id },
        data: {
          ...(d.displayName !== undefined && { display_name: d.displayName }),
          ...(d.legalName !== undefined && { legal_name: d.legalName }),
          ...(d.website !== undefined && { website: d.website }),
          ...(d.industry !== undefined && { industry: d.industry }),
          ...(d.sizeBand !== undefined && { size_band: d.sizeBand }),
          ...(d.foundedYear !== undefined && { founded_year: d.foundedYear }),
          ...(d.description !== undefined && { description: d.description }),
          ...(d.hqCity !== undefined && { hq_city: d.hqCity }),
          ...(d.hqState !== undefined && { hq_state: d.hqState }),
          ...(d.logoFileId !== undefined && { logo_file_id: d.logoFileId }),
          updated_at: new Date(),
        },
      });
      await this.audit.record(tx, p, meta, { action: 'employer.company_updated', entityType: 'company', entityId: c.id, employerId: p.employerId });
    });
    return this.company(p);
  }

  verifications(p: Principal) {
    return this.prisma.employer_verification.findMany({
      where: { employer_id: p.employerId! },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, status: true, official_email: true, website: true, registration_type: true, registration_number: true,
        contact_name: true, decision_reason: true, decided_at: true, created_at: true,
      },
    });
  }

  async submitVerification(p: Principal, d: VerificationDto, meta: RequestMeta) {
    const emp = p.employerId!;
    const e = await this.prisma.employers.findUniqueOrThrow({ where: { id: emp } });
    if (e.verification_status === 'VERIFIED') throw conflict('ALREADY_VERIFIED', 'Your company is already verified');
    if (e.verification_status === 'SUSPENDED') throw unprocessable('SUSPENDED', 'Contact support to reinstate your account');
    const open = await this.prisma.employer_verification.findFirst({ where: { employer_id: emp, status: { in: ['SUBMITTED', 'IN_REVIEW'] } } });
    if (open) throw conflict('ALREADY_SUBMITTED', 'Your verification is already being reviewed');
    const rejected = await this.prisma.employer_verification.count({ where: { employer_id: emp, status: 'REJECTED' } });
    if (rejected >= 2) throw unprocessable('APPEAL_LIMIT', 'Please contact support@genzhire.work to appeal again');

    const reg = d.registrationNumber?.trim().toUpperCase();
    if (d.registrationType && REG_PATTERNS[d.registrationType] && reg && !REG_PATTERNS[d.registrationType].test(reg)) {
      throw unprocessable('INVALID_REGISTRATION', `That doesn't look like a valid ${d.registrationType}`);
    }
    if (!e.primary_domain && !d.documentFileIds?.length) {
      throw unprocessable('DOCUMENT_REQUIRED', 'Accounts registered with a personal email must upload a registration document');
    }
    for (const id of d.documentFileIds ?? []) {
      const f = await this.prisma.files.findUnique({ where: { id } });
      if (!f || f.owner_user_id !== p.userId || f.purpose !== 'VERIFICATION_DOC') throw notFound('Document');
    }
    return this.prisma.tx(async (tx) => {
      const v = await tx.employer_verification.create({
        data: {
          employer_id: emp, submitted_by: p.userId, official_email: d.officialEmail ?? null, website: d.website ?? null,
          registration_type: d.registrationType ?? null, registration_number: reg ?? null, document_file_ids: d.documentFileIds ?? [],
          contact_name: d.contactName, contact_phone_e164: d.contactPhone,
        },
        select: { id: true, status: true, created_at: true },
      });
      if (e.verification_status === 'REJECTED') await tx.employers.update({ where: { id: emp }, data: { verification_status: 'PENDING' } });
      await this.audit.record(tx, p, meta, { action: 'employer.verification_submitted', entityType: 'employer', entityId: emp, employerId: emp });
      return v;
    });
  }

  team(p: Principal) {
    return this.prisma.employer_users.findMany({
      where: { employer_id: p.employerId!, status: { not: 'REMOVED' } },
      select: {
        id: true, company_role: true, designation: true, status: true, created_at: true,
        users_employer_users_user_idTousers: { select: { full_name: true, email: true, last_login_at: true } },
      },
    });
  }
}
