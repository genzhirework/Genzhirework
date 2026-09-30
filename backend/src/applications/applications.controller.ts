import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { ApplyDto } from '../candidate/candidate.dto';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import { ApplicationsService } from './applications.service';

class StatusDto {
  @IsIn(['SCREENING', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED']) toStatus: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export function sendFile(res: Response, file: { original_name: string; mime_type: string }, bytes: Buffer) {
  res.set({
    'Content-Type': file.mime_type,
    'Content-Disposition': `attachment; filename="${file.original_name.replace(/"/g, '')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return new StreamableFile(bytes);
}

@Controller()
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Audiences('jobseeker') @RequirePermission('candidate.applications.manage')
  @Post('candidate/jobs/:jobId/apply') @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  apply(@CurrentUser() p: Principal, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() d: ApplyDto) {
    return this.svc.apply(p, jobId, d.resumeId, d.coverNote);
  }

  @Audiences('jobseeker') @RequirePermission('candidate.applications.manage') @Get('candidate/applications')
  mine(@CurrentUser() p: Principal, @Query('status') status?: string) {
    return this.svc.mine(p, status);
  }

  @Audiences('jobseeker') @RequirePermission('candidate.applications.manage') @Get('candidate/applications/:id')
  mineOne(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.mineOne(p, id);
  }

  @Audiences('jobseeker') @RequirePermission('candidate.applications.manage') @Post('candidate/applications/:id/withdraw') @HttpCode(200)
  withdraw(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.withdraw(p, id);
  }

  @Audiences('employer') @RequirePermission('applications.read') @Get('employer/applications')
  list(@CurrentUser() p: Principal, @Query('jobId') jobId?: string, @Query('status') status?: string) {
    return this.svc.employerList(p, jobId || undefined, status || undefined);
  }

  @Audiences('employer') @RequirePermission('applications.read') @Get('employer/applications/:id')
  one(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.employerOne(p, id, m);
  }

  @Audiences('employer') @RequirePermission('applications.manage') @Post('employer/applications/:id/status') @HttpCode(200)
  status(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: StatusDto, @Meta() m: RequestMeta) {
    return this.svc.changeStatus(p, id, d.toStatus, d.note, !!d.confirm, m);
  }

  @Audiences('employer') @RequirePermission('applications.read') @Get('employer/applications/:id/resume')
  @Throttle({ default: { limit: 20, ttl: 86_400_000 } })
  async resume(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { file, bytes } = await this.svc.resume(p, id, m);
    return sendFile(res, file, bytes);
  }
}
