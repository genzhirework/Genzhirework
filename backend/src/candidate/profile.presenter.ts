import type { PrismaService, Tx } from '../common/prisma.service';

export type AccessLevel = 'CARD' | 'LOCKED' | 'FULL' | 'CONTACT';

const LPA = (paise?: bigint | null) => (paise ? Number(paise) / 100 / 100000 : null);

/** "3–5 LPA" style band — exact CTC is only shown at FULL (docs/06-business-rules.md §1.2). */
export function ctcBand(min?: bigint | null): string | null {
  const l = LPA(min);
  if (l === null) return null;
  const bands = [[0, 3], [3, 5], [5, 8], [8, 12], [12, 20], [20, 999]];
  const [lo, hi] = bands.find(([a, b]) => l >= a && l < b) ?? [20, 999];
  return hi === 999 ? `${lo}+ LPA` : `${lo}–${hi} LPA`;
}

export async function loadCandidate(db: PrismaService | Tx, candidateId: string) {
  // One SQL statement (LATERAL joins) instead of a query per relation — matters at ~100 ms per round trip.
  return db.candidates.findUnique({
    relationLoadStrategy: 'join',
    where: { id: candidateId },
    include: {
      users: { select: { email_verified_at: true, phone_verified_at: true, status: true } },
      candidate_profiles: true,
      candidate_visibility: true,
      candidate_education: { orderBy: [{ graduation_year: 'desc' }, { sort_order: 'asc' }] },
      candidate_experience: { orderBy: { start_date: 'desc' } },
      candidate_projects: { orderBy: { sort_order: 'asc' } },
      candidate_certifications: { orderBy: { issue_date: 'desc' } },
      candidate_skills: { include: { skills: { select: { id: true, name: true } } }, orderBy: { sort_order: 'asc' } },
      resumes: { where: { deleted_at: null }, include: { files: { select: { id: true, original_name: true, mime_type: true, size_bytes: true } } } },
    },
  });
}

export type LoadedCandidate = NonNullable<Awaited<ReturnType<typeof loadCandidate>>>;

const EDU_RANK: Record<string, number> = {
  DOCTORATE: 7, PG: 6, UG: 5, DIPLOMA: 4, CERTIFICATE_PROGRAM: 3, HIGHER_SECONDARY: 2, SECONDARY: 1,
};

export function highestEducation(c: LoadedCandidate) {
  return [...c.candidate_education].sort(
    (a, b) => (EDU_RANK[b.level] ?? 0) - (EDU_RANK[a.level] ?? 0) || (b.graduation_year ?? 0) - (a.graduation_year ?? 0),
  )[0];
}

/**
 * The ONLY function that shapes candidate data for other parties. Each level is
 * an explicit allow-list — adding a column to the DB never leaks it by default.
 */
export function presentCandidate(c: LoadedCandidate, level: AccessLevel, opts: { nameDisplay?: string } = {}) {
  const p = c.candidate_profiles;
  const edu = highestEducation(c);
  const skills = c.candidate_skills.map((s) => s.skills.name);
  const masked = opts.nameDisplay === 'FULL'
    ? `${c.first_name} ${c.last_name}`
    : opts.nameDisplay === 'INITIALS'
      ? `${c.first_name[0]}. ${c.last_name[0]}.`
      : `${c.first_name} ${c.last_name[0] ?? ''}.`;
  const base = {
    candidateId: c.id,
    displayName: level === 'FULL' || level === 'CONTACT' ? `${c.first_name} ${c.last_name}` : masked,
    initials: `${c.first_name[0] ?? ''}${c.last_name[0] ?? ''}`.toUpperCase(),
    headline: p?.headline ?? null,
    targetRole: p?.target_role ?? null,
    city: c.city,
    state: c.state,
    availability: p?.availability ?? null,
    employmentStatus: p?.employment_status ?? null,
    experienceMonths: p?.total_experience_months ?? 0,
    profileCompletion: p?.profile_completion ?? 0,
    education: edu ? { level: edu.level, degree: edu.degree, specialization: edu.specialization, graduationYear: edu.graduation_year } : null,
    verified: { email: !!c.users.email_verified_at, phone: !!c.users.phone_verified_at },
  };

  if (level === 'CARD') {
    return { ...base, skills: skills.slice(0, 6), expectedCtcBand: ctcBand(p?.expected_ctc_min_paise) };
  }
  if (level === 'LOCKED') {
    return {
      ...base,
      skills,
      expectedCtcBand: ctcBand(p?.expected_ctc_min_paise),
      institution: edu?.institution ?? null,
      sections: {
        summary: !!p?.summary,
        experience: c.candidate_experience.length,
        projects: c.candidate_projects.length,
        certifications: c.candidate_certifications.length,
        resume: c.resumes.some((r) => r.is_primary),
      },
    };
  }

  const full = {
    ...base,
    photoFileId: p?.photo_file_id ?? null,
    currentJobTitle: p?.current_job_title ?? null,
    summary: p?.summary ?? null,
    skills: c.candidate_skills.map((s) => ({ id: s.skills.id, name: s.skills.name, proficiency: s.proficiency })),
    expectedCtc: { minPaise: p?.expected_ctc_min_paise ?? null, maxPaise: p?.expected_ctc_max_paise ?? null },
    preferences: {
      workModes: p?.preferred_work_modes ?? [],
      cities: p?.preferred_cities ?? [],
      employmentTypes: p?.preferred_employment_types ?? [],
    },
    links: p?.links ?? [],
    educationHistory: c.candidate_education.map((e) => ({
      id: e.id, level: e.level, degree: e.degree, specialization: e.specialization, institution: e.institution,
      universityBoard: e.university_board, startYear: e.start_year, graduationYear: e.graduation_year,
      isPursuing: e.is_pursuing, scoreType: e.score_type, score: e.score,
    })),
    experience: c.candidate_experience.map((x) => ({
      id: x.id, companyName: x.company_name, title: x.title, employmentType: x.employment_type, location: x.location,
      startDate: x.start_date, endDate: x.end_date, isCurrent: x.is_current, description: x.description,
    })),
    projects: c.candidate_projects.map((x) => ({
      id: x.id, title: x.title, description: x.description, role: x.role, projectUrl: x.project_url, repoUrl: x.repo_url,
    })),
    certifications: c.candidate_certifications.map((x) => ({
      id: x.id, name: x.name, issuer: x.issuer, issueDate: x.issue_date, credentialUrl: x.credential_url,
    })),
    hasResume: c.resumes.some((r) => r.is_primary),
  };
  if (level === 'FULL') return full;
  return { ...full, contact: { email: c.contact_email, phone: c.contact_phone_e164 } };
}
