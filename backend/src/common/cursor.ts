import { createHmac, timingSafeEqual } from 'node:crypto';
import { badRequest } from './errors';

/**
 * Opaque, HMAC-signed pagination cursors (docs/13-security.md §7). Signing binds
 * a cursor to the user + query, so scrapers cannot forge offsets or replay a
 * cursor with different filters.
 */
const secret = () => process.env.CURSOR_SECRET ?? 'dev-cursor-secret';

export function encodeCursor(payload: Record<string, unknown>, binding: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(`${body}.${binding}`).digest('base64url').slice(0, 22);
  return `${body}.${sig}`;
}

export function decodeCursor<T>(cursor: string | undefined | null, binding: string): T | null {
  if (!cursor) return null;
  const [body, sig] = cursor.split('.');
  if (!body || !sig) throw badRequest('INVALID_CURSOR', 'Invalid pagination cursor');
  const expected = createHmac('sha256', secret()).update(`${body}.${binding}`).digest('base64url').slice(0, 22);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw badRequest('INVALID_CURSOR', 'Invalid pagination cursor');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
}

export const clampLimit = (limit: unknown, def = 20, max = 50) => {
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : def;
};
