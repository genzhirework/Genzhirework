import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Principal, RequestMeta } from './decorators';
import { PrismaService, Tx } from './prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  employerId?: string | null;
  /** IDs and codes only — never contact details, tokens or document contents. */
  metadata?: Record<string, unknown>;
}

/**
 * Append-only, hash-chained audit log (docs/13-security.md §10). Writes join the
 * caller's transaction so the change and its audit row commit together. The
 * chain is serialised with a transaction-scoped advisory lock and ordered by the
 * identity id (assigned under that lock), never by app-server timestamps, which
 * can disagree between instances.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, actor: Principal | null, meta: RequestMeta | null, e: AuditEntry) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('genzhire.audit_chain'))`;
    const prev = await tx.$queryRaw<{ hash: Buffer }[]>`
      SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1`;
    const prevHash = prev[0]?.hash ?? null;
    const createdAt = new Date();
    const canonical = canonicalJson({
      actor: actor?.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      employerId: e.employerId ?? null,
      metadata: e.metadata ?? {},
      createdAt: createdAt.toISOString(),
    });
    const hash = createHash('sha256')
      .update(prevHash ?? Buffer.alloc(0))
      .update(canonical)
      .digest();

    await tx.audit_logs.create({
      data: {
        actor_id: actor?.userId ?? null,
        actor_role: actor?.roles?.[0] ?? (actor ? null : 'SYSTEM'),
        actor_app: actor?.aud ?? null,
        action: e.action,
        entity_type: e.entityType,
        entity_id: e.entityId,
        employer_id: e.employerId ?? null,
        metadata: (e.metadata ?? {}) as object,
        ip_address: meta?.ip ?? null,
        user_agent: meta?.userAgent ?? null,
        request_id: meta?.requestId ?? null,
        prev_hash: prevHash,
        hash,
        created_at: createdAt,
      },
    });
  }

  /** Convenience for audited actions that are not part of a larger transaction. */
  recordStandalone(actor: Principal | null, meta: RequestMeta | null, e: AuditEntry) {
    return this.prisma.tx((tx) => this.record(tx, actor, meta, e));
  }
}

/** Stable JSON: object keys sorted recursively, so jsonb's key reordering can't change the hash. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(value));
}
