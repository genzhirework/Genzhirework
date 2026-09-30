// API end-to-end test of the MVP chain (74 checks) against a running API.
// Usage: ADMIN_PASSWORD=... node api-e2e.mjs   (API on http://localhost:3000)
// Creates test data — run `npm run db:reset-dev` in backend/ afterwards on dev databases.
import { PDFDocument, StandardFonts } from 'pdf-lib';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN = { email: 'admin@genzhire.work', password: process.env.ADMIN_PASSWORD };
const ts = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`); };

class Client {
  constructor(app) { this.app = app; this.token = null; this.cookie = null; }
  async req(method, path, body, { csrf = true, raw = false } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (csrf) headers['X-Requested-With'] = 'genzhire';
    if (this.cookie) headers.Cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(API + path, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc && sc.includes(`gh_rt_${this.app}=`)) this.cookie = sc.split(';')[0];
    if (raw) return r;
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  }
  get = (p) => this.req('GET', p);
  post = (p, b = {}) => this.req('POST', p, b);
  patch = (p, b) => this.req('PATCH', p, b);
  put = (p, b) => this.req('PUT', p, b);
  async login(email, password) {
    const r = await this.post(`/auth/${this.app}/login`, { email, password });
    this.token = r.data?.accessToken;
    return r;
  }
}

async function pdf(text) {
  const d = await PDFDocument.create();
  const p = d.addPage([400, 300]);
  p.drawText(text, { x: 40, y: 250, size: 14, font: await d.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await d.save());
}

async function makeCandidate(first, skillNames, skills) {
  const c = new Client('jobseeker');
  const email = `${first.toLowerCase()}.${ts}@e2e-mail.in`;
  const reg = await c.post('/auth/register/candidate', { email, password: 'Fresher!Pass2026', firstName: first, lastName: 'Kumar', ageConfirmed: true, discoverable: true });
  const login = await c.login(email, 'Fresher!Pass2026');
  await c.patch('/candidate/profile', {
    city: 'Chennai', state: 'Tamil Nadu', phone: '+919876543210', headline: 'Aspiring Data Analyst | Python · SQL',
    targetRole: 'Data Analyst', summary: 'Final-year B.Tech IT student who enjoys turning messy data into clear dashboards. Built three analytics projects using Python, SQL and Power BI, including a sales forecasting model.',
    employmentStatus: 'FRESHER', availability: 'IMMEDIATE', preferredWorkModes: ['ONSITE', 'HYBRID'], preferredCities: ['Chennai', 'Bengaluru'], expectedCtcMinPaise: 40000000,
  });
  await c.post('/candidate/education', { level: 'UG', degree: 'B.Tech', specialization: 'Information Technology', institution: 'Anna University', graduationYear: 2026, scoreType: 'CGPA_10', score: 8.4 });
  await c.put('/candidate/skills', { skills: skillNames.map((n) => ({ skillId: skills[n] })) });
  await c.post('/candidate/projects', { title: 'Sales forecasting dashboard', description: 'Power BI dashboard over 2 years of retail data.' });
  const fd = new FormData();
  fd.append('purpose', 'RESUME');
  fd.append('file', new Blob([await pdf(`${first} Kumar — Resume`)], { type: 'application/pdf' }), `${first}-resume.pdf`);
  const up = await c.req('POST', '/files', fd);
  const resume = await c.post('/candidate/resumes', { fileId: up.data.id });
  const onboard = await c.post('/candidate/onboarding/complete');
  return { c, email, reg, login, up, resume, onboard };
}

(async () => {
  console.log('\n# Health & baseline security');
  const h = await fetch(API + '/health').then((r) => r.json());
  ok(h.status === 'ok', 'API healthy and connected to Supabase');
  const anon = new Client('jobseeker');
  ok((await anon.req('POST', '/auth/jobseeker/login', { email: 'x@y.z', password: 'x' }, { csrf: false })).status === 403, 'POST without X-Requested-With rejected (CSRF check)');
  ok((await anon.get('/candidate/profile')).status === 401, 'Protected route without token → 401');

  const skillList = (await anon.get('/meta/skills')).data;
  const skills = Object.fromEntries(skillList.map((s) => [s.name, s.id]));
  const search = await anon.get('/meta/skills?q=pyth');
  ok(search.data.some((s) => s.name === 'Python'), 'Skill typeahead works');

  console.log('\n# Candidate registration & profile');
  const A = await makeCandidate('Rahul', ['Python', 'SQL', 'Excel', 'Power BI', 'Pandas', 'Statistics'], skills);
  ok(A.reg.status === 201 && A.login.status === 200, 'Candidate registers and logs in', `status ${A.reg.status}/${A.login.status}`);
  ok(A.up.status === 201 && A.up.data.mimeType === 'application/pdf', 'Resume upload sniffed as PDF');
  ok(A.onboard.status === 200, 'Onboarding completed', JSON.stringify(A.onboard.data?.code ?? ''));
  const prof = await A.c.get('/candidate/profile');
  ok(prof.data.completion.percent >= 80, `Profile completion computed`, `${prof.data.completion.percent}%`);
  const dup = await anon.post('/auth/register/candidate', { email: A.email, password: 'Another!Pass2026', firstName: 'X', lastName: 'Y', ageConfirmed: true, discoverable: true });
  ok(dup.status === 201, 'Duplicate registration returns same response (no email enumeration)');
  const badFile = new FormData();
  badFile.append('purpose', 'RESUME');
  badFile.append('file', new Blob([Buffer.from('MZ fake exe')], { type: 'application/pdf' }), 'evil.pdf');
  ok((await A.c.req('POST', '/files', badFile)).status === 400, 'Renamed non-PDF rejected by magic-byte sniff');

  const B = await makeCandidate('Priya', ['Python', 'SQL', 'Tableau', 'Excel', 'Machine Learning'], skills);
  const C = await makeCandidate('Arjun', ['Java', 'Spring Boot', 'SQL', 'Git', 'REST APIs'], skills);
  ok(B.onboard.status === 200 && C.onboard.status === 200, 'Two more candidates onboarded');

  console.log('\n# Employer registration, job & verification');
  const E = new Client('employer');
  const empEmail = `hr@abc-tech-${ts}.in`;
  ok((await E.post('/auth/register/employer', { email: empEmail, password: 'Employer!Pass2026', firstName: 'Meena', lastName: 'Iyer', companyName: `ABC Technologies ${ts}`, designation: 'HR Manager' })).status === 201, 'Employer registers');
  ok((await E.login(empEmail, 'Employer!Pass2026')).status === 200, 'Employer logs in');
  ok((await A.c.get('/employer/dashboard')).status === 403, 'Jobseeker token rejected on employer API (audience check)');
  const jobBody = {
    title: 'Junior Data Analyst', department: 'Analytics',
    description: 'Join our analytics team to build dashboards and analyse customer data for our retail clients across India.',
    responsibilities: 'Build Power BI dashboards\nWrite SQL queries', requirements: 'B.Tech/B.Sc 2025–2026 batch',
    experienceMinMonths: 0, experienceMaxMonths: 12, salaryMinPaise: 35000000, salaryMaxPaise: 50000000, workMode: 'HYBRID',
    employmentType: 'FULL_TIME', openings: 3, locations: [{ city: 'Chennai', state: 'Tamil Nadu' }], skillIds: [skills.Python, skills.SQL, skills['Power BI']],
  };
  const job = await E.post('/employer/jobs', jobBody);
  ok(job.status === 201 && job.data.status === 'DRAFT', 'Job created as DRAFT');
  const submitted = await E.post(`/employer/jobs/${job.data.id}/submit`);
  ok(submitted.data.status === 'PENDING_APPROVAL', 'Unverified employer job goes to moderation', submitted.data.status);
  const lockedTry = await E.post(`/candidates/${B.resume.data.candidateId ?? (await B.c.get('/candidate/profile')).data.id}/unlock`);
  ok(lockedTry.status === 403, 'Unverified employer cannot unlock profiles', `${lockedTry.status} ${lockedTry.data?.code}`);
  const ver = await E.post('/employer/verification', { website: `https://abc-tech-${ts}.in`, registrationType: 'GSTIN', registrationNumber: '33ABCDE1234F1Z5', contactName: 'Meena Iyer', contactPhone: '+919812345678' });
  ok(ver.status === 201, 'Verification submitted', ver.data?.code);
  const badGst = await E.post('/employer/verification', { registrationType: 'GSTIN', registrationNumber: 'NOTAGSTIN', contactName: 'M', contactPhone: '+919812345678' });
  ok([400, 409, 422].includes(badGst.status), 'Second/invalid verification refused', `${badGst.status} ${badGst.data?.code}`);

  console.log('\n# Admin: verification (grants 50 credits) & moderation');
  const AD = new Client('admin');
  const al = await AD.login(ADMIN.email, ADMIN.password);
  ok(al.status === 200, 'Admin logs in');
  ok((await E.get('/admin/metrics')).status === 403, 'Employer token rejected on admin API');
  const approve = await AD.post(`/admin/verifications/${ver.data.id}/approve`, {});
  ok(approve.data?.status === 'APPROVED', 'Admin approves verification');
  const credits = await E.get('/employer/entitlements/summary');
  ok(credits.data.remaining === 50, 'Employer receives 50 free profile-view credits', JSON.stringify(credits.data));
  const approveAgain = await AD.post(`/admin/verifications/${ver.data.id}/approve`, {});
  ok(approveAgain.status === 409, 'Re-approval refused (free grant only once)');
  const mod = await AD.post(`/admin/jobs/${job.data.id}/approve`, {});
  ok(mod.data?.status === 'PUBLISHED', 'Admin publishes the job');

  console.log('\n# Candidate job search & apply');
  const js = await anon.get('/jobs?q=data%20analyst&city=Chennai');
  ok(js.data.data.some((j) => j.id === job.data.id), 'Published job found in public search', `total ${js.data.totalEstimate}`);
  const jd = await A.c.get(`/jobs/${job.data.id}`);
  ok(jd.data.company.verified === true && jd.data.viewerState?.applied === false, 'Job details show verified badge + viewer state');
  const apply = await A.c.post(`/candidate/jobs/${job.data.id}/apply`, { resumeId: A.resume.data.id, coverNote: 'Excited about analytics.' });
  ok(apply.status === 201, 'Candidate applies', apply.data?.code);
  ok((await A.c.post(`/candidate/jobs/${job.data.id}/apply`, { resumeId: A.resume.data.id })).status === 409, 'Second application blocked');

  console.log('\n# Employer application management');
  const apps = await E.get(`/employer/applications?jobId=${job.data.id}`);
  ok(apps.data.length === 1, 'Employer sees 1 applicant');
  const appView = await E.get(`/employer/applications/${apply.data.id}`);
  ok(appView.data.status === 'VIEWED' && appView.data.candidate.contact?.email, 'Opening marks VIEWED; applicant contact shared via application');
  ok((await E.post(`/employer/applications/${apply.data.id}/status`, { toStatus: 'SHORTLISTED' })).data.status === 'SHORTLISTED', 'Move to Shortlisted');
  ok((await E.post(`/employer/applications/${apply.data.id}/status`, { toStatus: 'REJECTED' })).status === 428, 'Reject without confirmation → 428');
  ok((await E.post(`/employer/applications/${apply.data.id}/status`, { toStatus: 'APPLIED' })).status === 400, 'Invalid target status rejected');
  const timeline = await A.c.get(`/candidate/applications/${apply.data.id}`);
  ok(timeline.data.statusLabel === 'Shortlisted', 'Candidate sees Shortlisted', timeline.data.timeline.map((t) => t.label).join(' → '));
  const r = await E.req('GET', `/employer/applications/${apply.data.id}/resume`, undefined, { raw: true });
  const bytes = Buffer.from(await r.arrayBuffer());
  ok(r.status === 200 && bytes.subarray(0, 5).toString() === '%PDF-', 'Resume download is a PDF (watermarked)');

  console.log('\n# Talent search & credit consumption');
  const bId = (await B.c.get('/candidate/profile')).data.id;
  const cId = (await C.c.get('/candidate/profile')).data.id;
  const ts1 = await E.post('/search/candidates', { q: 'data analyst', skillsAll: [skills.Python, skills.SQL], cities: ['Chennai'] });
  ok(ts1.status === 200 && ts1.data.data.some((x) => x.candidateId === bId), 'Search finds candidate B', `total ${ts1.data.totalEstimate}`);
  const card = ts1.data.data.find((x) => x.candidateId === bId);
  const leaks = JSON.stringify(ts1.data).match(/@e2e-mail|\+91987|contact/);
  ok(!leaks && /^Priya K\.$/.test(card.displayName), 'Cards masked ("Priya K."), no email/phone in search payload', card.displayName);
  const locked = await E.get(`/candidates/${bId}`);
  ok(locked.data.access.level === 'LOCKED' && !locked.data.profile.summary && !locked.data.profile.contact, 'GET is side-effect free: LOCKED preview without summary/contact');
  ok((await E.get('/employer/entitlements/summary')).data.remaining === 50, 'Viewing locked preview used no credit');
  const u1 = await E.post(`/candidates/${bId}/unlock`);
  ok(u1.data.access.level === 'FULL' && u1.data.access.creditsRemaining === 49, 'Unlock → FULL profile, 49 credits left', JSON.stringify(u1.data.access));
  const u2 = await E.post(`/candidates/${bId}/unlock`);
  ok(u2.data.access.basis === 'ACTIVE_UNLOCK' && (await E.get('/employer/entitlements/summary')).data.remaining === 49, 'Repeat unlock is free (ACTIVE_UNLOCK)');
  ok(!u1.data.profile.contact, 'Unlock does not reveal contact (candidate approval required)');
  const par = await Promise.all(Array.from({ length: 6 }, () => E.post(`/candidates/${cId}/unlock`)));
  const after = (await E.get('/employer/entitlements/summary')).data.remaining;
  ok(par.every((x) => x.status === 200) && after === 48, '6 concurrent unlocks of one candidate charge exactly 1 credit', `remaining ${after}`);
  const ledger = await E.get('/employer/entitlements/ledger');
  const consumes = ledger.data.data.filter((l) => l.reason === 'CONSUME').length;
  ok(consumes === 2, 'Ledger shows exactly 2 CONSUME rows');

  console.log('\n# Contact request (candidate approval)');
  const cr = await E.post(`/candidates/${bId}/contact-requests`, { message: 'Hi Priya, we would love to discuss our Junior Data Analyst role in Chennai.', jobId: job.data.id });
  ok(cr.status === 201, 'Employer sends contact request');
  const inbox = await B.c.get('/candidate/contact-requests');
  ok(inbox.data[0]?.status === 'PENDING', 'Candidate sees pending request');
  await B.c.post(`/candidate/contact-requests/${inbox.data[0].id}/accept`);
  const withContact = await E.get(`/candidates/${bId}`);
  ok(withContact.data.profile.contact?.email?.includes('priya'), 'After acceptance, contact details visible');
  const whoViewed = await B.c.get('/candidate/profile-access');
  ok(whoViewed.data.some((v) => v.company.startsWith('ABC Technologies')), '"Who viewed me" lists the company');

  console.log('\n# Tenant isolation');
  const E2 = new Client('employer');
  const e2mail = `hr@other-co-${ts}.in`;
  await E2.post('/auth/register/employer', { email: e2mail, password: 'Employer!Pass2026', firstName: 'Ravi', lastName: 'S', companyName: `Other Co ${ts}` });
  await E2.login(e2mail, 'Employer!Pass2026');
  ok((await E2.get(`/employer/applications/${apply.data.id}`)).status === 404, "Employer B cannot read employer A's application (404)");
  ok((await E2.get(`/employer/jobs/${job.data.id}`)).status === 404, "Employer B cannot read employer A's job");
  await B.c.post('/candidate/blocked-employers', { employerId: (await E.get('/employer/company')).data.employerId });
  ok((await E.get(`/candidates/${bId}`)).status === 404, 'Candidate blocks employer → profile becomes 404 for them');

  console.log('\n# Recruitment: requirement → case → pipeline → joining → 90-day billing');
  const req = await E.post('/employer/hiring-requirements', {
    roleTitle: 'Graduate Engineer Trainee', openings: 2, skillIds: [skills.Java, skills.SQL], experienceMinMonths: 0,
    locations: ['Chennai'], workMode: 'ONSITE', ctcMinPaise: 50000000, ctcMaxPaise: 60000000, joiningTimeline: 'WITHIN_30_DAYS', fulfilmentMode: 'CONSULTANT',
  });
  ok(req.status === 201 && req.data.status === 'SUBMITTED', 'Employer raises consultant requirement');
  const rec = await AD.post('/admin/recruiters', { email: `recruiter.${ts}@genzhire.work`, fullName: 'Kavya Recruiter', designation: 'HR Consultant' });
  ok(rec.status === 201 && rec.data.temporaryPassword, 'Admin creates recruiter account');
  const oc = await AD.post(`/admin/hiring-requirements/${req.data.id}/open-case`, { recruiterIds: [rec.data.recruiterId] });
  ok(oc.status === 201, 'Admin opens case with default agreement (8.33%, 90 days)', oc.data?.code);
  const R = new Client('recruiter');
  ok((await R.login(rec.data.email, rec.data.temporaryPassword)).status === 200, 'Recruiter logs in');
  const cases = await R.get('/recruitment/cases');
  ok(cases.data.length === 1 && Number(cases.data[0].feePercentage) === 8.33, 'Recruiter sees assigned case at 8.33%');
  const caseId = oc.data.caseId;
  const add = await R.post(`/recruitment/cases/${caseId}/candidates`, { candidateId: cId, source: 'DATABASE', notes: 'Strong Java basics' });
  ok(add.status === 201, 'Recruiter adds candidate C to pipeline');
  const stages = Object.fromEntries((await R.get('/recruitment/stages')).data.map((s) => [s.code, s.id]));
  ok((await R.post(`/recruitment/pipeline/${add.data.id}/move`, { toStageId: stages.JOINED })).status === 409, 'Cannot jump to JOINED manually (system stage)');
  await R.post(`/recruitment/pipeline/${add.data.id}/move`, { toStageId: stages.SCREENING });
  await R.post(`/recruitment/pipeline/${add.data.id}/move`, { toStageId: stages.SHORTLISTED });
  ok((await R.post(`/recruitment/pipeline/${add.data.id}/submit`)).status === 200, 'Submitted to employer');
  const reqView = await E.get(`/employer/hiring-requirements/${req.data.id}`);
  ok(reqView.data.submissions.length === 1, 'Employer sees the submission');
  ok((await E.get(`/candidates/${cId}`)).data.access.basis !== undefined, 'Employer can open submitted candidate');
  await E.post(`/employer/recruitment/submissions/${add.data.id}/decision`, { decision: 'ACCEPTED', feedback: 'Please schedule' });
  const iv = await R.post(`/recruitment/pipeline/${add.data.id}/interviews`, { roundName: 'Technical', mode: 'VIDEO', scheduledStart: new Date(Date.now() + 86400000).toISOString(), scheduledEnd: new Date(Date.now() + 90000000).toISOString(), locationOrLink: 'https://meet.example.com/x' });
  ok(iv.status === 201, 'Interview scheduled');
  await R.patch(`/recruitment/interviews/${iv.data.id}`, { status: 'COMPLETED', outcome: 'PASSED' });
  ok((await R.post(`/recruitment/pipeline/${add.data.id}/move`, { toStageId: stages.SELECTED })).status === 200, 'Moved to Selected');
  const offer = await R.post(`/recruitment/pipeline/${add.data.id}/offer`, { designation: 'GET', annualCtcPaise: 60000000, offerDate: '2026-09-29', expectedJoiningDate: '2026-10-01' });
  await R.patch(`/recruitment/offers/${offer.data.id}`, { status: 'ACCEPTED' });
  const joining = await R.post(`/recruitment/pipeline/${add.data.id}/joining`, { joiningDate: '2026-10-01' });
  ok(joining.status === 201, 'Recruiter records joining 2026-10-01');
  const reqView2 = await E.get(`/employer/hiring-requirements/${req.data.id}`);
  const jId = reqView2.data.submissions[0].joiningId;
  await E.post(`/employer/recruitment/joinings/${jId}/confirm`);
  const tracking = await R.get('/recruitment/tracking');
  const t = tracking.data.find((x) => x.id === jId);
  ok(t?.trackingStatus === 'TRACKING', 'Both sides confirmed → 90-day tracking');
  ok(t?.billingDueDate?.startsWith('2026-12-30'), 'billing_due_date = joining + 90 days', t?.billingDueDate);
  ok(Number(t?.feeAmountPaise) === 4998000, 'Consultant fee = ₹6,00,000 × 8.33% = ₹49,980', `${Number(t?.feeAmountPaise) / 100}`);
  ok(t?.reminders?.length === 5, 'Reminders scheduled at 30/60/75/85/90', t?.reminders?.map((x) => x.dayOffset).join('/'));

  console.log('\n# Sessions & audit');
  const oldCookie = E.cookie;
  const ref = await E.post('/auth/employer/refresh');
  ok(ref.status === 200 && E.cookie !== oldCookie, 'Refresh rotates the refresh token');
  const thief = new Client('employer'); thief.cookie = oldCookie;
  ok((await thief.post('/auth/employer/refresh')).status === 401, 'Reusing the old refresh token → 401');
  E.token = ref.data.accessToken;
  await new Promise((res) => setTimeout(res, 31000));
  ok((await E.get('/employer/dashboard')).status === 401, 'Token reuse revoked the whole session (theft detection)');
  const chain = await AD.get('/admin/audit-logs/verify');
  ok(chain.data.ok === true, 'Audit hash chain verifies', `${chain.data.checked} rows`);
  const logs = await AD.get(`/admin/access-logs?employerId=${(await AD.get('/admin/employers?q=ABC%20Technologies%20' + ts)).data.data[0].id}`);
  ok(logs.data.data.some((l) => l.accessBasis === 'CREDIT' && l.creditsConsumed === 1), 'Admin access log shows credit-consuming view');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
