import { Injectable, Logger } from '@nestjs/common';
import type { Audience } from './permissions';
import { PrismaService, Tx } from './prisma.service';

export interface NotificationInput {
  userId: string;
  app: Audience;
  type: string;
  title: string;
  body: string;
  link?: string;
  data?: Record<string, unknown>;
}

/**
 * In-app notifications. Email/SMS delivery rows are created by a worker in
 * production; in this build email is logged to the console (no provider yet).
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify');

  constructor(private readonly prisma: PrismaService) {}

  async send(n: NotificationInput, tx?: Tx) {
    const db = tx ?? this.prisma;
    await db.notifications.create({
      data: {
        user_id: n.userId,
        app: n.app.toUpperCase(),
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link ?? null,
        data: (n.data ?? {}) as object,
      },
    });
  }

  /** Notify every active member of an employer account. */
  async toEmployer(employerId: string, n: Omit<NotificationInput, 'userId' | 'app'>, tx?: Tx) {
    const db = tx ?? this.prisma;
    const members = await db.employer_users.findMany({
      where: { employer_id: employerId, status: 'ACTIVE' },
      select: { user_id: true },
    });
    for (const m of members) await this.send({ ...n, userId: m.user_id, app: 'employer' }, tx);
  }

  email(to: string, subject: string, body: string) {
    this.log.log(`[email → ${to}] ${subject}\n${body}`);
  }
}
