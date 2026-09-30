import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import {
  AddCandidateDto, DecisionDto, InterviewDto, InterviewUpdateDto, JoiningDto, LeftDto, MoveDto, OfferDto, OfferStatusDto,
  RequirementDto,
} from './recruitment.dto';
import { RecruitmentService } from './recruitment.service';

@Controller()
export class RecruitmentController {
  constructor(private readonly svc: RecruitmentService) {}

  // ------------------------------------------------------------- employer

  @Audiences('employer') @RequirePermission('requirements.manage') @Post('employer/hiring-requirements')
  create(@CurrentUser() p: Principal, @Body() d: RequirementDto, @Meta() m: RequestMeta) {
    return this.svc.createRequirement(p, d, m);
  }

  @Audiences('employer') @RequirePermission('requirements.manage') @Get('employer/hiring-requirements')
  list(@CurrentUser() p: Principal) {
    return this.svc.employerRequirements(p);
  }

  @Audiences('employer') @RequirePermission('requirements.manage') @Get('employer/hiring-requirements/:id')
  one(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.employerRequirement(p, id);
  }

  @Audiences('employer') @RequirePermission('requirements.manage') @Post('employer/hiring-requirements/:id/cancel') @HttpCode(200)
  cancel(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.cancelRequirement(p, id, m);
  }

  @Audiences('employer') @RequirePermission('recruitment.review') @Post('employer/recruitment/submissions/:id/decision') @HttpCode(200)
  decision(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: DecisionDto, @Meta() m: RequestMeta) {
    return this.svc.employerDecision(p, id, d.decision, d.feedback, m);
  }

  @Audiences('employer') @RequirePermission('recruitment.joining.confirm') @Post('employer/recruitment/joinings/:id/confirm') @HttpCode(200)
  confirm(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.employerConfirmJoining(p, id, m);
  }

  @Audiences('employer') @RequirePermission('recruitment.joining.confirm') @Post('employer/recruitment/joinings/:id/left') @HttpCode(200)
  employerLeft(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: LeftDto, @Meta() m: RequestMeta) {
    return this.svc.employerReportLeft(p, id, d.leftOn, d.reason, m);
  }

  // ------------------------------------------------------------ recruiter

  @Audiences('recruiter', 'admin') @RequirePermission('billing.read') @Get('recruitment/stages')
  stages() {
    return this.svc.stages();
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Get('recruitment/dashboard')
  dashboard(@CurrentUser() p: Principal) {
    return this.svc.dashboard(p);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Get('recruitment/cases')
  cases(@CurrentUser() p: Principal) {
    return this.svc.cases(p);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Get('recruitment/cases/:id')
  caseDetail(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.caseDetail(p, id);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Post('recruitment/cases/:id/candidates')
  add(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: AddCandidateDto, @Meta() m: RequestMeta) {
    return this.svc.addCandidate(p, id, d.candidateId, d.source, d.notes, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Get('recruitment/pipeline/:id')
  candidate(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.candidateDetail(p, id, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Post('recruitment/pipeline/:id/move') @HttpCode(200)
  move(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: MoveDto, @Meta() m: RequestMeta) {
    return this.svc.move(p, id, d.toStageId, d.note, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Post('recruitment/pipeline/:id/submit') @HttpCode(200)
  submit(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.submit(p, id, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Post('recruitment/pipeline/:id/interviews')
  interview(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: InterviewDto, @Meta() m: RequestMeta) {
    return this.svc.scheduleInterview(p, id, d, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Patch('recruitment/interviews/:id')
  updateInterview(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: InterviewUpdateDto) {
    return this.svc.updateInterview(p, id, d.status, d.outcome, d.feedback);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Get('recruitment/interviews')
  interviews(@CurrentUser() p: Principal, @Query('days') days?: string) {
    return this.svc.upcomingInterviews(p, Math.min(Number(days) || 30, 90));
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Post('recruitment/pipeline/:id/offer')
  offer(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: OfferDto, @Meta() m: RequestMeta) {
    return this.svc.offer(p, id, d, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.pipeline.manage') @Patch('recruitment/offers/:id')
  offerStatus(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: OfferStatusDto) {
    return this.svc.offerStatus(p, id, d.status);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.joining.confirm') @Post('recruitment/pipeline/:id/joining')
  joining(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: JoiningDto, @Meta() m: RequestMeta) {
    return this.svc.recordJoining(p, id, d.joiningDate, m);
  }

  @Audiences('recruiter', 'admin') @RequirePermission('billing.read') @Get('recruitment/tracking')
  tracking(@CurrentUser() p: Principal, @Query('dueWithinDays') due?: string) {
    return this.svc.tracking(p, due ? Number(due) : undefined);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.joining.confirm') @Post('recruitment/joinings/:id/still-employed') @HttpCode(200)
  stillEmployed(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.stillEmployed(p, id, m);
  }

  @Audiences('recruiter') @RequirePermission('recruitment.joining.confirm') @Post('recruitment/joinings/:id/left') @HttpCode(200)
  left(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: LeftDto, @Meta() m: RequestMeta) {
    return this.svc.recruiterLeft(p, id, d.leftOn, d.reason, m);
  }

  @Audiences('recruiter', 'admin') @RequirePermission('billing.read') @Get('recruitment/billing')
  billing(@CurrentUser() p: Principal) {
    return this.svc.billing(p);
  }
}
