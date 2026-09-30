import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CandidateIndexService } from './candidate/candidate-index.service';
import { CandidateController } from './candidate/candidate.controller';
import { CandidateService } from './candidate/candidate.service';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { NotifyService } from './common/notify.service';
import { PrismaService } from './common/prisma.service';
import { ProblemDetailsFilter } from './common/problem.filter';
import { SerializeInterceptor } from './common/serialize.interceptor';
import { SettingsService } from './common/settings.service';
import { EmployerController } from './employer/employer.controller';
import { EmployerService } from './employer/employer.service';
import { FilesController } from './files/files.controller';
import { FilesService } from './files/files.service';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { NotificationsController } from './notifications/notifications.controller';
import { RecruitmentController } from './recruitment/recruitment.controller';
import { RecruitmentService } from './recruitment/recruitment.service';
import { SchedulerService } from './scheduler.service';
import { CandidateAccessPolicy } from './talent/access.policy';
import { TalentController } from './talent/talent.controller';
import { TalentService } from './talent/talent.service';

const jwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ chars)');
  return s;
};

/** Shared kernel (docs/09-architecture.md §2): available to every context. */
@Global()
@Module({
  imports: [JwtModule.register({ secret: jwtSecret(), signOptions: { algorithm: 'HS256', issuer: 'genzhire' }, verifyOptions: { algorithms: ['HS256'], issuer: 'genzhire' } })],
  providers: [PrismaService, AuditService, SettingsService, NotifyService, AuthGuard],
  exports: [PrismaService, AuditService, SettingsService, NotifyService, AuthGuard, JwtModule],
})
class KernelModule {}

@Module({
  imports: [KernelModule, ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }])],
  controllers: [
    HealthController, AuthController, CandidateController, JobsController, ApplicationsController, TalentController,
    EmployerController, RecruitmentController, AdminController, FilesController, NotificationsController,
  ],
  providers: [
    AuthService, CandidateService, CandidateIndexService, JobsService, ApplicationsService, TalentService,
    CandidateAccessPolicy, EmployerService, RecruitmentService, AdminService, FilesService, SchedulerService,
    // Order matters: authenticate first so the throttler can key limits by user.
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: SerializeInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
