/**
 * Idempotent seed: roles/permissions (from the RBAC constant), policy
 * versions, pipeline stages, skill taxonomy and the first admin account.
 * Run: npm run db:seed   (ADMIN_EMAIL overrides the default admin email)
 */
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/common/permissions';

try {
  process.loadEnvFile();
} catch {
  /* env provided externally */
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

const ROLES = [
  { code: 'JOBSEEKER', name: 'Jobseeker', requires_mfa: false },
  { code: 'EMPLOYER', name: 'Employer', requires_mfa: false },
  { code: 'RECRUITER', name: 'Recruiter / HR consultant', requires_mfa: true },
  { code: 'ADMIN', name: 'Administrator', requires_mfa: true },
  { code: 'SUPER_ADMIN', name: 'Super administrator', requires_mfa: true },
  { code: 'MODERATOR', name: 'Moderator', requires_mfa: true },
];

const STAGES: [string, string, string, boolean][] = [
  ['SOURCING', 'Sourcing', 'SOURCING', false],
  ['SCREENING', 'Screening', 'SCREENING', false],
  ['SHORTLISTED', 'Shortlisted', 'SHORTLISTED', false],
  ['SUBMITTED', 'Submitted to employer', 'SUBMITTED', false],
  ['INTERVIEW', 'Interview', 'INTERVIEW', false],
  ['SELECTED', 'Selected', 'SELECTED', false],
  ['OFFER', 'Offer', 'OFFER', false],
  ['JOINED', 'Joined', 'JOINED', false],
  ['TRACKING', '90-day tracking', 'TRACKING', false],
  ['BILLABLE', 'Billable', 'BILLABLE', false],
  ['INVOICED', 'Invoiced', 'INVOICED', false],
  ['PAID', 'Paid', 'PAID', true],
  ['REJECTED', 'Rejected', 'REJECTED', true],
  ['WITHDRAWN', 'Withdrawn', 'WITHDRAWN', true],
  ['DROPPED', 'Dropped', 'DROPPED', true],
];

const SKILLS: Record<string, string[]> = {
  LANGUAGE: ['Python', 'Java', 'JavaScript', 'TypeScript', 'C', 'C++', 'C#', 'Go', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'R', 'SQL', 'Dart', 'Rust', 'Scala', 'Bash'],
  FRAMEWORK: ['Angular', 'React', 'Vue.js', 'Node.js', 'Express.js', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', '.NET', 'Laravel', 'Flutter', 'React Native', 'Next.js', 'Tailwind CSS', 'Bootstrap', 'Hibernate'],
  DATA: ['Excel', 'Advanced Excel', 'Power BI', 'Tableau', 'Pandas', 'NumPy', 'Statistics', 'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Scikit-learn', 'Data Analysis', 'Data Visualization', 'NLP', 'Computer Vision', 'Apache Spark', 'ETL', 'Google Analytics'],
  TOOL: ['Git', 'GitHub', 'Docker', 'Kubernetes', 'Linux', 'AWS', 'Azure', 'Google Cloud', 'Jenkins', 'Jira', 'Postman', 'Figma', 'Selenium', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Firebase', 'HTML', 'CSS', 'REST APIs', 'GraphQL', 'Tally', 'SAP', 'AutoCAD', 'SolidWorks', 'MATLAB', 'Canva', 'Adobe Photoshop', 'WordPress'],
  DOMAIN: ['Manual Testing', 'Automation Testing', 'Cybersecurity', 'Networking', 'DevOps', 'UI/UX Design', 'Digital Marketing', 'SEO', 'Content Writing', 'Accounting', 'GST', 'Financial Analysis', 'Recruitment', 'Sales', 'Business Development', 'Customer Support', 'Operations', 'Supply Chain', 'Embedded Systems', 'IoT', 'VLSI', 'Electrical Design', 'Civil Engineering', 'Mechanical Design', 'Data Entry'],
  SOFT: ['Communication', 'English Proficiency', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Teamwork', 'Problem Solving', 'Leadership', 'Time Management', 'Presentation Skills'],
};

const slug = (s: string) => s.toLowerCase().replace(/\+/g, 'p').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  for (const r of ROLES) {
    await prisma.roles.upsert({ where: { code: r.code }, create: { ...r, is_system: true }, update: { name: r.name, requires_mfa: r.requires_mfa } });
  }
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await prisma.permissions.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.roles.findUniqueOrThrow({ where: { code: roleCode } });
    const ids = await prisma.permissions.findMany({ where: { code: { in: perms } }, select: { id: true } });
    await prisma.role_permissions.deleteMany({ where: { role_id: role.id } });
    await prisma.role_permissions.createMany({ data: ids.map((p) => ({ role_id: role.id, permission_id: p.id })) });
  }
  console.log(`✓ ${ROLES.length} roles, ${Object.keys(PERMISSIONS).length} permissions`);

  for (const type of ['PRIVACY_POLICY', 'TERMS_CANDIDATE', 'TERMS_EMPLOYER', 'RECRUITER_CODE']) {
    await prisma.policy_documents.upsert({
      where: { type_version: { type, version: '2026-09-v1' } },
      create: { type, version: '2026-09-v1', content_url: `/legal/${type.toLowerCase().replace(/_/g, '-')}`, published_at: new Date('2026-09-29') },
      update: {},
    });
  }
  console.log('✓ policy documents');

  for (const [i, [code, label, semantic, terminal]] of STAGES.entries()) {
    await prisma.pipeline_stages.upsert({
      where: { code },
      create: { code, label, semantic, sort_order: (i + 1) * 10, is_terminal: terminal, is_system: true },
      update: {},
    });
  }
  console.log(`✓ ${STAGES.length} pipeline stages`);

  let skills = 0;
  for (const [category, names] of Object.entries(SKILLS)) {
    for (const name of names) {
      await prisma.skills.upsert({ where: { slug: slug(name) }, create: { name, slug: slug(name), category, is_approved: true, aliases: [name.toLowerCase()] }, update: {} });
      skills++;
    }
  }
  const aliases: Record<string, string[]> = { javascript: ['js'], typescript: ['ts'], 'machine-learning': ['ml'], 'c-sharp': [], 'node-js': ['node', 'nodejs'] };
  for (const [s, a] of Object.entries(aliases)) {
    const row = await prisma.skills.findUnique({ where: { slug: s } });
    if (row) await prisma.skills.update({ where: { slug: s }, data: { aliases: [...new Set([...row.aliases, ...a])] } });
  }
  console.log(`✓ ${skills} skills`);

  const email = process.env.ADMIN_EMAIL ?? 'admin@genzhire.work';
  const existing = await prisma.users.findUnique({ where: { email } });
  if (!existing) {
    const password = `${randomBytes(12).toString('base64url')}#9`;
    const adminRole = await prisma.roles.findUniqueOrThrow({ where: { code: 'ADMIN' } });
    const u = await prisma.users.create({
      data: {
        email, full_name: 'GenZHire Admin', status: 'ACTIVE', email_verified_at: new Date(),
        password_hash: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      },
    });
    await prisma.user_roles.create({ data: { user_id: u.id, role_id: adminRole.id } });
    console.log('\n┌──────────────────────────────────────────────────────────────┐');
    console.log('│ Admin account created — this password is shown ONCE.         │');
    console.log(`│ Email:    ${email.padEnd(51)}│`);
    console.log(`│ Password: ${password.padEnd(51)}│`);
    console.log('│ Sign in at http://localhost:4203 and change it in Settings.  │');
    console.log('└──────────────────────────────────────────────────────────────┘\n');
  } else {
    console.log(`✓ admin ${email} already exists`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
