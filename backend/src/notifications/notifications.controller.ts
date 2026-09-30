import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Authenticated, CurrentUser, Principal } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Authenticated() @Get()
  list(@CurrentUser() p: Principal, @Query('unread') unread?: string) {
    return this.prisma.notifications.findMany({
      where: { user_id: p.userId, app: p.aud.toUpperCase(), ...(unread === 'true' && { read_at: null }) },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: { id: true, type: true, title: true, body: true, link: true, read_at: true, created_at: true },
    });
  }

  @Authenticated() @Get('unread-count')
  async count(@CurrentUser() p: Principal) {
    const n = await this.prisma.notifications.count({ where: { user_id: p.userId, app: p.aud.toUpperCase(), read_at: null } });
    return { count: n };
  }

  @Authenticated() @Post(':id/read') @HttpCode(204)
  async read(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notifications.updateMany({ where: { id, user_id: p.userId, read_at: null }, data: { read_at: new Date() } });
  }

  @Authenticated() @Post('read-all') @HttpCode(204)
  async readAll(@CurrentUser() p: Principal) {
    await this.prisma.notifications.updateMany({ where: { user_id: p.userId, app: p.aud.toUpperCase(), read_at: null }, data: { read_at: new Date() } });
  }
}
