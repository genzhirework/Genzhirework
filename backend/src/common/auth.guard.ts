import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUDIENCES, AUTHENTICATED, IS_PUBLIC, PERMISSION, Principal } from './decorators';
import { AppError, forbidden } from './errors';
import { Audience, COMPANY_ROLE_DENY, Permission, ROLE_PERMISSIONS } from './permissions';
import { PrismaService } from './prisma.service';

export interface AccessClaims {
  sub: string;
  aud: Audience;
  sid: string;
  roles: string[];
  emp?: string;
  cr?: string;
  cid?: string;
  rid?: string;
}

const unauthenticated = () => new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in to continue');

/**
 * Deny-by-default access control (docs/08-rbac.md §1):
 *   1. audience — the token's app must be allowed on this route
 *   2. permission — from the role matrix, narrowed by company role
 *   3. scope — enforced in services using Principal.employerId/candidateId/recruiterId
 * A route without @Public, @Authenticated or @RequirePermission is rejected.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly log = new Logger('AuthGuard');
  private readonly sessionCache = new Map<string, { ok: boolean; at: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  forgetSession(sessionId: string) {
    this.sessionCache.delete(sessionId);
  }

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.meta<boolean>(IS_PUBLIC, ctx);
    const principal = await this.authenticate(req.headers.authorization);
    if (principal) req.user = principal;

    if (isPublic) return true;
    if (!principal) throw unauthenticated();

    const audiences = this.meta<Audience[]>(AUDIENCES, ctx);
    if (audiences && !audiences.includes(principal.aud)) throw forbidden('WRONG_APP', 'This action is not available in this app');

    const permission = this.meta<Permission>(PERMISSION, ctx);
    if (permission) {
      if (!this.hasPermission(principal, permission)) throw forbidden();
      return true;
    }
    if (this.meta<boolean>(AUTHENTICATED, ctx)) return true;

    this.log.error(`Route ${req.method} ${req.url} has no access declaration — denied`);
    throw forbidden();
  }

  hasPermission(p: Principal, perm: Permission): boolean {
    const granted = p.roles.some((r) => ROLE_PERMISSIONS[r]?.includes(perm));
    if (!granted) return false;
    if (p.aud === 'employer' && p.companyRole) return !(COMPANY_ROLE_DENY[p.companyRole] ?? []).includes(perm);
    return true;
  }

  private async authenticate(header?: string): Promise<Principal | null> {
    if (!header?.startsWith('Bearer ')) return null;
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(header.slice(7));
    } catch {
      throw unauthenticated();
    }
    if (!(await this.sessionActive(claims.sid))) throw unauthenticated();
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      aud: claims.aud,
      roles: claims.roles,
      employerId: claims.emp,
      companyRole: claims.cr,
      candidateId: claims.cid,
      recruiterId: claims.rid,
    };
  }

  /** Revocation takes effect within 30 s across processes, immediately in this one. */
  private async sessionActive(sid: string): Promise<boolean> {
    const hit = this.sessionCache.get(sid);
    if (hit && Date.now() - hit.at < 30_000) return hit.ok;
    const s = await this.prisma.sessions.findUnique({
      where: { id: sid },
      select: { revoked_at: true, expires_at: true, users: { select: { status: true } } },
    });
    const ok = !!s && !s.revoked_at && s.expires_at > new Date() && s.users.status === 'ACTIVE';
    this.sessionCache.set(sid, { ok, at: Date.now() });
    return ok;
  }
}
