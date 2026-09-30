import { Injectable } from '@nestjs/common';
import type { Principal } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

export type AccessBasis =
  | 'CREDIT' | 'ACTIVE_UNLOCK' | 'APPLICATION' | 'RECRUITER_SUBMISSION' | 'RECRUITER_CASE' | 'CONTACT_ACCEPTED' | 'ADMIN';

export type AccessDecision =
  | { kind: 'NOT_FOUND' }
  | { kind: 'LOCKED'; canUnlock: boolean; reason?: string }
  | { kind: 'FULL'; basis: AccessBasis; contact: boolean; unlockExpiresAt?: Date | null };

/**
 * The single decision point for "how much of this candidate may this viewer see"
 * (docs/08-rbac.md §4). Search, profile, resume, contact and notes all call it.
 */
@Injectable()
export class CandidateAccessPolicy {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(viewer: Principal, candidateId: string): Promise<AccessDecision> {
    const c = await this.prisma.candidates.findUnique({
      where: { id: candidateId },
      select: { id: true, deleted_at: true, users: { select: { status: true } }, candidate_visibility: { select: { level: true } } },
    });
    if (!c || c.deleted_at || c.users.status !== 'ACTIVE') return { kind: 'NOT_FOUND' };

    if (viewer.aud === 'admin') return { kind: 'FULL', basis: 'ADMIN', contact: true };

    if (viewer.aud === 'recruiter') {
      const onCase = await this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int n FROM recruitment_candidates rc
        JOIN recruitment_case_assignments a ON a.case_id = rc.case_id AND a.unassigned_at IS NULL
        WHERE rc.candidate_id = ${candidateId}::uuid AND a.recruiter_id = ${viewer.recruiterId!}::uuid`;
      if (onCase[0].n > 0) return { kind: 'FULL', basis: 'RECRUITER_CASE', contact: true };
      const doc = await this.prisma.candidate_search_documents.findUnique({ where: { candidate_id: candidateId }, select: { is_searchable: true } });
      return doc?.is_searchable ? { kind: 'LOCKED', canUnlock: false, reason: 'ADD_TO_CASE' } : { kind: 'NOT_FOUND' };
    }

    if (viewer.aud !== 'employer' || !viewer.employerId) return { kind: 'NOT_FOUND' };
    const emp = viewer.employerId;
    const [employer, blocked, applied, submitted, unlocks] = await Promise.all([
      this.prisma.employers.findUnique({ where: { id: emp }, select: { status: true, verification_status: true } }),
      this.prisma.candidate_blocked_employers.findUnique({ where: { candidate_id_employer_id: { candidate_id: candidateId, employer_id: emp } } }),
      this.prisma.applications.count({ where: { candidate_id: candidateId, employer_id: emp, status: { not: 'WITHDRAWN' } } }),
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int n FROM recruitment_candidates rc JOIN recruitment_cases rcs ON rcs.id = rc.case_id
        WHERE rc.candidate_id = ${candidateId}::uuid AND rcs.employer_id = ${emp}::uuid AND rc.submitted_at IS NOT NULL`,
      this.prisma.profile_unlocks.findMany({ where: { employer_id: emp, candidate_id: candidateId, expires_at: { gt: new Date() } } }),
    ]);
    if (!employer || employer.status !== 'ACTIVE') return { kind: 'NOT_FOUND' };
    if (blocked) return { kind: 'NOT_FOUND' };
    const contactUnlock = unlocks.some((u) => u.unlock_type === 'CONTACT');
    // Applying shares the profile and contact details with that employer.
    if (applied > 0) return { kind: 'FULL', basis: 'APPLICATION', contact: true };
    if (submitted[0].n > 0) return { kind: 'FULL', basis: 'RECRUITER_SUBMISSION', contact: contactUnlock };

    const level = c.candidate_visibility?.level;
    if (level === 'HIDDEN' || level === 'APPLICATION_ONLY') return { kind: 'NOT_FOUND' };
    const doc = await this.prisma.candidate_search_documents.findUnique({ where: { candidate_id: candidateId }, select: { is_searchable: true } });
    if (!doc?.is_searchable) return { kind: 'NOT_FOUND' };

    const profileUnlock = unlocks.find((u) => u.unlock_type === 'PROFILE');
    if (profileUnlock) return { kind: 'FULL', basis: 'ACTIVE_UNLOCK', contact: contactUnlock, unlockExpiresAt: profileUnlock.expires_at };
    return { kind: 'LOCKED', canUnlock: employer.verification_status === 'VERIFIED', reason: employer.verification_status === 'VERIFIED' ? undefined : 'EMPLOYER_NOT_VERIFIED' };
  }
}
