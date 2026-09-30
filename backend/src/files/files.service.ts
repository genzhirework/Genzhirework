import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { badRequest, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

type Purpose = 'RESUME' | 'PROFILE_PHOTO' | 'COMPANY_LOGO' | 'VERIFICATION_DOC' | 'CERTIFICATE';

const RULES: Record<Purpose, { maxBytes: number; types: string[] }> = {
  RESUME: { maxBytes: 5 * 1024 * 1024, types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'] },
  PROFILE_PHOTO: { maxBytes: 2 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  COMPANY_LOGO: { maxBytes: 2 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  VERIFICATION_DOC: { maxBytes: 10 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png'] },
  CERTIFICATE: { maxBytes: 5 * 1024 * 1024, types: ['application/pdf', 'image/jpeg', 'image/png'] },
};

/** Identify type from magic bytes — the client's Content-Type and extension are not trusted. */
function sniff(buf: Buffer, name: string): string | null {
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (head[0] === 0x50 && head[1] === 0x4b && /\.docx$/i.test(name) && buf.includes(Buffer.from('word/'))) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) && /\.doc$/i.test(name)) return 'application/msword';
  return null;
}

/**
 * Storage adapter: local disk under STORAGE_DIR (outside any web root).
 * Production swaps this for Supabase Storage / S3 with quarantine + malware
 * scan (docs/13-security.md §8). Until then scan_status is set after the
 * magic-byte + PDF-safety checks only — no antivirus engine runs here.
 */
@Injectable()
export class FilesService {
  private readonly log = new Logger('Files');
  private readonly root = resolve(process.env.STORAGE_DIR ?? './storage');

  constructor(private readonly prisma: PrismaService) {}

  async store(ownerUserId: string, purpose: Purpose, file: { buffer: Buffer; originalname: string; size: number }) {
    const rule = RULES[purpose];
    if (!rule) throw badRequest('INVALID_PURPOSE', 'Unknown upload purpose');
    if (!file?.buffer?.length) throw badRequest('EMPTY_FILE', 'The file is empty');
    if (file.size > rule.maxBytes) throw badRequest('FILE_TOO_LARGE', `Maximum size is ${rule.maxBytes / 1024 / 1024} MB`);
    const mime = sniff(file.buffer, file.originalname);
    if (!mime || !rule.types.includes(mime)) throw badRequest('FILE_TYPE_NOT_ALLOWED', 'This file type is not allowed');
    if (mime === 'application/pdf') {
      const text = file.buffer.toString('latin1');
      if (/\/JavaScript|\/JS\s|\/Launch|\/EmbeddedFile/.test(text)) throw badRequest('FILE_REJECTED', 'PDFs with scripts or embedded files are not accepted');
      if (/\/Encrypt/.test(text)) throw badRequest('FILE_REJECTED', 'Password-protected PDFs are not accepted');
    }

    const key = `${purpose.toLowerCase()}/${randomBytes(16).toString('hex')}`;
    await mkdir(join(this.root, purpose.toLowerCase()), { recursive: true });
    await writeFile(join(this.root, key), file.buffer);
    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';

    return this.prisma.files.create({
      data: {
        owner_user_id: ownerUserId,
        purpose,
        bucket: 'local',
        storage_key: key,
        original_name: safeName,
        mime_type: mime,
        size_bytes: BigInt(file.size),
        sha256: createHash('sha256').update(file.buffer).digest(),
        scan_status: 'CLEAN',
        scanned_at: new Date(),
      },
      select: { id: true, original_name: true, mime_type: true, size_bytes: true, scan_status: true, created_at: true },
    });
  }

  async read(fileId: string) {
    const f = await this.prisma.files.findUnique({ where: { id: fileId } });
    if (!f || f.deleted_at || f.scan_status !== 'CLEAN') throw notFound('File');
    const bytes = await readFile(join(this.root, f.storage_key));
    return { file: f, bytes };
  }

  /** Stamp every page footer so a leaked resume is traceable (docs/06-business-rules.md §3). */
  async watermarkedResume(fileId: string, stamp: string) {
    const { file, bytes } = await this.read(fileId);
    if (file.mime_type !== 'application/pdf') return { file, bytes };
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (const page of pdf.getPages()) {
        page.drawText(stamp, { x: 24, y: 12, size: 7, font, color: rgb(0.45, 0.45, 0.5), opacity: 0.8 });
      }
      return { file, bytes: Buffer.from(await pdf.save()) };
    } catch (e) {
      this.log.warn(`Watermark failed for ${fileId}: ${(e as Error).message}`);
      return { file, bytes };
    }
  }
}
