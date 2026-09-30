import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from '../common/prisma.service';
import { LoadedCandidate, loadCandidate } from './profile.presenter';

/** Weighted completion (docs/06-business-rules.md §9). */
const WEIGHTS = { basics: 15, headline: 10, education: 20, skills: 15, resume: 15, summary: 5, work: 10, certs: 5, prefs: 5 };

@Injectable()
export class CandidateIndexService {
  constructor(private readonly prisma: PrismaService) {}

  async completion(candidateId: string, db: PrismaService | Tx = this.prisma) {
    const c = await loadCandidate(db, candidateId);
    return c ? this.completionOf(c) : { percent: 0, missing: [] as string[] };
  }

  /** Pure: computes completion from an already-loaded candidate (no queries). */
  completionOf(c: LoadedCandidate) {
    const p = c.candidate_profiles;
    const checks: [keyof typeof WEIGHTS, boolean, string][] = [
      ['basics', !!(c.city && c.first_name && c.contact_phone_e164), 'Add your city and phone number'],
      ['headline', !!(p?.headline && p?.target_role), 'Add a headline and target role'],
      ['education', c.candidate_education.some((e) => e.graduation_year), 'Add your education'],
      ['skills', c.candidate_skills.length >= 5, 'Add at least 5 skills'],
      ['resume', c.resumes.some((r) => r.is_primary), 'Upload your resume'],
      ['summary', (p?.summary?.length ?? 0) >= 150, 'Write a summary (150+ characters)'],
      ['work', c.candidate_projects.length + c.candidate_experience.length > 0, 'Add a project or internship'],
      ['certs', c.candidate_certifications.length > 0, 'Add a certification'],
      ['prefs', !!(p?.preferred_work_modes.length && p?.preferred_cities.length && p?.availability), 'Set your job preferences'],
    ];
    const percent = checks.reduce((s, [k, ok]) => s + (ok ? WEIGHTS[k] : 0), 0);
    return { percent, missing: checks.filter(([, ok]) => !ok).map(([, , hint]) => hint) };
  }

  /** Recompute completion and rebuild the search read model for one candidate. */
  async refresh(candidateId: string) {
    const { percent } = await this.completion(candidateId);
    await this.prisma.candidate_profiles.update({ where: { candidate_id: candidateId }, data: { profile_completion: percent, updated_at: new Date() } });
    await this.prisma.$executeRaw`
      INSERT INTO candidate_search_documents (
        candidate_id, visibility_level, is_searchable, display_name_masked, headline, target_role, current_job_title,
        city, state, highest_education_level, highest_degree, specializations, graduation_year, experience_months,
        expected_ctc_min_paise, availability, employment_status, work_modes, preferred_cities, industries,
        skill_ids, skill_names, certification_names, profile_completion, email_verified, phone_verified,
        last_active_at, search_vector, updated_at)
      SELECT c.id, v.level,
        (v.level IN ('PUBLIC','EMPLOYER_VISIBLE') AND u.status = 'ACTIVE' AND c.deleted_at IS NULL
          AND c.onboarding_completed_at IS NOT NULL AND p.profile_completion >= 40 AND coalesce(cons.granted, false)),
        c.first_name || ' ' || left(c.last_name, 1) || '.',
        p.headline, p.target_role, p.current_job_title, c.city, c.state,
        edu.level, edu.degree, coalesce(specs.arr, '{}'), edu.graduation_year, p.total_experience_months,
        p.expected_ctc_min_paise, p.availability, p.employment_status, p.preferred_work_modes, p.preferred_cities,
        p.preferred_industries, coalesce(sk.ids, '{}'), coalesce(sk.names, '{}'), coalesce(cert.names, '{}'),
        p.profile_completion, u.email_verified_at IS NOT NULL, u.phone_verified_at IS NOT NULL, p.last_active_at,
        setweight(to_tsvector('simple', coalesce(p.headline, '') || ' ' || coalesce(p.target_role, '') || ' ' || coalesce(p.current_job_title, '')), 'A') ||
        setweight(to_tsvector('simple', array_to_string(coalesce(sk.names, '{}'), ' ')), 'A') ||
        setweight(to_tsvector('simple', coalesce(edu.degree, '') || ' ' || array_to_string(coalesce(specs.arr, '{}'), ' ') || ' ' || coalesce(c.city, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(p.summary, '') || ' ' || array_to_string(coalesce(cert.names, '{}'), ' ')), 'C'),
        now()
      FROM candidates c
      JOIN users u ON u.id = c.user_id
      JOIN candidate_profiles p ON p.candidate_id = c.id
      JOIN candidate_visibility v ON v.candidate_id = c.id
      LEFT JOIN LATERAL (SELECT granted FROM candidate_consents
                          WHERE candidate_id = c.id AND purpose = 'DATABASE_DISCOVERY'
                          ORDER BY created_at DESC LIMIT 1) cons ON true
      LEFT JOIN LATERAL (SELECT level, degree, graduation_year FROM candidate_education
                          WHERE candidate_id = c.id
                          ORDER BY CASE level WHEN 'DOCTORATE' THEN 7 WHEN 'PG' THEN 6 WHEN 'UG' THEN 5 WHEN 'DIPLOMA' THEN 4
                                   WHEN 'CERTIFICATE_PROGRAM' THEN 3 WHEN 'HIGHER_SECONDARY' THEN 2 ELSE 1 END DESC,
                                   graduation_year DESC NULLS LAST LIMIT 1) edu ON true
      LEFT JOIN LATERAL (SELECT array_agg(DISTINCT specialization) FILTER (WHERE specialization IS NOT NULL) arr
                           FROM candidate_education WHERE candidate_id = c.id) specs ON true
      LEFT JOIN LATERAL (SELECT array_agg(s.id ORDER BY cs.sort_order) ids, array_agg(s.name ORDER BY cs.sort_order) names
                           FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id = c.id) sk ON true
      LEFT JOIN LATERAL (SELECT array_agg(name) names FROM candidate_certifications WHERE candidate_id = c.id) cert ON true
      WHERE c.id = ${candidateId}::uuid
      ON CONFLICT (candidate_id) DO UPDATE SET
        visibility_level = EXCLUDED.visibility_level, is_searchable = EXCLUDED.is_searchable,
        display_name_masked = EXCLUDED.display_name_masked, headline = EXCLUDED.headline,
        target_role = EXCLUDED.target_role, current_job_title = EXCLUDED.current_job_title, city = EXCLUDED.city,
        state = EXCLUDED.state, highest_education_level = EXCLUDED.highest_education_level,
        highest_degree = EXCLUDED.highest_degree, specializations = EXCLUDED.specializations,
        graduation_year = EXCLUDED.graduation_year, experience_months = EXCLUDED.experience_months,
        expected_ctc_min_paise = EXCLUDED.expected_ctc_min_paise, availability = EXCLUDED.availability,
        employment_status = EXCLUDED.employment_status, work_modes = EXCLUDED.work_modes,
        preferred_cities = EXCLUDED.preferred_cities, industries = EXCLUDED.industries, skill_ids = EXCLUDED.skill_ids,
        skill_names = EXCLUDED.skill_names, certification_names = EXCLUDED.certification_names,
        profile_completion = EXCLUDED.profile_completion, email_verified = EXCLUDED.email_verified,
        phone_verified = EXCLUDED.phone_verified, last_active_at = EXCLUDED.last_active_at,
        search_vector = EXCLUDED.search_vector, updated_at = now()`;
    return percent;
  }
}
