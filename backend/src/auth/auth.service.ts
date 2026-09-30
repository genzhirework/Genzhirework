import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import type { AccessClaims } from '../common/auth.guard';
import type { Principal, RequestMeta } from '../common/decorators';
import { AppError, badRequest, conflict } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { Audience, AUDIENCE_ROLE, ROLE_PERMISSIONS } from '../common/permissions';
import { PrismaService, Tx } from '../common/prisma.service';
import type { RegisterCandidateDto, RegisterEmployerDto } from './auth.dto';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const sha256 = (v: string) => createHash('sha256').update(v).digest();
const token = () => randomBytes(32).toString('base64url');

const FREE_MAIL = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'rediffmail.com', 'proton.me', 'protonmail.com', 'zoho.com', 'aol.com', 'gmx.com', 'yandex.com',
]);
const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', '1234567890', 'qwertyuiop', 'iloveyou123', 'welcome123',
  'admin12345', 'abcdefghij', 'password@123', 'qwerty12345', '0123456789', '1111111111',
]);

const INVALID_LOGIN = () => new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Incorrect email or password');

export const SESSION_TTL_DAYS: Record<Audience, number> = { jobseeker: 30, employer: 30, recruiter: 7, admin: 7 };
export const refreshCookieName = (app: Audience) => `gh_rt_${app}`;

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  private dummyHash: Promise<string> = hash('timing-equaliser-password', ARGON);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  private get requireVerification() {
    return process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
  }

  private checkPasswordStrength(password: string, email: string) {
    const p = password.toLowerCase();
    if (COMMON_PASSWORDS.has(p) || p.includes(email.split('@')[0].toLowerCase())) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'WEAK_PASSWORD', 'Choose a less common password', [
        { field: 'password', code: 'WEAK_PASSWORD', message: 'This password is too easy to guess' },
      ]);
    }
  }

  // ---------------------------------------------------------------- register

  async registerCandidate(dto: RegisterCandidateDto, meta: RequestMeta) {
    this.checkPasswordStrength(dto.password, dto.email);
    const existing = await this.prisma.users.findUnique({ where: { email: dto.email } });
    if (existing) {
      // Same response as success: registration must not reveal which emails exist.
      this.notify.email(dto.email, 'Someone tried to register with your email', 'If this was you, sign in or reset your password.');
      return { ok: true };
    }
    const passwordHash = await hash(dto.password, ARGON);
    const policies = await this.currentPolicies(['PRIVACY_POLICY', 'TERMS_CANDIDATE']);

    const user = await this.prisma.tx(async (tx) => {
      const u = await tx.users.create({
        data: {
          email: dto.email,
          full_name: `${dto.firstName} ${dto.lastName}`.trim(),
          password_hash: passwordHash,
          status: this.requireVerification ? 'PENDING_VERIFICATION' : 'ACTIVE',
        },
      });
      await this.grantRole(tx, u.id, 'JOBSEEKER');
      const c = await tx.candidates.create({
        data: { user_id: u.id, first_name: dto.firstName, last_name: dto.lastName, contact_email: dto.email, age_confirmed_at: new Date() },
      });
      await tx.candidate_profiles.create({ data: { candidate_id: c.id } });
      await tx.candidate_visibility.create({ data: { candidate_id: c.id } });
      const privacy = policies.PRIVACY_POLICY;
      for (const [purpose, granted] of [['ACCOUNT_SERVICES', true], ['DATABASE_DISCOVERY', dto.discoverable]] as const) {
        await tx.candidate_consents.create({
          data: { candidate_id: c.id, purpose, granted, policy_document_id: privacy, source: 'SIGNUP', ip_address: meta.ip, user_agent: meta.userAgent },
        });
      }
      await this.acceptPolicies(tx, u.id, Object.values(policies), meta);
      await this.audit.record(tx, null, meta, { action: 'user.registered', entityType: 'user', entityId: u.id, metadata: { role: 'JOBSEEKER' } });
      return u;
    });
    await this.sendVerification(user.id, user.email);
    return { ok: true };
  }

  async registerEmployer(dto: RegisterEmployerDto, meta: RequestMeta) {
    this.checkPasswordStrength(dto.password, dto.email);
    const domain = dto.email.split('@')[1].toLowerCase();
    const primaryDomain = FREE_MAIL.has(domain) ? null : domain;
    if (primaryDomain) {
      const taken = await this.prisma.employers.findFirst({ where: { primary_domain: primaryDomain, status: { not: 'CLOSED' } } });
      if (taken) throw conflict('COMPANY_EXISTS', 'Your company already has a GenZHire account. Ask your company admin to invite you.');
    }
    const existing = await this.prisma.users.findUnique({ where: { email: dto.email } });
    if (existing) {
      this.notify.email(dto.email, 'Someone tried to register with your email', 'If this was you, sign in or reset your password.');
      return { ok: true };
    }
    const passwordHash = await hash(dto.password, ARGON);
    const policies = await this.currentPolicies(['PRIVACY_POLICY', 'TERMS_EMPLOYER']);
    const slugBase = dto.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'company';

    const user = await this.prisma.tx(async (tx) => {
      const u = await tx.users.create({
        data: {
          email: dto.email,
          full_name: `${dto.firstName} ${dto.lastName}`.trim(),
          password_hash: passwordHash,
          status: this.requireVerification ? 'PENDING_VERIFICATION' : 'ACTIVE',
        },
      });
      await this.grantRole(tx, u.id, 'EMPLOYER');
      const e = await tx.employers.create({ data: { name: dto.companyName, primary_domain: primaryDomain, created_by_user_id: u.id } });
      const slugTaken = await tx.companies.findUnique({ where: { slug: slugBase } });
      await tx.companies.create({
        data: {
          employer_id: e.id,
          legal_name: dto.companyName,
          display_name: dto.companyName,
          slug: slugTaken ? `${slugBase}-${randomBytes(3).toString('hex')}` : slugBase,
          website: primaryDomain ? `https://${primaryDomain}` : null,
        },
      });
      await tx.employer_users.create({
        data: { employer_id: e.id, user_id: u.id, company_role: 'COMPANY_ADMIN', designation: dto.designation ?? null },
      });
      await this.acceptPolicies(tx, u.id, Object.values(policies), meta);
      await this.audit.record(tx, null, meta, { action: 'user.registered', entityType: 'user', entityId: u.id, employerId: e.id, metadata: { role: 'EMPLOYER' } });
      return u;
    });
    await this.sendVerification(user.id, user.email);
    return { ok: true };
  }

  private async grantRole(tx: Tx, userId: string, code: string, grantedBy?: string) {
    const role = await tx.roles.findUniqueOrThrow({ where: { code } });
    await tx.user_roles.upsert({
      where: { user_id_role_id: { user_id: userId, role_id: role.id } },
      create: { user_id: userId, role_id: role.id, granted_by: grantedBy ?? null },
      update: {},
    });
  }

  /** Exposed for admin-created recruiter accounts. */
  async createStaffUser(tx: Tx, email: string, fullName: string, role: 'RECRUITER' | 'ADMIN', grantedBy: string) {
    const temporaryPassword = `${randomBytes(9).toString('base64url')}!7`;
    const u = await tx.users.create({
      data: { email, full_name: fullName, password_hash: await hash(temporaryPassword, ARGON), status: 'ACTIVE', email_verified_at: new Date() },
    });
    await this.grantRole(tx, u.id, role, grantedBy);
    return { user: u, temporaryPassword };
  }

  private async currentPolicies<T extends string>(types: T[]): Promise<Record<T, string>> {
    const out = {} as Record<T, string>;
    for (const t of types) {
      const p = await this.prisma.policy_documents.findFirst({ where: { type: t }, orderBy: { published_at: 'desc' } });
      if (!p) throw new Error(`Policy ${t} not seeded`);
      out[t] = p.id;
    }
    return out;
  }

  private async acceptPolicies(tx: Tx, userId: string, ids: string[], meta: RequestMeta) {
    for (const id of ids) {
      await tx.policy_acceptances.create({ data: { user_id: userId, policy_document_id: id, ip_address: meta.ip, user_agent: meta.userAgent } });
    }
  }

  private async sendVerification(userId: string, email: string) {
    const t = token();
    await this.prisma.verification_tokens.create({
      data: { user_id: userId, purpose: 'EMAIL_VERIFY', token_hash: sha256(t), expires_at: new Date(Date.now() + 48 * 3600_000) },
    });
    this.notify.email(email, 'Verify your GenZHire email', `Open: http://localhost:4200/verify-email?token=${t}`);
  }

  async verifyEmail(t: string) {
    const row = await this.consumeToken(t, 'EMAIL_VERIFY');
    await this.prisma.users.update({
      where: { id: row.user_id },
      data: { email_verified_at: new Date(), status: 'ACTIVE' },
    });
    return { ok: true };
  }

  private async consumeToken(t: string, purpose: string) {
    const row = await this.prisma.verification_tokens.findUnique({ where: { token_hash: sha256(t) } });
    if (!row || row.purpose !== purpose || row.consumed_at || row.expires_at < new Date()) {
      throw badRequest('INVALID_TOKEN', 'This link is invalid or has expired');
    }
    await this.prisma.verification_tokens.update({ where: { id: row.id }, data: { consumed_at: new Date() } });
    return row;
  }

  // ------------------------------------------------------------------- login

  async login(app: Audience, email: string, password: string, meta: RequestMeta) {
    const user = await this.prisma.users.findUnique({
      where: { email },
      include: { user_roles_user_roles_user_idTousers: { include: { roles: true } } },
    });
    const history = (success: boolean, failure_reason?: string) =>
      this.prisma.login_history.create({
        data: { user_id: user?.id ?? null, email_attempted: email, app: app.toUpperCase(), success, failure_reason, ip_address: meta.ip, user_agent: meta.userAgent },
      });

    if (!user?.password_hash) {
      await verify(await this.dummyHash, password).catch(() => false);
      await history(false, 'BAD_CREDENTIALS');
      throw INVALID_LOGIN();
    }
    if (user.locked_until && user.locked_until > new Date()) {
      await history(false, 'LOCKED');
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
    }
    if (!(await verify(user.password_hash, password))) {
      const fails = user.failed_login_count + 1;
      const lockMinutes = fails >= 5 ? [1, 5, 15, 60][Math.min(fails - 5, 3)] : 0;
      await this.prisma.users.update({
        where: { id: user.id },
        data: { failed_login_count: fails, locked_until: lockMinutes ? new Date(Date.now() + lockMinutes * 60_000) : null },
      });
      await history(false, 'BAD_CREDENTIALS');
      throw INVALID_LOGIN();
    }
    const roles = user.user_roles_user_roles_user_idTousers.map((r) => r.roles.code);
    if (!roles.includes(AUDIENCE_ROLE[app])) {
      await history(false, 'WRONG_APP');
      throw INVALID_LOGIN();
    }
    if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED' || user.status === 'DELETED') {
      await history(false, 'SUSPENDED');
      throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account is not active. Contact support@genzhire.work.');
    }
    if (user.status === 'PENDING_VERIFICATION' && this.requireVerification) {
      await history(false, 'EMAIL_NOT_VERIFIED');
      throw new AppError(HttpStatus.FORBIDDEN, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first.');
    }

    await this.prisma.users.update({
      where: { id: user.id },
      data: { failed_login_count: 0, locked_until: null, last_login_at: new Date() },
    });
    await history(true);
    return this.startSession(user.id, app, roles, meta);
  }

  private async claimsFor(userId: string, app: Audience, roles: string[], sid: string): Promise<AccessClaims> {
    const claims: AccessClaims = { sub: userId, aud: app, sid, roles: roles.filter((r) => r === AUDIENCE_ROLE[app]) };
    if (app === 'jobseeker') {
      const c = await this.prisma.candidates.findUnique({ where: { user_id: userId }, select: { id: true } });
      claims.cid = c?.id;
    } else if (app === 'employer') {
      const m = await this.prisma.employer_users.findFirst({ where: { user_id: userId, status: 'ACTIVE' } });
      if (!m) throw INVALID_LOGIN();
      claims.emp = m.employer_id;
      claims.cr = m.company_role;
    } else if (app === 'recruiter') {
      const r = await this.prisma.recruiters.findUnique({ where: { user_id: userId } });
      if (!r || r.status === 'INACTIVE') throw INVALID_LOGIN();
      claims.rid = r.id;
    }
    return claims;
  }

  private async startSession(userId: string, app: Audience, roles: string[], meta: RequestMeta) {
    const secret = token();
    const session = await this.prisma.sessions.create({
      data: {
        user_id: userId,
        app: app.toUpperCase(),
        refresh_token_hash: sha256(secret),
        ip_address: meta.ip,
        user_agent: meta.userAgent,
        expires_at: new Date(Date.now() + SESSION_TTL_DAYS[app] * 86400_000),
      },
    });
    const claims = await this.claimsFor(userId, app, roles, session.id);
    return {
      refreshToken: `${session.id}.${secret}`,
      refreshExpires: session.expires_at,
      ...(await this.issueAccess(claims)),
    };
  }

  private async issueAccess(claims: AccessClaims) {
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: '10m' });
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: claims.sub } });
    return {
      accessToken,
      expiresIn: 600,
      user: {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        app: claims.aud,
        roles: claims.roles,
        permissions: [...new Set(claims.roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))],
        employerId: claims.emp ?? null,
        companyRole: claims.cr ?? null,
        candidateId: claims.cid ?? null,
        recruiterId: claims.rid ?? null,
        emailVerified: !!u.email_verified_at,
      },
    };
  }

  /** Rotating refresh; reuse of a previous token revokes the session (theft signal). */
  async refresh(app: Audience, raw: string | undefined, meta: RequestMeta) {
    const [sid, secret] = (raw ?? '').split('.');
    if (!sid || !secret || !/^[0-9a-f-]{36}$/.test(sid)) throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Session expired');
    const s = await this.prisma.sessions.findUnique({ where: { id: sid } });
    const presented = sha256(secret);
    if (!s || s.app !== app.toUpperCase() || s.revoked_at || s.expires_at < new Date()) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Session expired');
    }
    if (!Buffer.from(s.refresh_token_hash).equals(presented)) {
      if (s.previous_token_hash && Buffer.from(s.previous_token_hash).equals(presented)) {
        await this.prisma.sessions.update({ where: { id: s.id }, data: { revoked_at: new Date(), revoke_reason: 'REFRESH_TOKEN_REUSE' } });
        await this.prisma.security_alerts.create({
          data: { type: 'REFRESH_TOKEN_REUSE', severity: 'HIGH', user_id: s.user_id, details: { sessionId: s.id, ip: meta.ip }, auto_action: 'SESSIONS_REVOKED' },
        });
      }
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Session expired');
    }
    const user = await this.prisma.users.findUniqueOrThrow({
      where: { id: s.user_id },
      include: { user_roles_user_roles_user_idTousers: { include: { roles: true } } },
    });
    if (user.status !== 'ACTIVE' && user.status !== 'PENDING_VERIFICATION') {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Session expired');
    }
    const next = token();
    await this.prisma.sessions.update({
      where: { id: s.id },
      data: { previous_token_hash: s.refresh_token_hash, refresh_token_hash: sha256(next), last_used_at: new Date() },
    });
    const roles = user.user_roles_user_roles_user_idTousers.map((r) => r.roles.code);
    const claims = await this.claimsFor(user.id, app, roles, s.id);
    return { refreshToken: `${s.id}.${next}`, refreshExpires: s.expires_at, ...(await this.issueAccess(claims)) };
  }

  async logout(raw: string | undefined) {
    const sid = (raw ?? '').split('.')[0];
    if (/^[0-9a-f-]{36}$/.test(sid)) {
      await this.prisma.sessions.updateMany({ where: { id: sid, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: 'LOGOUT' } });
    }
    return sid;
  }

  async logoutAll(p: Principal, meta: RequestMeta, reason = 'LOGOUT_ALL') {
    await this.prisma.tx(async (tx) => {
      await tx.sessions.updateMany({ where: { user_id: p.userId, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: reason } });
      await this.audit.record(tx, p, meta, { action: 'auth.logout_all', entityType: 'user', entityId: p.userId });
    });
  }

  sessions(userId: string) {
    return this.prisma.sessions.findMany({
      where: { user_id: userId, revoked_at: null, expires_at: { gt: new Date() } },
      select: { id: true, app: true, ip_address: true, user_agent: true, created_at: true, last_used_at: true },
      orderBy: { last_used_at: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    await this.prisma.sessions.updateMany({ where: { id: sessionId, user_id: userId }, data: { revoked_at: new Date(), revoke_reason: 'USER_REVOKED' } });
  }

  loginHistory(userId: string) {
    return this.prisma.login_history.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 30,
      select: { app: true, success: true, failure_reason: true, ip_address: true, user_agent: true, created_at: true },
    });
  }

  async changePassword(p: Principal, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: p.userId } });
    if (!u.password_hash || !(await verify(u.password_hash, current))) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    this.checkPasswordStrength(next, u.email);
    await this.prisma.tx(async (tx) => {
      await tx.users.update({ where: { id: u.id }, data: { password_hash: await hash(next, ARGON) } });
      await tx.sessions.updateMany({
        where: { user_id: u.id, revoked_at: null, id: { not: p.sessionId } },
        data: { revoked_at: new Date(), revoke_reason: 'PASSWORD_CHANGED' },
      });
      await this.audit.record(tx, p, meta, { action: 'auth.password_changed', entityType: 'user', entityId: u.id });
    });
    return { ok: true };
  }

  async forgotPassword(email: string) {
    const u = await this.prisma.users.findUnique({ where: { email } });
    if (u) {
      const t = token();
      await this.prisma.verification_tokens.create({
        data: { user_id: u.id, purpose: 'PASSWORD_RESET', token_hash: sha256(t), expires_at: new Date(Date.now() + 30 * 60_000) },
      });
      this.notify.email(email, 'Reset your GenZHire password', `Open within 30 minutes: /reset-password?token=${t}`);
    }
    return { ok: true };
  }

  async resetPassword(t: string, password: string, meta: RequestMeta) {
    const row = await this.consumeToken(t, 'PASSWORD_RESET');
    const u = await this.prisma.users.findUniqueOrThrow({ where: { id: row.user_id } });
    this.checkPasswordStrength(password, u.email);
    await this.prisma.tx(async (tx) => {
      await tx.users.update({ where: { id: u.id }, data: { password_hash: await hash(password, ARGON), failed_login_count: 0, locked_until: null } });
      await tx.sessions.updateMany({ where: { user_id: u.id, revoked_at: null }, data: { revoked_at: new Date(), revoke_reason: 'PASSWORD_RESET' } });
      await this.audit.record(tx, null, meta, { action: 'auth.password_reset', entityType: 'user', entityId: u.id });
    });
    return { ok: true };
  }
}
