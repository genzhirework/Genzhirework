/**
 * DEV ONLY: wipes all transactional data (users other than the seeded admin,
 * candidates, employers, jobs, applications, logs, files) while keeping seed
 * data (roles, permissions, skills, pipeline stages, policies, settings).
 * Refuses to run when NODE_ENV=production.
 *
 *   npx tsx prisma/reset-data.ts --yes
 */
import { PrismaClient } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

try {
  process.loadEnvFile();
} catch {
  /* env provided externally */
}

if (process.env.NODE_ENV === 'production' || !process.argv.includes('--yes')) {
  console.error('Refusing: dev-only, and requires --yes');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const keepAdmin = process.env.ADMIN_EMAIL ?? 'admin@genzhire.work';

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE candidates, employers, files, sessions, login_history, verification_tokens, notifications,
             audit_logs, analytics_events, security_alerts, abuse_reports, recruiters, system_settings_history,
             policy_acceptances, data_subject_requests, mfa_recovery_codes, outbox_events, joining_reminders
    RESTART IDENTITY CASCADE`);
  const r = await prisma.users.deleteMany({ where: { email: { not: keepAdmin } } });
  await rm(resolve(process.env.STORAGE_DIR ?? './storage'), { recursive: true, force: true });
  console.log(`✓ transactional data cleared; removed ${r.count} users; kept ${keepAdmin} and seed data`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
