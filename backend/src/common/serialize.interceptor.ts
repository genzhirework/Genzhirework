import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { map } from 'rxjs';

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * API responses are camelCase JSON (docs/07-api-spec.md §1). Database rows are
 * snake_case with BigInt (paise, ids) and Decimal (percentages) — normalise here
 * so no controller can accidentally emit an unserialisable or inconsistent shape.
 */
export function toApi(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(toApi);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const converted = toApi(v);
      if (converted !== undefined) out[camel(k)] = converted;
    }
    return out;
  }
  return value;
}

@Injectable()
export class SerializeInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((v) => (v instanceof StreamableFile ? v : toApi(v))));
  }
}
