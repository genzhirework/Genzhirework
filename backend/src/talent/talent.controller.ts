import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sendFile } from '../applications/applications.controller';
import { Audiences, CurrentUser, Meta, Principal, RequestMeta, RequirePermission } from '../common/decorators';
import { CandidateSearchDto, CompareDto, ContactRequestDto, FolderDto, NoteDto, SaveDto } from './talent.dto';
import { TalentService } from './talent.service';

@Controller()
export class TalentController {
  constructor(private readonly svc: TalentService) {}

  @Audiences('employer', 'recruiter', 'admin') @RequirePermission('talent.search')
  @Post('search/candidates') @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
  search(@CurrentUser() p: Principal, @Body() d: CandidateSearchDto) {
    return this.svc.search(p, d);
  }

  @Audiences('employer', 'recruiter', 'admin') @RequirePermission('talent.view')
  @Get('candidates/:id') @Throttle({ default: { limit: 60, ttl: 60_000 } })
  view(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.view(p, id, m);
  }

  @Audiences('employer') @RequirePermission('talent.unlock')
  @Post('candidates/:id/unlock') @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 600_000 } })
  unlock(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta) {
    return this.svc.unlock(p, id, m);
  }

  @Audiences('employer', 'recruiter', 'admin') @RequirePermission('talent.resume.download')
  @Get('candidates/:id/resume') @Throttle({ default: { limit: 20, ttl: 86_400_000 } })
  async resume(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Meta() m: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const { file, bytes } = await this.svc.resume(p, id, m);
    return sendFile(res, file, bytes);
  }

  @Audiences('employer') @RequirePermission('talent.contact')
  @Post('candidates/:id/contact-requests') @Throttle({ default: { limit: 30, ttl: 86_400_000 } })
  contact(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() d: ContactRequestDto, @Meta() m: RequestMeta) {
    return this.svc.requestContact(p, id, d.message, d.jobId, m);
  }

  @Audiences('employer') @RequirePermission('talent.view') @Post('candidates/compare') @HttpCode(200)
  compare(@CurrentUser() p: Principal, @Body() d: CompareDto) {
    return this.svc.compare(p, d.ids);
  }

  // ------------------------------------------------------------ employer lists

  @Audiences('employer') @RequirePermission('employer.usage.read') @Get('employer/entitlements')
  entitlements(@CurrentUser() p: Principal) {
    return this.svc.entitlements(p);
  }

  @Audiences('employer') @RequirePermission('employer.usage.read') @Get('employer/entitlements/summary')
  summary(@CurrentUser() p: Principal) {
    return this.svc.credits(p.employerId!);
  }

  @Audiences('employer') @RequirePermission('employer.usage.read') @Get('employer/entitlements/ledger')
  ledger(@CurrentUser() p: Principal, @Query('cursor') cursor?: string) {
    return this.svc.ledger(p, cursor);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Get('employer/folders')
  folders(@CurrentUser() p: Principal) {
    return this.svc.folders(p);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Post('employer/folders')
  createFolder(@CurrentUser() p: Principal, @Body() d: FolderDto) {
    return this.svc.createFolder(p, d.name);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Delete('employer/folders/:id') @HttpCode(204)
  deleteFolder(@CurrentUser() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteFolder(p, id);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Get('employer/saved-candidates')
  saved(@CurrentUser() p: Principal, @Query('folderId') folderId?: string) {
    return this.svc.saved(p, folderId || undefined);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Post('employer/saved-candidates/:candidateId') @HttpCode(200)
  save(@CurrentUser() p: Principal, @Param('candidateId', ParseUUIDPipe) id: string, @Body() d: SaveDto, @Meta() m: RequestMeta) {
    return this.svc.save(p, id, d.folderId, m);
  }

  @Audiences('employer') @RequirePermission('talent.save') @Delete('employer/saved-candidates/:candidateId') @HttpCode(204)
  unsave(@CurrentUser() p: Principal, @Param('candidateId', ParseUUIDPipe) id: string, @Query('folderId') folderId?: string) {
    return this.svc.unsave(p, id, folderId || undefined);
  }

  @Audiences('employer') @RequirePermission('talent.note') @Post('employer/candidates/:candidateId/notes')
  addNote(@CurrentUser() p: Principal, @Param('candidateId', ParseUUIDPipe) id: string, @Body() d: NoteDto, @Meta() m: RequestMeta) {
    return this.svc.addNote(p, id, d.body, m);
  }

  @Audiences('employer') @RequirePermission('talent.note') @Delete('employer/notes/:noteId') @HttpCode(204)
  deleteNote(@CurrentUser() p: Principal, @Param('noteId', ParseUUIDPipe) id: string) {
    return this.svc.deleteNote(p, id);
  }
}
