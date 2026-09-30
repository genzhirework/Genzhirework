import type { Tx } from './prisma.service';

export interface GrantInput {
  employerId: string;
  quantity: number;
  validDays: number;
  source: 'FREE_ON_VERIFICATION' | 'ADMIN_GRANT' | 'SUBSCRIPTION' | 'PROMOTION';
  grantedBy: string;
  referenceType: string;
  referenceId?: string | null;
  note: string;
}

/**
 * Creates a credit bucket + its GRANT ledger row. Validity timestamps come from
 * the DATABASE clock: the unlock query compares against the database's now(),
 * so an app server whose clock runs ahead would otherwise create buckets that
 * are "not yet valid" for the size of the skew (observed: 32 s in development).
 */
export async function grantEntitlement(tx: Tx, g: GrantInput) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO employer_entitlements (employer_id, entitlement_type, source, total_quantity, valid_from, valid_until, granted_by)
    VALUES (${g.employerId}::uuid, 'CANDIDATE_PROFILE_VIEW', ${g.source}, ${g.quantity}::int, now(),
            now() + make_interval(days => ${g.validDays}::int), ${g.grantedBy}::uuid)
    RETURNING id`;
  await tx.entitlement_ledger.create({
    data: {
      entitlement_id: row.id, employer_id: g.employerId, delta: g.quantity, reason: 'GRANT',
      reference_type: g.referenceType, reference_id: g.referenceId ?? null, actor_user_id: g.grantedBy, note: g.note,
    },
  });
  return row;
}
