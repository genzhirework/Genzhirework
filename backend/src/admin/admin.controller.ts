import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  Allow, ArrayMinSize, IsDefined, IsArray, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min,
} from 'class-validator';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import { badRequest } from '../common/errors';
import { AdminService } from './admin.service';

class ReasonDto {
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
class RequiredReasonDto {
  @IsString() @Length(3, 1000) reason: string;
}
class GrantDto {
  @IsInt() @Min(1) @Max(10000) quantity: number;
  @IsInt() @Min(1) @Max(1095) validDays: number;
  @IsString() @Length(3, 300) note: string;
}
class OpenCaseDto {
  @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) recruiterIds: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) feePercentage?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) paymentTriggerDays?: number;
}
class RecruiterDto {
  @IsEmail() email: string;
  @IsString() @Length(2, 80) fullName: string;
  @IsOptional() @IsString() @MaxLength(80) designation?: string;
}
class SettingDto {
  @IsDefined() @Allow() value: unknown;
  @IsString() @Length(3, 300) reason: string;
}
class StatusDto {
  @IsIn(['ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE', 'INVESTIGATING', 'ACTIONED', 'DISMISSED']) status: string;
  @IsOptional() @IsString() @MaxLength(1000) resolution?: string;
}

@Controller('admin')
@Audiences('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('metrics') @RequirePermission('users.read')
  metrics(@Query('from') from?: string, @Query('to') to?: string) { return this.svc.metrics(from, to); }

  @Get('users') @RequirePermission('users.read')
  users(@Query('q') q?: string, @Query('role') role?: string, @Query('status') status?: string, @Query('cursor') cursor?: string) {
    return this.svc.users(q || undefined, role || undefined, status || undefined, cursor);
  }
  @Get('users/:id') @RequirePermission('users.read')
  user(@Param('id', ParseUUIDPipe) id: string) { return this.svc.user(id); }
  @Post('users/:id/suspend') @HttpCode(200) @RequirePermission('users.manage')
  suspend(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.setUserStatus(p, id, 'SUSPENDED', d.reason, m);
  }
  @Post('users/:id/reactivate') @HttpCode(200) @RequirePermission('users.manage')
  reactivate(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.setUserStatus(p, id, 'ACTIVE', d.reason, m);
  }

  @Get('employers') @RequirePermission('users.read')
  employers(@Query('q') q?: string, @Query('verification') v?: string, @Query('cursor') cursor?: string) {
    return this.svc.employers(q || undefined, v || undefined, cursor);
  }
  @Get('employers/:id') @RequirePermission('users.read')
  employer(@Param('id', ParseUUIDPipe) id: string) { return this.svc.employer(id); }
  @Post('employers/:id/entitlements') @RequirePermission('entitlements.manage')
  grant(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: GrantDto, @Meta() m: RequestMeta) {
    return this.svc.grantCredits(p, id, d.quantity, d.validDays, d.note, m);
  }
  @Post('employers/:id/suspend') @HttpCode(200) @RequirePermission('users.manage')
  suspendEmployer(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.setEmployerStatus(p, id, true, d.reason, m);
  }
  @Post('employers/:id/reinstate') @HttpCode(200) @RequirePermission('users.manage')
  reinstateEmployer(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.setEmployerStatus(p, id, false, d.reason, m);
  }

  @Get('verifications') @RequirePermission('employer.verification.review')
  verifications(@Query('status') status?: string) { return this.svc.verificationQueue(status || 'OPEN'); }
  @Post('verifications/:id/:decision') @HttpCode(200) @RequirePermission('employer.verification.review')
  decide(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('decision') decision: string, @Body() d: ReasonDto, @Meta() m: RequestMeta) {
    if (!['approve', 'reject', 'request-info', 'start-review'].includes(decision)) throw badRequest('INVALID_ACTION', 'Unknown decision');
    return this.svc.decideVerification(p, id, decision as 'approve', d.reason, m);
  }

  @Get('jobs') @RequirePermission('jobs.moderate')
  jobs(@Query('status') status?: string) { return this.svc.jobs(status || undefined); }
  @Post('jobs/:id/approve') @HttpCode(200) @RequirePermission('jobs.moderate')
  approveJob(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReasonDto, @Meta() m: RequestMeta) {
    return this.svc.moderateJob(p, id, true, d.reason, m);
  }
  @Post('jobs/:id/reject') @HttpCode(200) @RequirePermission('jobs.moderate')
  rejectJob(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.moderateJob(p, id, false, d.reason, m);
  }

  @Get('applications') @RequirePermission('applications.read')
  applications(@Query('status') status?: string, @Query('cursor') cursor?: string) { return this.svc.applications(status || undefined, cursor); }

  @Get('candidates') @RequirePermission('users.read')
  candidates(@Query('q') q?: string, @Query('cursor') cursor?: string) { return this.svc.candidates(q || undefined, cursor); }
  @Get('candidates/:id') @RequirePermission('talent.view')
  candidate(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) { return this.svc.candidate(p, id, m); }

  @Get('hiring-requirements') @RequirePermission('requirements.assign')
  requirements(@Query('status') status?: string) { return this.svc.requirements(status || undefined); }
  @Post('hiring-requirements/:id/open-case') @RequirePermission('requirements.assign')
  openCase(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: OpenCaseDto, @Meta() m: RequestMeta) {
    return this.svc.openCase(p, id, d.recruiterIds, d.feePercentage, d.paymentTriggerDays, m);
  }
  @Get('recruitment/cases') @RequirePermission('requirements.assign')
  cases() { return this.svc.cases(); }
  @Get('recruiters') @RequirePermission('users.read')
  recruiters() { return this.svc.recruiters(); }
  @Post('recruiters') @RequirePermission('users.manage')
  createRecruiter(@CurrentUser() p: Principal, @Body() d: RecruiterDto, @Meta() m: RequestMeta) {
    return this.svc.createRecruiter(p, d.email, d.fullName, d.designation, m);
  }
  @Post('billing/:id/waive') @HttpCode(200) @RequirePermission('billing.manage')
  waive(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: RequiredReasonDto, @Meta() m: RequestMeta) {
    return this.svc.waiveBilling(p, id, d.reason, m);
  }

  @Get('access-logs') @RequirePermission('audit.read')
  access(@Query('employerId') e?: string, @Query('candidateId') c?: string, @Query('action') a?: string, @Query('cursor') cursor?: string) {
    return this.svc.accessLogs(e || undefined, c || undefined, a || undefined, cursor);
  }
  @Get('audit-logs') @RequirePermission('audit.read')
  audit(@Query('action') a?: string, @Query('entityType') t?: string, @Query('entityId') id?: string, @Query('cursor') cursor?: string) {
    return this.svc.auditLogs(a || undefined, t || undefined, id || undefined, cursor);
  }
  @Get('audit-logs/verify') @RequirePermission('audit.read')
  verify() { return this.svc.verifyAuditChain(); }

  @Get('settings') @RequirePermission('settings.manage')
  settings() { return this.svc.settingsList(); }
  @Put('settings/:key') @RequirePermission('settings.manage')
  setting(@CurrentUser() p: Principal, @Param('key') key: string, @Body() d: SettingDto, @Meta() m: RequestMeta) {
    return this.svc.updateSetting(p, key, d.value, d.reason, m);
  }
  @Get('settings/:key/history') @RequirePermission('settings.manage')
  history(@Param('key') key: string) { return this.svc.settingHistory(key); }

  @Get('security-alerts') @RequirePermission('users.manage')
  alerts(@Query('status') status?: string) { return this.svc.alerts(status || 'OPEN'); }
  @Post('security-alerts/:id/resolve') @HttpCode(200) @RequirePermission('users.manage')
  resolve(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: StatusDto, @Meta() m: RequestMeta) {
    return this.svc.resolveAlert(p, id, d.status, m);
  }
  @Get('abuse-reports') @RequirePermission('jobs.moderate')
  reports(@Query('status') status?: string) { return this.svc.reports(status || undefined); }
  @Post('abuse-reports/:id/action') @HttpCode(200) @RequirePermission('jobs.moderate')
  actionReport(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: StatusDto, @Meta() m: RequestMeta) {
    return this.svc.actionReport(p, id, d.status, d.resolution ?? '', m);
  }
}
