import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Audience, Permission } from './permissions';

export const IS_PUBLIC = 'gh:public';
export const AUDIENCES = 'gh:audiences';
export const PERMISSION = 'gh:permission';
export const AUTHENTICATED = 'gh:authenticated';

/** Route needs no authentication. A valid token, if sent, is still decoded (for viewer state). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any authenticated user of the listed apps (used for self-service like /auth/me). */
export const Authenticated = () => SetMetadata(AUTHENTICATED, true);
/** Which applications' tokens may call this route. */
export const Audiences = (...a: Audience[]) => SetMetadata(AUDIENCES, a);
/** Permission required; routes with none of Public/Authenticated/RequirePermission are denied. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION, p);

export interface Principal {
  userId: string;
  sessionId: string;
  aud: Audience;
  roles: string[];
  employerId?: string;
  companyRole?: string;
  candidateId?: string;
  recruiterId?: string;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest().user;
});

export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal | undefined => {
  return ctx.switchToHttp().getRequest().user;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null, requestId: req.id ?? null };
});
