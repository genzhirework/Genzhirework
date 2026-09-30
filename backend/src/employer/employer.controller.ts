import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import { CompanyDto, VerificationDto } from './employer.dto';
import { EmployerService } from './employer.service';

@Controller('employer')
@Audiences('employer')
export class EmployerController {
  constructor(private readonly svc: EmployerService) {}

  @Get('dashboard') @RequirePermission('employer.dashboard.read')
  dashboard(@CurrentUser() p: Principal) {
    return this.svc.dashboard(p);
  }

  @Get('company') @RequirePermission('employer.dashboard.read')
  company(@CurrentUser() p: Principal) {
    return this.svc.company(p);
  }

  @Patch('company') @RequirePermission('employer.company.manage')
  updateCompany(@CurrentUser() p: Principal, @Body() d: CompanyDto, @Meta() m: RequestMeta) {
    return this.svc.updateCompany(p, d, m);
  }

  @Get('verification') @RequirePermission('employer.dashboard.read')
  verifications(@CurrentUser() p: Principal) {
    return this.svc.verifications(p);
  }

  @Post('verification') @RequirePermission('employer.verification.submit')
  submit(@CurrentUser() p: Principal, @Body() d: VerificationDto, @Meta() m: RequestMeta) {
    return this.svc.submitVerification(p, d, m);
  }

  @Get('team') @RequirePermission('employer.dashboard.read')
  team(@CurrentUser() p: Principal) {
    return this.svc.team(p);
  }
}
