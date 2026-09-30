import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import {
  BlockEmployerDto, CertificationDto, ConsentDto, EducationDto, ExperienceDto, ProjectDto, ResumeDto,
  ResumePatchDto, SkillsDto, UpdateProfileDto, VisibilityDto,
} from './candidate.dto';
import { CandidateService } from './candidate.service';

@Controller('candidate')
@Audiences('jobseeker')
export class CandidateController {
  constructor(private readonly svc: CandidateService) {}

  @Get('profile') @RequirePermission('candidate.profile.edit')
  me(@CurrentUser() p: Principal) {
    return this.svc.me(p);
  }

  @Patch('profile') @RequirePermission('candidate.profile.edit')
  update(@CurrentUser() p: Principal, @Body() dto: UpdateProfileDto) {
    return this.svc.updateProfile(p, dto);
  }

  @Post('onboarding/complete') @HttpCode(200) @RequirePermission('candidate.profile.edit')
  onboard(@CurrentUser() p: Principal) {
    return this.svc.completeOnboarding(p);
  }

  @Get('profile/preview') @RequirePermission('candidate.profile.edit')
  preview(@CurrentUser() p: Principal, @Query('as') as = 'FULL') {
    const level = (['CARD', 'LOCKED', 'FULL'].includes(as.toUpperCase()) ? as.toUpperCase() : 'FULL') as 'CARD' | 'LOCKED' | 'FULL';
    return this.svc.preview(p, level);
  }

  @Post('education') @RequirePermission('candidate.profile.edit')
  addEdu(@CurrentUser() p: Principal, @Body() d: EducationDto) { return this.svc.addSection(p, 'education', d); }
  @Patch('education/:id') @RequirePermission('candidate.profile.edit')
  updEdu(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: EducationDto) { return this.svc.updateSection(p, 'education', id, d); }
  @Delete('education/:id') @HttpCode(204) @RequirePermission('candidate.profile.edit')
  delEdu(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteSection(p, 'education', id); }

  @Post('experience') @RequirePermission('candidate.profile.edit')
  addExp(@CurrentUser() p: Principal, @Body() d: ExperienceDto) { return this.svc.addSection(p, 'experience', d); }
  @Patch('experience/:id') @RequirePermission('candidate.profile.edit')
  updExp(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ExperienceDto) { return this.svc.updateSection(p, 'experience', id, d); }
  @Delete('experience/:id') @HttpCode(204) @RequirePermission('candidate.profile.edit')
  delExp(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteSection(p, 'experience', id); }

  @Post('projects') @RequirePermission('candidate.profile.edit')
  addPrj(@CurrentUser() p: Principal, @Body() d: ProjectDto) { return this.svc.addSection(p, 'projects', d); }
  @Patch('projects/:id') @RequirePermission('candidate.profile.edit')
  updPrj(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ProjectDto) { return this.svc.updateSection(p, 'projects', id, d); }
  @Delete('projects/:id') @HttpCode(204) @RequirePermission('candidate.profile.edit')
  delPrj(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteSection(p, 'projects', id); }

  @Post('certifications') @RequirePermission('candidate.profile.edit')
  addCert(@CurrentUser() p: Principal, @Body() d: CertificationDto) { return this.svc.addSection(p, 'certifications', d); }
  @Patch('certifications/:id') @RequirePermission('candidate.profile.edit')
  updCert(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: CertificationDto) { return this.svc.updateSection(p, 'certifications', id, d); }
  @Delete('certifications/:id') @HttpCode(204) @RequirePermission('candidate.profile.edit')
  delCert(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteSection(p, 'certifications', id); }

  @Put('skills') @RequirePermission('candidate.profile.edit')
  skills(@CurrentUser() p: Principal, @Body() d: SkillsDto) { return this.svc.setSkills(p, d.skills); }

  @Post('resumes') @RequirePermission('candidate.profile.edit')
  addResume(@CurrentUser() p: Principal, @Body() d: ResumeDto) { return this.svc.addResume(p, d.fileId, d.label); }
  @Patch('resumes/:id') @RequirePermission('candidate.profile.edit')
  patchResume(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ResumePatchDto) {
    return this.svc.patchResume(p, id, d.isPrimary, d.label);
  }
  @Delete('resumes/:id') @HttpCode(204) @RequirePermission('candidate.profile.edit')
  delResume(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) { return this.svc.deleteResume(p, id); }

  @Put('visibility') @RequirePermission('candidate.privacy.manage')
  visibility(@CurrentUser() p: Principal, @Body() d: VisibilityDto, @Meta() m: RequestMeta) {
    return this.svc.setVisibility(p, d.level, d.openToWork, m);
  }

  @Post('consents') @HttpCode(200) @RequirePermission('candidate.privacy.manage')
  consent(@CurrentUser() p: Principal, @Body() d: ConsentDto, @Meta() m: RequestMeta) {
    return this.svc.setConsent(p, d.purpose, d.granted, m);
  }

  @Get('blocked-employers') @RequirePermission('candidate.privacy.manage')
  blocked(@CurrentUser() p: Principal) { return this.svc.blockedEmployers(p); }
  @Get('blocked-employers/search') @RequirePermission('candidate.privacy.manage')
  searchBlock(@Query('q') q: string) { return this.svc.searchEmployersToBlock(q); }
  @Post('blocked-employers') @RequirePermission('candidate.privacy.manage')
  block(@CurrentUser() p: Principal, @Body() d: BlockEmployerDto, @Meta() m: RequestMeta) { return this.svc.block(p, d.employerId, m); }
  @Delete('blocked-employers/:employerId') @HttpCode(204) @RequirePermission('candidate.privacy.manage')
  unblock(@CurrentUser() p: Principal, @Param('employerId', ParseUUIDPipe) e: string) { return this.svc.unblock(p, e); }

  @Get('profile-access') @RequirePermission('candidate.privacy.manage')
  access(@CurrentUser() p: Principal) { return this.svc.profileAccess(p); }

  @Get('saved-jobs') @RequirePermission('candidate.applications.manage')
  saved(@CurrentUser() p: Principal) { return this.svc.savedJobs(p); }
  @Put('saved-jobs/:jobId') @RequirePermission('candidate.applications.manage')
  save(@CurrentUser() p: Principal, @Param('jobId', ParseUUIDPipe) j: string) { return this.svc.saveJob(p, j); }
  @Delete('saved-jobs/:jobId') @HttpCode(204) @RequirePermission('candidate.applications.manage')
  unsave(@CurrentUser() p: Principal, @Param('jobId', ParseUUIDPipe) j: string) { return this.svc.unsaveJob(p, j); }

  @Get('contact-requests') @RequirePermission('candidate.contact_requests.respond')
  contacts(@CurrentUser() p: Principal) { return this.svc.contactRequests(p); }
  @Post('contact-requests/:id/accept') @HttpCode(200) @RequirePermission('candidate.contact_requests.respond')
  accept(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) { return this.svc.respondContact(p, id, true, m); }
  @Post('contact-requests/:id/decline') @HttpCode(200) @RequirePermission('candidate.contact_requests.respond')
  decline(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) { return this.svc.respondContact(p, id, false, m); }
}
