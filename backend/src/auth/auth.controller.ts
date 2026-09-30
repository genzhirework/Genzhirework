import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { Authenticated, CurrentUser, Meta, Principal, Public, RequestMeta } from '../common/decorators';
import type { Audience } from '../common/permissions';
import {
  AppParam, ChangePasswordDto, ForgotPasswordDto, LoginDto, RegisterCandidateDto,
  RegisterEmployerDto, ResetPasswordDto, VerifyEmailDto,
} from './auth.dto';
import { AuthService, refreshCookieName } from './auth.service';

const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly guard: AuthGuard) {}

  /**
   * One refresh cookie per app (gh_rt_<app>), HttpOnly + SameSite=Strict, scoped
   * to the auth path. Distinct names keep sessions isolated even on localhost,
   * where cookies are shared across ports.
   */
  private setCookie(res: Response, app: Audience, value: string, expires: Date) {
    res.cookie(refreshCookieName(app), value, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires,
    });
  }

  @Public() @Post('register/candidate') @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  registerCandidate(@Body() dto: RegisterCandidateDto, @Meta() meta: RequestMeta) {
    return this.auth.registerCandidate(dto, meta);
  }

  @Public() @Post('register/employer') @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  registerEmployer(@Body() dto: RegisterEmployerDto, @Meta() meta: RequestMeta) {
    return this.auth.registerEmployer(dto, meta);
  }

  @Public() @Post('verify-email') @HttpCode(200)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public() @Post('password/forgot') @HttpCode(202) @Throttle({ default: { limit: 3, ttl: 3600_000 } })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public() @Post('password/reset') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 3600_000 } })
  reset(@Body() dto: ResetPasswordDto, @Meta() meta: RequestMeta) {
    return this.auth.resetPassword(dto.token, dto.password, meta);
  }

  @Public() @Post(':app/login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 600_000 } })
  async login(@Param() { app }: AppParam, @Body() dto: LoginDto, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, refreshExpires, ...rest } = await this.auth.login(app as Audience, dto.email, dto.password, meta);
    this.setCookie(res, app as Audience, refreshToken, refreshExpires);
    return rest;
  }

  @Public() @Post(':app/refresh') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Param() { app }: AppParam, @Req() req: Request, @Meta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const a = app as Audience;
    try {
      const { refreshToken, refreshExpires, ...rest } = await this.auth.refresh(a, req.cookies?.[refreshCookieName(a)], meta);
      this.setCookie(res, a, refreshToken, refreshExpires);
      return rest;
    } catch (e) {
      res.clearCookie(refreshCookieName(a), { path: COOKIE_PATH });
      throw e;
    }
  }

  @Public() @Post(':app/logout') @HttpCode(204)
  async logout(@Param() { app }: AppParam, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const a = app as Audience;
    const sid = await this.auth.logout(req.cookies?.[refreshCookieName(a)]);
    this.guard.forgetSession(sid);
    res.clearCookie(refreshCookieName(a), { path: COOKIE_PATH });
  }

  @Authenticated() @Post('logout-all') @HttpCode(204)
  async logoutAll(@CurrentUser() p: Principal, @Meta() meta: RequestMeta) {
    await this.auth.logoutAll(p, meta);
    this.guard.forgetSession(p.sessionId);
  }

  @Authenticated() @Get('sessions')
  sessions(@CurrentUser() p: Principal) {
    return this.auth.sessions(p.userId).then((rows) => rows.map((r) => ({ ...r, current: r.id === p.sessionId })));
  }

  @Authenticated() @Delete('sessions/:id') @HttpCode(204)
  async revoke(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(p.userId, id);
    this.guard.forgetSession(id);
  }

  @Authenticated() @Get('login-history')
  history(@CurrentUser() p: Principal) {
    return this.auth.loginHistory(p.userId);
  }

  @Authenticated() @Post('password/change') @HttpCode(200)
  change(@CurrentUser() p: Principal, @Body() dto: ChangePasswordDto, @Meta() meta: RequestMeta) {
    return this.auth.changePassword(p, dto.currentPassword, dto.newPassword, meta);
  }
}
