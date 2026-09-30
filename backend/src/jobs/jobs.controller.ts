import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  Audiences, Authenticated, CurrentUser, Meta, OptionalUser, Principal, Public, RequestMeta, RequirePermission,
} from '../common/decorators';
import { badRequest } from '../common/errors';
import { JobDto, ReportDto } from './jobs.dto';
import { JobSearchQuery, JobsService } from './jobs.service';

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Public() @Get('jobs') @Throttle({ default: { limit: 120, ttl: 60_000 } })
  search(@Query() q: JobSearchQuery, @OptionalUser() viewer?: Principal) {
    return this.jobs.search(q, viewer);
  }

  @Public() @Get('jobs/featured')
  featured() {
    return this.jobs.featured();
  }

  @Public() @Get('jobs/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @OptionalUser() viewer?: Principal) {
    return this.jobs.publicDetail(id, viewer);
  }

  @Authenticated() @Post('jobs/:id/report') @Throttle({ default: { limit: 10, ttl: 3600_000 } })
  report(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ReportDto) {
    return this.jobs.report(p, id, d.reason, d.details);
  }

  @Public() @Get('companies/:slug')
  company(@Param('slug') slug: string) {
    return this.jobs.company(slug);
  }

  @Public() @Get('meta/skills')
  skills(@Query('q') q?: string) {
    return this.jobs.skills(q);
  }

  // ------------------------------------------------------------- employer

  @Audiences('employer') @RequirePermission('jobs.manage') @Get('employer/jobs')
  list(@CurrentUser() p: Principal, @Query('status') status?: string) {
    return this.jobs.employerJobs(p, status);
  }

  @Audiences('employer') @RequirePermission('jobs.manage') @Post('employer/jobs')
  create(@CurrentUser() p: Principal, @Body() d: JobDto, @Meta() m: RequestMeta) {
    return this.jobs.create(p, d, m);
  }

  @Audiences('employer') @RequirePermission('jobs.manage') @Get('employer/jobs/:id')
  get(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.employerJob(p, id);
  }

  @Audiences('employer') @RequirePermission('jobs.manage') @Patch('employer/jobs/:id')
  update(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: JobDto, @Meta() m: RequestMeta) {
    return this.jobs.update(p, id, d, m);
  }

  @Audiences('employer') @RequirePermission('jobs.manage') @Post('employer/jobs/:id/:action') @HttpCode(200)
  act(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Meta() m: RequestMeta) {
    if (!['submit', 'pause', 'resume', 'close'].includes(action)) throw badRequest('INVALID_ACTION', 'Unknown job action');
    return this.jobs.action(p, id, action as 'submit', m);
  }
}
