// Browser end-to-end test: drives all four UIs through the MVP chain (26 checks) and screenshots each step.
// Usage: ADMIN_PASSWORD=... node ui-e2e.mjs   (API on :3000, apps on :4200-4203 via `ng serve` or serve-dist.mjs)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const SHOTS = fileURLToPath(new URL('./output/screenshots', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const ts = Date.now().toString(36);
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const WEB = 'http://localhost:4200', EMP = 'http://localhost:4201', REC = 'http://localhost:4202', ADM = 'http://localhost:4203';
let pass = 0, fail = 0;
const errors = [];
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${x ? ' — ' + x : ''}`); };

const browser = await chromium.launch();
async function ctx(name, viewport = { width: 1440, height: 900 }) {
  const c = await browser.newContext({ viewport });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|403|404|409|422|428|Failed to load resource/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  p.setDefaultTimeout(20000);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const pdfBytes = async (t) => { const d = await PDFDocument.create(); const pg = d.addPage([400, 300]); pg.drawText(t, { x: 40, y: 250, size: 14, font: await d.embedFont(StandardFonts.Helvetica) }); return Buffer.from(await d.save()); };

try {
  // ------------------------------------------------------------ public web
  console.log('\n# Public site & candidate');
  const w = await ctx('web');
  await w.goto(WEB + '/');
  await w.getByRole('heading', { name: 'Find Your Next Opportunity.' }).waitFor();
  ok(true, 'Homepage renders hero');
  await shot(w, '01-home');
  await w.getByRole('link', { name: 'Create free profile' }).click();
  await w.getByLabel('First name', { exact: true }).fill('Ananya');
  await w.getByLabel('Last name', { exact: true }).fill('Sharma');
  await w.getByLabel('Email', { exact: true }).fill(`ananya.${ts}@ui-test.in`);
  await w.getByLabel('Password', { exact: true }).fill('Fresher!Pass2026');
  await w.getByLabel('I am 18 years or older.', { exact: true }).check();
  await shot(w, '02-register');
  await w.getByRole('button', { name: 'Create profile' }).click();
  await w.waitForURL('**/onboarding');
  ok(true, 'Register → onboarding');
  await w.getByLabel('City', { exact: true }).fill('Bengaluru');
  await w.getByLabel('State', { exact: true }).selectOption('Karnataka');
  await w.getByLabel("Role you're looking for", { exact: true }).fill('Data Analyst');
  await w.getByRole('button', { name: 'Continue' }).click();
  await w.getByRole('heading', { name: 'Your latest education' }).waitFor();
  await w.getByLabel('Degree', { exact: true }).fill('B.Sc');
  await w.getByLabel('Specialization', { exact: true }).fill('Statistics');
  await w.getByLabel('College / institution', { exact: true }).fill('Christ University');
  await w.getByLabel('Graduation year', { exact: true }).fill('2026');
  await w.getByRole('button', { name: 'Continue' }).click();
  await w.getByRole('heading', { name: 'What are you good at?' }).waitFor();
  for (const s of ['Python', 'SQL', 'Excel', 'Power BI', 'Statistics']) {
    await w.locator('gh-skill-picker input').fill(s.slice(0, 4));
    await w.getByRole('option', { name: s, exact: true }).click();
  }
  await shot(w, '03-onboarding-skills');
  await w.getByRole('button', { name: 'Finish' }).click();
  await w.waitForURL('**/app');
  await w.getByRole('heading', { name: /Hi Ananya/ }).waitFor();
  ok(true, 'Onboarding → dashboard');
  await shot(w, '04-candidate-dashboard');

  // profile edits + resume
  await w.goto(WEB + '/app/profile');
  await w.getByRole('heading', { name: 'Ananya Sharma' }).waitFor();
  await w.getByRole('button', { name: 'Edit' }).first().click();
  await w.getByLabel('Mobile number', { exact: true }).fill('+919812300000');
  await w.getByRole('button', { name: 'Save', exact: true }).click();
  await w.getByText('+919812300000').first().waitFor();
  ok(true, 'Profile basic info edited via modal');
  await w.getByRole('button', { name: 'Edit' }).nth(1).click();
  await w.getByLabel('Headline', { exact: true }).fill('Aspiring Data Analyst | Python · SQL · Power BI');
  await w.getByLabel('Summary', { exact: true }).fill('Statistics graduate who loves turning raw data into decisions. Built dashboards in Power BI for a college fest and a sales-forecasting model in Python during my internship.');
  await w.getByRole('button', { name: 'Save', exact: true }).click();
  await w.getByText('Aspiring Data Analyst | Python').first().waitFor();
  await shot(w, '05-candidate-profile');
  await w.goto(WEB + '/app/resume');
  await w.locator('input[type=file]').setInputFiles({ name: 'ananya-resume.pdf', mimeType: 'application/pdf', buffer: await pdfBytes('Ananya Sharma resume') });
  await w.getByText('ananya-resume.pdf').first().waitFor();
  ok(true, 'Resume uploaded through the UI');
  await w.goto(WEB + '/app/profile/preview');
  await w.getByRole('tab', { name: 'Search result' }).waitFor();
  const cardName = await w.locator('gh-candidate-card h3').innerText();
  ok(cardName.trim() === 'Ananya S.', 'Preview as employer shows masked name', cardName);
  await shot(w, '06-preview-as-employer');

  // ------------------------------------------------------------ employer
  console.log('\n# Employer');
  const e = await ctx('employer');
  await e.goto(EMP + '/register');
  await e.getByLabel('First name', { exact: true }).fill('Vikram');
  await e.getByLabel('Last name', { exact: true }).fill('Rao');
  await e.getByLabel('Company name', { exact: true }).fill(`Nimbus Analytics ${ts}`);
  await e.getByLabel('Your designation', { exact: true }).fill('Talent Lead');
  await e.getByLabel('Work email', { exact: true }).fill(`vikram@nimbus-${ts}.in`);
  await e.getByLabel('Password', { exact: true }).fill('Employer!Pass2026');
  await e.getByRole('button', { name: 'Create account' }).click();
  await e.waitForURL('**/company/verification**');
  ok(true, 'Employer registers → verification page');
  await e.getByLabel('Registration number', { exact: true }).fill('29ABCDE1234F1Z5');
  await e.getByLabel('Contact person', { exact: true }).fill('Vikram Rao');
  await e.getByLabel('Contact phone', { exact: true }).fill('+919845012345');
  await shot(e, '07-employer-verification');
  await e.getByRole('button', { name: 'Submit for verification' }).click();
  await e.getByText('Submitted. We usually review').first().waitFor();
  ok(true, 'Verification submitted');

  // ------------------------------------------------------------ admin
  console.log('\n# Admin');
  const a = await ctx('admin');
  await a.goto(ADM + '/login');
  await a.getByLabel('Email', { exact: true }).fill('admin@genzhire.work');
  await a.getByLabel('Password', { exact: true }).fill(ADMIN_PW);
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.getByRole('heading', { name: 'Overview' }).waitFor();
  await a.getByText('Total jobseekers').first().waitFor();
  await shot(a, '08-admin-overview');
  ok(true, 'Admin overview with KPIs + charts');
  await a.goto(ADM + '/verification');
  await a.getByRole('button', { name: new RegExp(`Nimbus Analytics ${ts}`) }).click();
  await a.getByRole('button', { name: 'Approve' }).click();
  await shot(a, '09-admin-approve-dialog');
  await a.getByRole('alertdialog').getByRole('button', { name: 'Approve' }).click();
  await a.getByText('Employer verified — credits granted').first().waitFor();
  ok(true, 'Admin approves verification via UI');

  // employer posts job (auto-publish now verified)
  await e.goto(EMP + '/jobs/new');
  await e.getByLabel('Job title', { exact: true }).fill('Junior Data Analyst');
  await e.getByLabel('About the role', { exact: true }).fill('Work with our analytics team to build dashboards, clean data and present insights to retail and fintech clients across India.');
  await e.getByLabel('Responsibilities', { exact: true }).fill('Build Power BI dashboards\nWrite SQL queries\nPresent weekly insights');
  for (const s of ['Python', 'SQL', 'Power BI']) {
    await e.locator('gh-skill-picker input').fill(s.slice(0, 4));
    await e.getByRole('option', { name: s, exact: true }).click();
  }
  await e.getByLabel('Salary from (LPA)', { exact: true }).fill('4');
  await e.getByLabel('Salary up to (LPA)', { exact: true }).fill('6');
  await e.getByLabel('City 1', { exact: true }).fill('Bengaluru');
  await e.getByLabel('State 1', { exact: true }).selectOption('Karnataka');
  await shot(e, '10-employer-post-job');
  await e.getByRole('button', { name: 'Save & submit' }).click();
  await e.waitForURL('**/jobs');
  await e.getByRole('link', { name: 'Junior Data Analyst' }).waitFor();
  const jobStatus = await e.locator('tr', { hasText: 'Junior Data Analyst' }).locator('gh-status').innerText();
  ok(/Published/.test(jobStatus), 'Verified employer job auto-published', jobStatus);
  await shot(e, '11-employer-jobs');

  // candidate finds + applies
  console.log('\n# Apply');
  await w.goto(WEB + '/jobs?q=Junior%20Data%20Analyst');
  await w.getByRole('link', { name: 'Junior Data Analyst' }).first().click();
  await w.getByRole('button', { name: 'Apply now' }).click();
  await w.getByRole('dialog').getByText('ananya-resume').first().waitFor();
  await shot(w, '12-apply-modal');
  await w.getByRole('button', { name: 'Submit application' }).click();
  await w.getByText('Your application is with').first().waitFor();
  ok(true, 'Candidate applies through modal');
  await w.goto(WEB + '/app/applications');
  await w.getByText('Junior Data Analyst').first().waitFor();
  await shot(w, '13-candidate-applications');

  // employer reviews application on the board
  await e.goto(EMP + '/applications');
  await e.getByRole('link', { name: 'Ananya Sharma' }).click();
  await e.getByRole('button', { name: 'Shortlist' }).waitFor();
  ok(await e.getByText('+919812300000').isVisible(), 'Applicant contact visible to employer (applied)');
  await e.getByRole('button', { name: 'Shortlist' }).click();
  await e.getByText('Moved to Shortlisted').first().waitFor();
  await shot(e, '14-employer-applicant');
  await e.goto(EMP + '/applications');
  const jobLink = e.getByRole('link', { name: 'Junior Data Analyst' }).first();
  await jobLink.click();
  await e.getByText('Drag cards forward').first().waitFor();
  await shot(e, '15-employer-kanban');
  ok(true, 'Kanban board renders');

  // talent search + unlock of a candidate that did not apply
  console.log('\n# Talent database');
  const w2 = await ctx('web2');
  await w2.goto(WEB + '/register');
  await w2.getByLabel('First name', { exact: true }).fill('Karthik');
  await w2.getByLabel('Last name', { exact: true }).fill('Iyer');
  await w2.getByLabel('Email', { exact: true }).fill(`karthik.${ts}@ui-test.in`);
  await w2.getByLabel('Password', { exact: true }).fill('Fresher!Pass2026');
  await w2.getByLabel('I am 18 years or older.', { exact: true }).check();
  await w2.getByRole('button', { name: 'Create profile' }).click();
  await w2.waitForURL('**/onboarding');
  await w2.getByLabel('City', { exact: true }).fill('Bengaluru');
  await w2.getByLabel("Role you're looking for", { exact: true }).fill('Data Analyst');
  await w2.getByRole('button', { name: 'Continue' }).click();
  await w2.getByRole('heading', { name: 'Your latest education' }).waitFor();
  await w2.getByLabel('College / institution', { exact: true }).fill('PES University');
  await w2.getByLabel('Degree', { exact: true }).fill('B.Tech');
  await w2.getByLabel('Graduation year', { exact: true }).fill('2025');
  await w2.getByRole('button', { name: 'Continue' }).click();
  await w2.getByRole('heading', { name: 'What are you good at?' }).waitFor();
  for (const s of ['Python', 'SQL', 'Tableau', 'Excel']) {
    await w2.locator('gh-skill-picker input').fill(s.slice(0, 4));
    await w2.getByRole('option', { name: s, exact: true }).click();
  }
  await w2.getByRole('button', { name: 'Finish' }).click();
  await w2.waitForURL('**/app');
  // headline+summary so completion ≥ 40 (searchable)
  await w2.goto(WEB + '/app/profile');
  await w2.getByRole('button', { name: 'Edit' }).nth(1).click();
  await w2.getByLabel('Headline', { exact: true }).fill('Data Analyst | Python · SQL · Tableau');
  await w2.getByRole('button', { name: 'Save', exact: true }).click();
  await w2.getByText('Profile updated').first().waitFor();
  await w2.getByRole('button', { name: 'Edit' }).first().click();
  await w2.getByLabel('Mobile number', { exact: true }).fill('+919812399999');
  await w2.getByRole('button', { name: 'Save', exact: true }).click();
  await w2.getByText('+919812399999').first().waitFor();
  const pct = await w2.locator('aside h3').first().innerText();
  ok(parseInt(pct) >= 40, 'Second candidate reaches search threshold', pct);

  await e.goto(EMP + '/talent');
  await e.getByPlaceholder(/Role, skill or keyword/).fill('data analyst');
  await e.getByRole('button', { name: 'Search' }).click();
  await e.getByRole('link', { name: 'Karthik I.' }).waitFor();
  const html = await e.content();
  ok(!/karthik\.[a-z0-9]+@ui-test/.test(html), 'Search page contains no candidate email');
  await shot(e, '16-talent-search');
  await e.getByRole('link', { name: 'Karthik I.' }).click();
  await e.getByText('Full profile is locked').first().waitFor();
  await shot(e, '17-candidate-locked');
  await e.getByRole('button', { name: /View full profile · uses 1 credit/ }).click();
  await e.getByRole('alertdialog').getByText('50 left').first().waitFor();
  await e.getByRole('alertdialog').getByRole('button', { name: 'Use 1 credit' }).click();
  await e.getByText(/Profile unlocked · 49 credits left/).first().waitFor();
  ok(true, 'Unlock through UI: 50 → 49 credits');
  await e.getByRole('heading', { name: 'Karthik Iyer' }).waitFor();
  ok(await e.getByText('49 profile views left').isVisible(), 'Top bar credit counter updates to 49 without navigation');
  await shot(e, '18-candidate-unlocked');
  await e.goto(EMP + '/usage');
  await e.getByText('Credit ledger').first().waitFor();
  const ledgerRow = await e.locator('td', { hasText: 'Karthik Iyer' }).first().waitFor().then(() => true).catch(() => false);
  ok(ledgerRow, 'Usage ledger lists the unlock');
  await shot(e, '19-employer-usage');

  // candidate sees who viewed
  await w2.goto(WEB + '/app/settings/privacy');
  await w2.getByText(`Nimbus Analytics ${ts}`).first().waitFor();
  ok(true, '"Who viewed my profile" shows the employer');
  await shot(w2, '20-candidate-privacy');

  // admin access log
  await a.goto(ADM + '/access-logs');
  await a.getByText('Credit used').first().waitFor();
  await shot(a, '21-admin-access-logs');
  await a.goto(ADM + '/audit-logs');
  await a.getByRole('button', { name: 'Verify integrity' }).click();
  await a.getByText(/Hash chain intact/).first().waitFor();
  ok(true, 'Audit chain verifies from the UI');
  await shot(a, '22-admin-audit');

  // recruiter flow: admin creates recruiter, employer requirement, open case
  console.log('\n# Recruitment');
  await e.goto(EMP + '/requirements/new');
  await e.getByLabel('Role', { exact: true }).fill('Graduate Analyst Trainee');
  await e.locator('gh-skill-picker input').fill('SQL');
  await e.getByRole('option', { name: 'SQL', exact: true }).click();
  await e.getByLabel('Locations', { exact: true }).fill('Bengaluru');
  await e.getByLabel('Locations', { exact: true }).press('Enter');
  await e.getByLabel('CTC from (LPA)', { exact: true }).fill('5');
  await e.getByLabel('CTC up to (LPA)', { exact: true }).fill('6');
  await shot(e, '23-employer-requirement');
  await e.getByRole('button', { name: 'Submit requirement' }).click();
  await e.getByText('Candidates submitted by GenZHire').first().waitFor();
  ok(true, 'Employer raises consultant requirement');
  await a.goto(ADM + '/recruiters');
  await a.getByRole('button', { name: 'Add recruiter' }).click();
  await a.getByLabel('Full name', { exact: true }).fill('Meera Recruiter');
  await a.getByLabel('Work email', { exact: true }).fill(`meera.${ts}@genzhire.work`);
  await a.getByRole('button', { name: 'Create account' }).click();
  const tempPw = (await a.locator('code.pw').innerText()).trim();
  ok(tempPw.length > 10, 'Recruiter temp password shown once');
  await a.getByRole('button', { name: 'Done' }).click();
  await a.goto(ADM + '/requirements');
  await a.locator('tr', { hasText: 'Graduate Analyst Trainee' }).getByRole('button', { name: 'Open case' }).click();
  await a.getByLabel(/Meera Recruiter/).check();
  await a.getByRole('dialog').getByRole('button', { name: 'Open case' }).click();
  await a.getByText('Case opened and recruiters notified').first().waitFor();
  ok(true, 'Admin opens case');

  const r = await ctx('recruiter');
  await r.goto(REC + '/login');
  await r.getByLabel('Email', { exact: true }).fill(`meera.${ts}@genzhire.work`);
  await r.getByLabel('Password', { exact: true }).fill(tempPw);
  await r.getByRole('button', { name: 'Sign in' }).click();
  await r.getByText('Open cases').first().waitFor();
  await shot(r, '24-recruiter-dashboard');
  await r.goto(REC + '/requirements');
  await r.getByRole('link', { name: 'Graduate Analyst Trainee' }).click();
  await r.getByRole('button', { name: 'Add candidate' }).click();
  await r.getByLabel('Search candidates', { exact: true }).fill('data analyst');
  await r.getByRole('dialog').getByRole('button', { name: 'Search' }).click();
  await r.getByRole('dialog').locator('gh-candidate-card', { hasText: 'Karthik' }).getByRole('button', { name: 'Add' }).click();
  await r.getByText('added to Sourcing').first().waitFor();
  await r.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await r.getByText('Drag to move between manual stages').first().waitFor();
  await shot(r, '25-recruiter-pipeline');
  ok(true, 'Recruiter sources candidate into pipeline');
  await r.getByRole('link', { name: /Karthik/ }).click();
  await r.getByRole('button', { name: 'Start screening' }).click();
  await r.getByText('Moved to Screening').first().waitFor();
  await r.getByRole('button', { name: 'Submit to employer' }).click();
  await r.getByRole('alertdialog').getByRole('button', { name: 'Submit candidate' }).click();
  await r.getByText('Submitted to employer').first().waitFor();
  await shot(r, '26-recruiter-candidate');
  ok(true, 'Recruiter screens and submits');

  // mobile screenshot of candidate app
  const m = await ctx('mobile', { width: 390, height: 844 });
  await m.goto(WEB + '/jobs');
  await m.getByText(/jobs? found/).first().waitFor();
  await shot(m, '27-mobile-jobs');
} catch (err) {
  fail++;
  console.log('  ✗ FAILED:', err.message.split('\n')[0]);
  for (const ctxt of browser.contexts()) for (const pg of ctxt.pages()) await pg.screenshot({ path: `${SHOTS}/zz-fail-${Date.now()}.png` }).catch(() => {});
}
console.log(`\n${pass} passed, ${fail} failed`);
if (errors.length) console.log('Browser errors:\n  ' + errors.join('\n  '));
writeFileSync(`${SHOTS}/errors.txt`, errors.join('\n'));
await browser.close();
process.exit(fail ? 1 : 0);
