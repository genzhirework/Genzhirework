/**
 * Creates/updates the least-privilege runtime role `genzhire_app`
 * (docs/05-schema.sql "DB ROLES"). Run once per environment, after migrations:
 *
 *   APP_DB_PASSWORD=... npx tsx prisma/setup-app-role.ts
 *
 * Why a dedicated role:
 *  - search_path is pinned on the ROLE, so it applies to every server
 *    connection behind Supabase's transaction pooler (a session-level SET does not);
 *  - append-only tables lose UPDATE/DELETE at the privilege level, on top of the
 *    forbid_mutation() triggers;
 *  - the app never runs as the schema owner / Supabase superuser-ish `postgres`.
 * Migrations keep using DIRECT_URL (owner).
 */
import { PrismaClient } from '@prisma/client';

try {
  process.loadEnvFile();
} catch {
  /* env provided externally */
}

const password = process.env.APP_DB_PASSWORD;
if (!password || password.length < 24) {
  console.error('Set APP_DB_PASSWORD (24+ chars)');
  process.exit(1);
}

const APPEND_ONLY = ['audit_logs', 'candidate_profile_views', 'entitlement_ledger', 'candidate_consents', 'login_history', 'system_settings_history'];

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const exists = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int n FROM pg_roles WHERE rolname = 'genzhire_app'`;
  const quoted = `'${password!.replace(/'/g, "''")}'`;
  if (!exists[0].n) {
    await prisma.$executeRawUnsafe(`CREATE ROLE genzhire_app LOGIN PASSWORD ${quoted} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    console.log('✓ created role genzhire_app');
  } else {
    await prisma.$executeRawUnsafe(`ALTER ROLE genzhire_app WITH LOGIN PASSWORD ${quoted}`);
    console.log('✓ updated role genzhire_app password');
  }
  const stmts = [
    `ALTER ROLE genzhire_app SET search_path = genzhire`,
    `ALTER ROLE genzhire_app SET statement_timeout = '15s'`,
    `GRANT USAGE ON SCHEMA genzhire TO genzhire_app`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA genzhire TO genzhire_app`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA genzhire TO genzhire_app`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA genzhire TO genzhire_app`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA genzhire GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO genzhire_app`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA genzhire GRANT USAGE, SELECT ON SEQUENCES TO genzhire_app`,
    `REVOKE ALL ON genzhire._prisma_migrations FROM genzhire_app`,
  ];
  for (const s of stmts) await prisma.$executeRawUnsafe(s);

  // Append-only: parent tables and every partition.
  const parts = await prisma.$queryRaw<{ t: string }[]>`
    SELECT c.relname AS t FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'genzhire' AND p.relname = ANY(${APPEND_ONLY})`;
  for (const t of [...APPEND_ONLY, ...parts.map((p) => p.t)]) {
    await prisma.$executeRawUnsafe(`REVOKE UPDATE, DELETE, TRUNCATE ON genzhire."${t}" FROM genzhire_app`);
  }
  console.log(`✓ grants applied; UPDATE/DELETE revoked on ${APPEND_ONLY.length} append-only tables + ${parts.length} partitions`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
