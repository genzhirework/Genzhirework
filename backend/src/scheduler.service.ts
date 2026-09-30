import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { RecruitmentService } from './recruitment/recruitment.service';

/**
 * In-process scheduler for the MVP. Production moves these jobs to the worker
 * (BullMQ repeatable jobs with a Redis lock — docs/09-architecture.md §3); a
 * Postgres advisory lock keeps them single-run if several API instances start.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Scheduler');
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly recruitment: RecruitmentService) {}

  onApplicationBootstrap() {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    setTimeout(() => this.tick(), 15_000);
    this.timer = setInterval(() => this.tick(), 60 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const got = await this.prisma.tx(async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('genzhire.scheduler')) AS locked`;
        if (!locked) return false;
        const closed = await tx.$executeRaw`
          UPDATE jobs SET status = 'CLOSED', closed_at = now(), updated_at = now()
          WHERE status IN ('PUBLISHED','PAUSED') AND application_deadline < (now() AT TIME ZONE 'Asia/Kolkata')::date`;
        const expired = await tx.$executeRaw`
          UPDATE contact_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now()`;
        if (closed || expired) this.log.log(`Closed ${closed} expired jobs, expired ${expired} contact requests`);
        return true;
      });
      if (!got) return;
      const reminders = await this.recruitment.runReminders();
      const billable = await this.recruitment.runBillingTrigger();
      if (reminders || billable) this.log.log(`Sent ${reminders} tracking reminders, ${billable} placements became billable`);
    } catch (e) {
      this.log.error(`Scheduler tick failed: ${(e as Error).message}`);
    }
  }
}
