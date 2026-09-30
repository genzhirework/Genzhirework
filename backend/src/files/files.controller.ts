import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { sendFile } from '../applications/applications.controller';
import { Authenticated, CurrentUser, Principal, Public } from '../common/decorators';
import { badRequest, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { FilesService } from './files.service';

class UploadDto {
  @IsIn(['RESUME', 'PROFILE_PHOTO', 'COMPANY_LOGO', 'VERIFICATION_DOC', 'CERTIFICATE']) purpose: string;
}

const PURPOSE_AUDIENCE: Record<string, string[]> = {
  RESUME: ['jobseeker'], PROFILE_PHOTO: ['jobseeker'], CERTIFICATE: ['jobseeker'],
  COMPANY_LOGO: ['employer'], VERIFICATION_DOC: ['employer'],
};

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService, private readonly prisma: PrismaService) {}

  @Authenticated() @Post() @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  upload(@CurrentUser() p: Principal, @UploadedFile() file: Express.Multer.File, @Body() d: UploadDto) {
    if (!file) throw badRequest('FILE_REQUIRED', 'Choose a file to upload');
    if (!PURPOSE_AUDIENCE[d.purpose]?.includes(p.aud)) throw badRequest('INVALID_PURPOSE', 'This upload is not available in this app');
    return this.files.store(p.userId, d.purpose as 'RESUME', file);
  }

  /** Owners can re-download their own uploads (e.g. candidate previewing their resume). */
  @Authenticated() @Get(':id/download')
  async own(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.prisma.files.findUnique({ where: { id } });
    if (!f || f.owner_user_id !== p.userId) throw notFound('File');
    const { file, bytes } = await this.files.read(id);
    return sendFile(res, file, bytes);
  }

  /** Company logos are public brand assets (shown on job cards). */
  @Public() @Get(':id/logo')
  async logo(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.prisma.files.findUnique({ where: { id } });
    if (!f || f.purpose !== 'COMPANY_LOGO') throw notFound('File');
    const { file, bytes } = await this.files.read(id);
    res.set({ 'Content-Type': file.mime_type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(bytes);
  }
}
