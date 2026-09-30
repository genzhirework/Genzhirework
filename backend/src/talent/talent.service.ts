import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ctcBand, loadCandidate, presentCandidate } from '../candidate/profile.presenter';
import { AuditService } from '../common/audit.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import type { Principal, RequestMeta } from '../common/decorators';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { FilesService } from '../files/files.service';
import { AccessDecision, CandidateAccessPolicy } from './access.policy';
import type { CandidateSearchDto } from './talent.dto';

const NO_CREDITS = () =>
  new AppError(HttpStatus.PAYMENT_REQUIRED, 'NO_CREDITS', 'You have used all your profile view credits. Unlocked profiles stay available until their unlock expires.');

@Injectable()
export class TalentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: CandidateAccessPolicy,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------------ credits

  /** Same validity window, evaluated on the same (database) clock, as the unlock query. */
  async credits(employerId: string) {
    const [r] = await this.prisma.$queryRaw<{ remaining: number; total: number; next_expiry: Date | null }[]>`
      SELECT coalesce(sum(remaining_quantity), 0)::int AS remaining, coalesce(sum(total_quantity), 0)::int AS total,
             min(valid_until) FILTER (WHERE remaining_quantity > 0) AS next_expiry
      FROM employer_entitlements
      WHERE employer_id = ${employerId}::uuid AND entitlement_type = 'CANDIDATE_PROFILE_VIEW'
        AND now() >= valid_from AND now() < valid_until`;
    return { remaining: r.remaining, total: r.total, nextExpiry: r.next_expiry };
  }

  entitlements(p: Principal) {
    return this.prisma.employer_entitlements.findMany({
      where: { employer_id: p.employerId! },
      orderBy: { created_at: 'desc' },
      select: { id: true, entitlement_type: true, source: true, total_quantity: true, used_quantity: true, remaining_quantity: true, valid_from: true, valid_until: true },
    });
  }

  async ledger(p: Principal, cursor?: string) {
    const binding = `ledger:${p.employerId}`;
    const offset = decodeCursor<{ o: number }>(cursor, binding)?.o ?? 0;
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT l.id, l.delta, l.reason, l.created_at, l.note, u.full_name AS actor_name,
             c.id AS candidate_id, CASE WHEN c.id IS NOT NULL THEN c.first_name || ' ' || c.last_name END AS candidate_name
      FROM entitlement_ledger l
      LEFT JOIN users u ON u.id = l.actor_user_id
      LEFT JOIN profile_unlocks pu ON l.reference_type = 'profile_unlock' AND pu.id = l.reference_id
      LEFT JOIN candidates c ON c.id = pu.candidate_id
      WHERE l.employer_id = ${p.employerId!}::uuid
      ORDER BY l.created_at DESC, l.id DESC LIMIT 51 OFFSET ${offset}`;
    return { data: rows.slice(0, 50), page: { nextCursor: rows.length > 50 ? encodeCursor({ o: offset + 50 }, binding) : null, limit: 50 } };
  }

  // ------------------------------------------------------------------- search

  async search(p: Principal, f: CandidateSearchDto) {
    const max = await this.settings.num('talent.search_page_size_max');
    const depth = await this.settings.num('talent.search_max_depth');
    const nameDisplay = await this.settings.str('talent.search_card_name_display');
    const limit = clampLimit(f.limit, 25, max);
    const binding = `talent:${p.userId}:${JSON.stringify({ ...f, cursor: undefined, limit })}`;
    const offset = decodeCursor<{ o: number }>(f.cursor, binding)?.o ?? 0;
    if (offset >= depth) return { data: [], page: { nextCursor: null, limit }, totalEstimate: 0, depthLimitReached: true };

    const w: Prisma.Sql[] = [Prisma.sql`d.is_searchable`];
    const emp = p.aud === 'employer' ? p.employerId! : null;
    if (emp) w.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM candidate_blocked_employers b WHERE b.candidate_id = d.candidate_id AND b.employer_id = ${emp}::uuid)`);
    const text = f.q?.trim().slice(0, 120);
    if (text) w.push(Prisma.sql`(d.search_vector @@ websearch_to_tsquery('simple', ${text}) OR d.headline ILIKE ${'%' + text + '%'} OR d.target_role ILIKE ${'%' + text + '%'})`);
    if (f.skillsAll?.length) w.push(Prisma.sql`d.skill_ids @> ${f.skillsAll}::int[]`);
    if (f.skillsAny?.length) w.push(Prisma.sql`d.skill_ids && ${f.skillsAny}::int[]`);
    if (f.cities?.length) {
      const lc = f.cities.map((c) => c.toLowerCase());
      w.push(Prisma.sql`(lower(d.city) = ANY(${lc}) OR EXISTS (SELECT 1 FROM unnest(d.preferred_cities) pc WHERE lower(pc) = ANY(${lc})))`);
    }
    if (f.educationLevels?.length) w.push(Prisma.sql`d.highest_education_level = ANY(${f.educationLevels})`);
    if (f.degrees?.length) w.push(Prisma.sql`d.highest_degree ILIKE ANY(${f.degrees.map((x) => `%${x}%`)})`);
    if (f.graduationYearMin) w.push(Prisma.sql`d.graduation_year >= ${f.graduationYearMin}`);
    if (f.graduationYearMax) w.push(Prisma.sql`d.graduation_year <= ${f.graduationYearMax}`);
    if (f.experienceMonthsMax !== undefined) w.push(Prisma.sql`d.experience_months <= ${f.experienceMonthsMax}`);
    if (f.experienceMonthsMin !== undefined) w.push(Prisma.sql`d.experience_months >= ${f.experienceMonthsMin}`);
    if (f.expectedCtcMaxPaise) w.push(Prisma.sql`(d.expected_ctc_min_paise IS NULL OR d.expected_ctc_min_paise <= ${BigInt(f.expectedCtcMaxPaise)})`);
    if (f.availability?.length) w.push(Prisma.sql`d.availability = ANY(${f.availability})`);
    if (f.employmentStatus?.length) w.push(Prisma.sql`d.employment_status = ANY(${f.employmentStatus})`);
    if (f.workModes?.length) w.push(Prisma.sql`d.work_modes && ${f.workModes}::text[]`);
    if (f.certification) w.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(d.certification_names) cn WHERE cn ILIKE ${'%' + f.certification + '%'})`);
    if (emp && f.excludeUnlocked) w.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM profile_unlocks u WHERE u.employer_id = ${emp}::uuid AND u.candidate_id = d.candidate_id AND u.expires_at > now())`);

    const where = Prisma.join(w, ' AND ');
    const order =
      f.sort === 'graduation_year' ? Prisma.sql`d.graduation_year DESC NULLS LAST, d.candidate_id`
      : text && f.sort !== 'recently_active' ? Prisma.sql`ts_rank_cd(d.search_vector, websearch_to_tsquery('simple', ${text})) DESC, d.profile_completion DESC, d.candidate_id`
      : Prisma.sql`d.last_active_at DESC NULLS LAST, d.profile_completion DESC, d.candidate_id`;
    const nameSql = nameDisplay === 'FULL' ? Prisma.sql`c.first_name || ' ' || c.last_name`
      : nameDisplay === 'INITIALS' ? Prisma.sql`left(c.first_name, 1) || '. ' || left(c.last_name, 1) || '.'`
      : Prisma.sql`d.display_name_masked`;
    const viewerCols = emp
      ? Prisma.sql`,
        EXISTS (SELECT 1 FROM profile_unlocks u WHERE u.employer_id = ${emp}::uuid AND u.candidate_id = d.candidate_id AND u.unlock_type = 'PROFILE' AND u.expires_at > now()) AS unlocked,
        EXISTS (SELECT 1 FROM saved_candidates s WHERE s.employer_id = ${emp}::uuid AND s.candidate_id = d.candidate_id) AS saved,
        EXISTS (SELECT 1 FROM applications a WHERE a.employer_id = ${emp}::uuid AND a.candidate_id = d.candidate_id AND a.status <> 'WITHDRAWN') AS applied`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT d.candidate_id, ${nameSql} AS display_name,
             upper(left(c.first_name, 1) || left(c.last_name, 1)) AS initials,
             d.headline, d.target_role, d.city, d.highest_education_level, d.highest_degree, d.specializations[1] AS specialization,
             d.graduation_year, d.experience_months, d.availability, d.employment_status, d.profile_completion,
             d.email_verified, d.phone_verified, d.skill_names[1:6] AS skills, d.expected_ctc_min_paise, d.last_active_at
             ${viewerCols}
      FROM candidate_search_documents d JOIN candidates c ON c.id = d.candidate_id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${limit + 1} OFFSET ${offset}`;
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM candidate_search_documents d WHERE ${where}`;

    await this.prisma.analytics_events.create({
      data: { occurred_at: new Date(), user_id: p.userId, app: p.aud, event_name: 'talent.search_performed', properties: { filters: Object.keys(f).filter((k) => (f as any)[k] !== undefined), results: n } },
    });
    const hasMore = rows.length > limit && offset + limit < depth;
    return {
      data: rows.slice(0, limit).map(({ expected_ctc_min_paise, ...r }) => ({ ...r, expected_ctc_band: ctcBand(expected_ctc_min_paise) })),
      page: { nextCursor: hasMore ? encodeCursor({ o: offset + limit }, binding) : null, limit },
      totalEstimate: n,
      depthLimitReached: !hasMore && rows.length > limit,
      credits: emp ? await this.credits(emp) : undefined,
    };
  }

  // ------------------------------------------------------------ profile view

  private async logView(p: Principal, candidateId: string, action: string, basis: string, meta: RequestMeta, credits = 0, ledgerId?: bigint, tx?: Prisma.TransactionClient) {
    await (tx ?? this.prisma).candidate_profile_views.create({
      data: {
        viewer_user_id: p.userId, viewer_type: p.aud.toUpperCase(), employer_id: p.employerId ?? null, candidate_id: candidateId,
        action, access_basis: basis, credits_consumed: credits, ledger_id: ledgerId ?? null,
        ip_address: meta.ip, user_agent: meta.userAgent, request_id: meta.requestId,
      },
    });
  }

  async view(p: Principal, candidateId: string, meta: RequestMeta) {
    const decision = await this.policy.resolve(p, candidateId);
    return this.render(p, candidateId, decision, meta);
  }

  private async render(p: Principal, candidateId: string, decision: AccessDecision, meta: RequestMeta, creditsRemaining?: number, alreadyLogged = false) {
    if (decision.kind === 'NOT_FOUND') throw notFound('Candidate');
    const c = await loadCandidate(this.prisma, candidateId);
    if (!c) throw notFound('Candidate');
    const credits = p.aud === 'employer' ? (creditsRemaining !== undefined ? { remaining: creditsRemaining } : await this.credits(p.employerId!)) : undefined;
    if (decision.kind === 'LOCKED') {
      const nameDisplay = await this.settings.str('talent.search_card_name_display');
      return {
        access: { level: 'LOCKED', canUnlock: decision.canUnlock, reason: decision.reason ?? null, unlockCost: 1, creditsRemaining: credits?.remaining ?? null },
        profile: presentCandidate(c, 'LOCKED', { nameDisplay }),
      };
    }
    if (!alreadyLogged) await this.logView(p, candidateId, 'FULL_PROFILE_VIEW', decision.basis, meta);
    const extra = p.aud === 'employer' ? await this.employerExtras(p.employerId!, candidateId) : {};
    return {
      access: {
        level: decision.contact ? 'CONTACT' : 'FULL',
        basis: decision.basis,
        unlockExpiresAt: decision.unlockExpiresAt ?? null,
        creditsRemaining: credits?.remaining ?? null,
      },
      profile: presentCandidate(c, decision.contact ? 'CONTACT' : 'FULL'),
      ...extra,
    };
  }

  private async employerExtras(employerId: string, candidateId: string) {
    const [saved, notes, contactRequest] = await Promise.all([
      this.prisma.saved_candidates.findMany({ where: { employer_id: employerId, candidate_id: candidateId }, select: { folder_id: true } }),
      this.prisma.candidate_notes.findMany({
        where: { employer_id: employerId, candidate_id: candidateId }, orderBy: { created_at: 'desc' },
        select: { id: true, body: true, created_at: true, users: { select: { full_name: true } } },
      }),
      this.prisma.contact_requests.findFirst({ where: { employer_id: employerId, candidate_id: candidateId }, orderBy: { created_at: 'desc' }, select: { status: true, created_at: true } }),
    ]);
    return { saved: { saved: saved.length > 0, folderIds: saved.map((s) => s.folder_id).filter(Boolean) }, notes, contactRequest };
  }

  /**
   * Credit consumption (docs/06-business-rules.md §2). The INSERT … ON CONFLICT
   * row lock serialises concurrent unlocks of the same candidate, so exactly one
   * of them is charged; a failed credit claim rolls the unlock back.
   */
  async unlock(p: Principal, candidateId: string, meta: RequestMeta) {
    if (p.aud !== 'employer') throw forbidden();
    const emp = p.employerId!;
    const decision = await this.policy.resolve(p, candidateId);
    if (decision.kind === 'NOT_FOUND') throw notFound('Candidate');
    if (decision.kind === 'FULL') return this.render(p, candidateId, decision, meta);
    if (!decision.canUnlock && (await this.settings.bool('talent.require_verification_for_unlock'))) {
      throw forbidden('EMPLOYER_NOT_VERIFIED', 'Verify your company to unlock candidate profiles');
    }
    const cap = await this.settings.num('talent.daily_unlock_cap_per_user');
    const [{ n: today }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM candidate_profile_views
      WHERE viewer_user_id = ${p.userId}::uuid AND access_basis = 'CREDIT' AND created_at > now() - interval '24 hours'`;
    if (today >= cap) {
      await this.prisma.security_alerts.create({
        data: { type: 'DAILY_UNLOCK_CAP', severity: 'MEDIUM', user_id: p.userId, employer_id: emp, details: { cap, today } },
      });
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'DAILY_UNLOCK_CAP', `You can unlock up to ${cap} profiles per day`);
    }
    const validity = await this.settings.num('talent.unlock_validity_days');

    const result = await this.prisma.tx(async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO profile_unlocks (employer_id, candidate_id, unlock_type, unlocked_by, expires_at)
        VALUES (${emp}::uuid, ${candidateId}::uuid, 'PROFILE', ${p.userId}::uuid, now() + make_interval(days => ${validity}::int))
        ON CONFLICT (employer_id, candidate_id, unlock_type) DO UPDATE
           SET unlocked_by = EXCLUDED.unlocked_by, unlocked_at = now(), expires_at = EXCLUDED.expires_at
         WHERE profile_unlocks.expires_at <= now()
        RETURNING id`;
      if (!claimed.length) return { charged: false as const };

      const bucket = await tx.$queryRaw<{ id: string; remaining_quantity: number }[]>`
        UPDATE employer_entitlements SET used_quantity = used_quantity + 1
         WHERE id = (SELECT id FROM employer_entitlements
                      WHERE employer_id = ${emp}::uuid AND entitlement_type = 'CANDIDATE_PROFILE_VIEW'
                        AND now() >= valid_from AND now() < valid_until AND used_quantity < total_quantity
                      ORDER BY valid_until, created_at LIMIT 1
                      FOR UPDATE)
        RETURNING id, remaining_quantity`;
      if (!bucket.length) throw NO_CREDITS();

      const ledger = await tx.entitlement_ledger.create({
        data: { entitlement_id: bucket[0].id, employer_id: emp, delta: -1, reason: 'CONSUME', reference_type: 'profile_unlock', reference_id: claimed[0].id, actor_user_id: p.userId },
      });
      await tx.profile_unlocks.update({ where: { id: claimed[0].id }, data: { ledger_id: ledger.id } });
      await this.logView(p, candidateId, 'FULL_PROFILE_VIEW', 'CREDIT', meta, 1, ledger.id, tx);
      await this.audit.record(tx, p, meta, {
        action: 'candidate.profile_unlocked', entityType: 'candidate', entityId: candidateId, employerId: emp,
        metadata: { ledgerId: ledger.id.toString(), entitlementId: bucket[0].id },
      });
      const cand = await tx.candidates.findUniqueOrThrow({ where: { id: candidateId }, select: { user_id: true } });
      const company = await tx.companies.findFirst({ where: { employer_id: emp }, select: { display_name: true } });
      await this.notify.send({
        userId: cand.user_id, app: 'jobseeker', type: 'PROFILE_UNLOCKED',
        title: `${company?.display_name ?? 'An employer'} viewed your profile`,
        body: 'A verified employer opened your full profile. See who viewed you in Privacy settings.',
        link: '/app/settings/privacy',
      }, tx);
      return { charged: true as const, remaining: bucket[0].remaining_quantity };
    });

    const after = await this.policy.resolve(p, candidateId);
    if (!result.charged) return this.render(p, candidateId, after, meta);
    // The CREDIT access row was written inside the transaction; report that basis, don't log twice.
    const charged: AccessDecision = after.kind === 'FULL' ? { ...after, basis: 'CREDIT' } : after;
    return this.render(p, candidateId, charged, meta, result.remaining, true);
  }

  async resume(p: Principal, candidateId: string, meta: RequestMeta) {
    const decision = await this.policy.resolve(p, candidateId);
    if (decision.kind !== 'FULL') throw decision.kind === 'NOT_FOUND' ? notFound('Candidate') : forbidden('PROFILE_LOCKED', 'Unlock the profile to download the resume');
    const r = await this.prisma.resumes.findFirst({ where: { candidate_id: candidateId, is_primary: true, deleted_at: null } });
    if (!r) throw notFound('Resume');
    const cap = await this.settings.num('talent.daily_resume_download_cap_per_user');
    const [{ n }] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int n FROM candidate_profile_views
      WHERE viewer_user_id = ${p.userId}::uuid AND action = 'RESUME_DOWNLOAD' AND created_at > now() - interval '24 hours'`;
    if (n >= cap) throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'DAILY_DOWNLOAD_CAP', `You can download up to ${cap} resumes per day`);
    const user = await this.prisma.users.findUniqueOrThrow({ where: { id: p.userId } });
    const org = p.employerId ? (await this.prisma.employers.findUniqueOrThrow({ where: { id: p.employerId } })).name : 'GenZHire recruitment';
    const out = await this.files.watermarkedResume(r.file_id, `Downloaded by ${org} · ${user.email} · ${new Date().toISOString()} · GenZHire`);
    await this.prisma.tx(async (tx) => {
      await this.logView(p, candidateId, 'RESUME_DOWNLOAD', decision.basis, meta, 0, undefined, tx);
      await this.audit.record(tx, p, meta, { action: 'candidate.resume_downloaded', entityType: 'candidate', entityId: candidateId, employerId: p.employerId });
    });
    return out;
  }

  // --------------------------------------------------------- contact requests

  async requestContact(p: Principal, candidateId: string, message: string, jobId: string | undefined, meta: RequestMeta) {
    const decision = await this.policy.resolve(p, candidateId);
    if (decision.kind === 'NOT_FOUND') throw notFound('Candidate');
    if (decision.kind === 'LOCKED') throw forbidden('PROFILE_LOCKED', 'Unlock the profile before requesting contact details');
    if (decision.contact) throw conflict('ALREADY_SHARED', 'Contact details are already available');
    if (jobId) {
      const job = await this.prisma.jobs.findFirst({ where: { id: jobId, employer_id: p.employerId! } });
      if (!job) throw notFound('Job');
    }
    const days = await this.settings.num('contact_requests.expiry_days');
    try {
      return await this.prisma.tx(async (tx) => {
        const r = await tx.contact_requests.create({
          data: { employer_id: p.employerId!, candidate_id: candidateId, requested_by: p.userId, job_id: jobId ?? null, message, expires_at: new Date(Date.now() + days * 86400_000) },
          select: { id: true, status: true, expires_at: true },
        });
        const cand = await tx.candidates.findUniqueOrThrow({ where: { id: candidateId }, select: { user_id: true } });
        const company = await tx.companies.findFirst({ where: { employer_id: p.employerId! }, select: { display_name: true } });
        await this.notify.send({
          userId: cand.user_id, app: 'jobseeker', type: 'CONTACT_REQUEST',
          title: `${company?.display_name ?? 'An employer'} wants to contact you`,
          body: message.slice(0, 140), link: '/app/contact-requests',
        }, tx);
        await this.audit.record(tx, p, meta, { action: 'candidate.contact_requested', entityType: 'candidate', entityId: candidateId, employerId: p.employerId });
        return r;
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('REQUEST_PENDING', 'You already have a pending request with this candidate');
      throw e;
    }
  }

  // ------------------------------------------------------ saved / notes

  private async requireFull(p: Principal, candidateId: string) {
    const d = await this.policy.resolve(p, candidateId);
    if (d.kind === 'NOT_FOUND') throw notFound('Candidate');
    if (d.kind === 'LOCKED') throw forbidden('PROFILE_LOCKED', 'Unlock the profile first');
    return d;
  }

  folders(p: Principal) {
    return this.prisma.$queryRaw<any[]>`
      SELECT f.id, f.name, f.kind, f.created_at, (SELECT count(*)::int FROM saved_candidates s WHERE s.folder_id = f.id) AS count
      FROM candidate_folders f WHERE f.employer_id = ${p.employerId!}::uuid ORDER BY f.kind DESC, f.name`;
  }

  async createFolder(p: Principal, name: string) {
    try {
      return await this.prisma.candidate_folders.create({ data: { employer_id: p.employerId!, name: name.trim(), created_by: p.userId } });
    } catch (e: any) {
      if (e?.code === 'P2002') throw conflict('FOLDER_EXISTS', 'A folder with this name already exists');
      throw e;
    }
  }

  async deleteFolder(p: Principal, id: string) {
    const r = await this.prisma.candidate_folders.deleteMany({ where: { id, employer_id: p.employerId!, kind: 'CUSTOM' } });
    if (!r.count) throw notFound('Folder');
  }

  async saved(p: Principal, folderId?: string) {
    return this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (c.id) c.id AS candidate_id, c.first_name || ' ' || c.last_name AS name, c.city,
             p.headline, p.target_role, d.highest_degree, d.graduation_year, d.skill_names[1:6] AS skills,
             s.created_at AS saved_at, u.full_name AS saved_by,
             (SELECT array_agg(s2.folder_id) FILTER (WHERE s2.folder_id IS NOT NULL) FROM saved_candidates s2
               WHERE s2.employer_id = s.employer_id AND s2.candidate_id = c.id) AS folder_ids
      FROM saved_candidates s
      JOIN candidates c ON c.id = s.candidate_id AND c.deleted_at IS NULL
      JOIN candidate_profiles p ON p.candidate_id = c.id
      LEFT JOIN candidate_search_documents d ON d.candidate_id = c.id
      LEFT JOIN users u ON u.id = s.saved_by
      WHERE s.employer_id = ${p.employerId!}::uuid
        AND (${folderId ?? null}::uuid IS NULL OR s.folder_id = ${folderId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM candidate_blocked_employers b WHERE b.candidate_id = c.id AND b.employer_id = s.employer_id)
      ORDER BY c.id, s.created_at DESC`;
  }

  async save(p: Principal, candidateId: string, folderId: string | undefined, meta: RequestMeta) {
    await this.requireFull(p, candidateId);
    if (folderId) {
      const f = await this.prisma.candidate_folders.findFirst({ where: { id: folderId, employer_id: p.employerId! } });
      if (!f) throw notFound('Folder');
    }
    const exists = await this.prisma.saved_candidates.findFirst({ where: { employer_id: p.employerId!, candidate_id: candidateId, folder_id: folderId ?? null } });
    if (exists) return { saved: true };
    await this.prisma.tx(async (tx) => {
      await tx.saved_candidates.create({ data: { employer_id: p.employerId!, candidate_id: candidateId, folder_id: folderId ?? null, saved_by: p.userId } });
      await this.audit.record(tx, p, meta, { action: 'candidate.saved', entityType: 'candidate', entityId: candidateId, employerId: p.employerId, metadata: { folderId: folderId ?? null } });
    });
    return { saved: true };
  }

  async unsave(p: Principal, candidateId: string, folderId?: string) {
    await this.prisma.saved_candidates.deleteMany({
      where: { employer_id: p.employerId!, candidate_id: candidateId, ...(folderId ? { folder_id: folderId } : {}) },
    });
  }

  async addNote(p: Principal, candidateId: string, body: string, meta: RequestMeta) {
    await this.requireFull(p, candidateId);
    return this.prisma.tx(async (tx) => {
      const n = await tx.candidate_notes.create({
        data: { employer_id: p.employerId!, candidate_id: candidateId, author_id: p.userId, body: body.trim() },
        select: { id: true, body: true, created_at: true },
      });
      await this.audit.record(tx, p, meta, { action: 'candidate.note_added', entityType: 'candidate', entityId: candidateId, employerId: p.employerId });
      return n;
    });
  }

  async deleteNote(p: Principal, noteId: string) {
    const r = await this.prisma.candidate_notes.deleteMany({ where: { id: noteId, employer_id: p.employerId!, author_id: p.userId } });
    if (!r.count) throw notFound('Note');
  }

  async compare(p: Principal, ids: string[]) {
    if (ids.length < 2 || ids.length > 3) throw unprocessable('INVALID_SELECTION', 'Select 2 or 3 candidates to compare');
    const out = [];
    for (const id of ids) {
      const d = await this.requireFull(p, id);
      const c = await loadCandidate(this.prisma, id);
      out.push(presentCandidate(c!, d.contact ? 'CONTACT' : 'FULL'));
    }
    return out;
  }
}

