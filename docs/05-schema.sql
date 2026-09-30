-- =============================================================================
-- GenZHire.work — PostgreSQL schema (E)
-- Target: PostgreSQL 17+.  This is the design-reference DDL; production
-- migrations will be generated from it (Drizzle, SQL-first) in Phase 1.
--
-- Conventions
--   * Primary keys: uuid. The app generates UUIDv7 (time-ordered); DB default is
--     a fallback only.
--   * Money: bigint paise (₹1 = 100 paise). Never floats.
--   * Percentages: numeric(5,2).
--   * Status columns: text + CHECK (cheaper to evolve than PG enums).
--   * All timestamps timestamptz (UTC). Business dates (joining, due dates) are
--     `date`, interpreted in Asia/Kolkata.
--   * Soft delete (deleted_at) only where the retention policy needs it.
--   * Tables grouped by bounded context. A context may reference another
--     context's table by FK, but only its own module writes to its tables.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

-- -----------------------------------------------------------------------------
-- IDENTITY
-- -----------------------------------------------------------------------------

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  full_name             text,                      -- employer users, recruiters, admins
  email_verified_at     timestamptz,
  phone_e164            text,
  phone_verified_at     timestamptz,
  password_hash         text,                      -- argon2id; null for invite-pending
  status                text NOT NULL DEFAULT 'PENDING_VERIFICATION'
                        CHECK (status IN ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','DEACTIVATED','PENDING_DELETION','DELETED')),
  status_reason         text,
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_enc        bytea,                     -- AES-GCM via KMS data key
  failed_login_count    int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE roles (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- ADMIN, EMPLOYER, JOBSEEKER, RECRUITER, SUPER_ADMIN, MODERATOR ...
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false, -- system roles cannot be deleted
  requires_mfa boolean NOT NULL DEFAULT false
);

CREATE TABLE permissions (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,          -- e.g. 'talent.candidate.unlock'
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    smallint NOT NULL REFERENCES roles(id),
  granted_by uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- One row per refresh-token family per app. Rotation replaces token hash;
-- reuse of an old hash revokes the whole family (theft detection).
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app                text NOT NULL CHECK (app IN ('JOBSEEKER','EMPLOYER','RECRUITER','ADMIN')),
  refresh_token_hash bytea NOT NULL,
  previous_token_hash bytea,
  mfa_verified_at    timestamptz,
  ip_address         inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoke_reason      text
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX sessions_token_idx ON sessions (refresh_token_hash);

CREATE TABLE login_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  email_attempted citext NOT NULL,
  app             text NOT NULL,
  success         boolean NOT NULL,
  failure_reason  text,          -- BAD_CREDENTIALS, LOCKED, MFA_FAILED, SUSPENDED, WRONG_APP
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_history_user_idx ON login_history (user_id, created_at DESC);
CREATE INDEX login_history_ip_idx ON login_history (ip_address, created_at DESC);

CREATE TABLE verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('EMAIL_VERIFY','PASSWORD_RESET','EMAIL_OTP','PHONE_OTP','EMPLOYER_INVITE','OFFICIAL_EMAIL_VERIFY')),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mfa_recovery_codes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at   timestamptz
);

-- -----------------------------------------------------------------------------
-- FILES (object storage references — bytes never live in Postgres)
-- -----------------------------------------------------------------------------

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose       text NOT NULL CHECK (purpose IN ('RESUME','PROFILE_PHOTO','COMPANY_LOGO','VERIFICATION_DOC','CERTIFICATE','OFFER_LETTER','AGREEMENT','INVOICE_PDF')),
  bucket        text NOT NULL,
  storage_key   text NOT NULL,            -- random, never derived from user input
  original_name text NOT NULL,
  mime_type     text NOT NULL,            -- sniffed server-side, not trusted from client
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  sha256        bytea,
  scan_status   text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','REJECTED','FAILED')),
  scanned_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (bucket, storage_key)
);

-- -----------------------------------------------------------------------------
-- POLICIES & CONSENT
-- -----------------------------------------------------------------------------

CREATE TABLE policy_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('PRIVACY_POLICY','TERMS_CANDIDATE','TERMS_EMPLOYER','RECRUITER_CODE')),
  version      text NOT NULL,
  content_url  text NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE (type, version)
);

CREATE TABLE policy_acceptances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_document_id uuid NOT NULL REFERENCES policy_documents(id),
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  ip_address         inet,
  user_agent         text
);

-- -----------------------------------------------------------------------------
-- SKILLS TAXONOMY (shared reference data)
-- -----------------------------------------------------------------------------

CREATE TABLE skills (
  id          int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  category    text,                          -- LANGUAGE, FRAMEWORK, TOOL, DOMAIN, SOFT
  aliases     text[] NOT NULL DEFAULT '{}',  -- 'js','javascript'
  merged_into int REFERENCES skills(id),     -- admin merges duplicates
  is_approved boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skills_name_trgm_idx ON skills USING gin (name gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- CANDIDATE
-- PII (candidates) is split from professional data (candidate_profiles) so
-- that access paths to contact data are narrow and auditable.
-- -----------------------------------------------------------------------------

CREATE TABLE candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  contact_email      citext,                -- defaults to users.email; PROTECTED
  contact_phone_e164 text,                  -- PROTECTED
  city               text,
  state              text,
  country_code       char(2) NOT NULL DEFAULT 'IN',
  age_confirmed_at   timestamptz NOT NULL,  -- 18+ self-declaration (D8)
  onboarding_completed_at timestamptz,
  is_honeytoken      boolean NOT NULL DEFAULT false, -- anti-scraping canary; hidden from real UIs' counts
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TABLE candidate_profiles (
  candidate_id            uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  headline                text,                 -- "Aspiring Data Analyst | Python · SQL"
  summary                 text,
  target_role             text,
  current_job_title       text,
  employment_status       text CHECK (employment_status IN ('STUDENT','FRESHER','EMPLOYED','INTERNING','BETWEEN_JOBS')),
  total_experience_months smallint NOT NULL DEFAULT 0,
  expected_ctc_min_paise  bigint,
  expected_ctc_max_paise  bigint,
  availability            text CHECK (availability IN ('IMMEDIATE','WITHIN_15_DAYS','WITHIN_30_DAYS','WITHIN_60_DAYS','AFTER_GRADUATION')),
  available_from          date,
  preferred_work_modes    text[] NOT NULL DEFAULT '{}',   -- ONSITE, HYBRID, REMOTE
  preferred_cities        text[] NOT NULL DEFAULT '{}',
  preferred_employment_types text[] NOT NULL DEFAULT '{}',
  preferred_industries    text[] NOT NULL DEFAULT '{}',
  links                   jsonb NOT NULL DEFAULT '[]',     -- [{type:'GITHUB',url}]
  photo_file_id           uuid REFERENCES files(id),
  profile_completion      smallint NOT NULL DEFAULT 0 CHECK (profile_completion BETWEEN 0 AND 100),
  last_active_at          timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_education (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id     uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  level            text NOT NULL CHECK (level IN ('SECONDARY','HIGHER_SECONDARY','DIPLOMA','UG','PG','DOCTORATE','CERTIFICATE_PROGRAM')),
  degree           text,                 -- B.Tech, B.Com, MBA
  specialization   text,
  institution      text NOT NULL,
  university_board text,
  start_year       smallint,
  graduation_year  smallint,
  is_pursuing      boolean NOT NULL DEFAULT false,
  score_type       text CHECK (score_type IN ('CGPA_10','CGPA_4','PERCENTAGE')),
  score            numeric(5,2),
  sort_order       smallint NOT NULL DEFAULT 0
);
CREATE INDEX candidate_education_candidate_idx ON candidate_education (candidate_id);

CREATE TABLE candidate_experience (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  company_name    text NOT NULL,
  title           text NOT NULL,
  employment_type text NOT NULL CHECK (employment_type IN ('FULL_TIME','PART_TIME','INTERNSHIP','APPRENTICESHIP','FREELANCE','CONTRACT')),
  location        text,
  start_date      date NOT NULL,
  end_date        date,
  is_current      boolean NOT NULL DEFAULT false,
  description     text,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX candidate_experience_candidate_idx ON candidate_experience (candidate_id);

CREATE TABLE candidate_skills (
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skill_id     int  NOT NULL REFERENCES skills(id),
  proficiency  text CHECK (proficiency IN ('BEGINNER','INTERMEDIATE','ADVANCED')),
  sort_order   smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (candidate_id, skill_id)
);
CREATE INDEX candidate_skills_skill_idx ON candidate_skills (skill_id);

CREATE TABLE candidate_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  role         text,
  skill_ids    int[] NOT NULL DEFAULT '{}',
  project_url  text,
  repo_url     text,
  start_date   date,
  end_date     date,
  sort_order   smallint NOT NULL DEFAULT 0
);

CREATE TABLE candidate_certifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  name           text NOT NULL,
  issuer         text NOT NULL,
  issue_date     date,
  expiry_date    date,
  credential_id  text,
  credential_url text,
  file_id        uuid REFERENCES files(id)
);

CREATE TABLE resumes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  file_id      uuid NOT NULL REFERENCES files(id),
  label        text NOT NULL DEFAULT 'Resume',
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX resumes_one_primary_idx ON resumes (candidate_id) WHERE is_primary AND deleted_at IS NULL;

CREATE TABLE candidate_visibility (
  candidate_id        uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  level               text NOT NULL DEFAULT 'EMPLOYER_VISIBLE'
                      CHECK (level IN ('PUBLIC','EMPLOYER_VISIBLE','APPLICATION_ONLY','HIDDEN')),
  public_slug         text UNIQUE,          -- only when level = PUBLIC
  open_to_work        boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_blocked_employers (
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  employer_id  uuid NOT NULL,               -- FK added after employers table
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, employer_id)
);

-- Append-only: each grant/withdrawal is a new row. Current state = latest row per purpose.
CREATE TABLE candidate_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  purpose         text NOT NULL CHECK (purpose IN ('ACCOUNT_SERVICES','DATABASE_DISCOVERY','RECRUITER_OUTREACH','MARKETING_EMAIL','MARKETING_SMS','WHATSAPP')),
  granted         boolean NOT NULL,
  policy_document_id uuid NOT NULL REFERENCES policy_documents(id),
  source          text NOT NULL,             -- SIGNUP, SETTINGS, ONBOARDING, ADMIN_ON_REQUEST
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_consents_lookup_idx ON candidate_consents (candidate_id, purpose, created_at DESC);

-- -----------------------------------------------------------------------------
-- EMPLOYER
-- employer = tenant account (users, credits, verification)
-- company  = public brand shown on jobs (1:N reserved for agencies)
-- -----------------------------------------------------------------------------

CREATE TABLE employers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','SUSPENDED')),
  verified_at         timestamptz,
  primary_domain      citext,                -- acme.com; null if free-mail signup
  account_type        text NOT NULL DEFAULT 'DIRECT' CHECK (account_type IN ('DIRECT','AGENCY')),
  risk_score          smallint NOT NULL DEFAULT 0,
  created_by_user_id  uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX employers_domain_idx ON employers (primary_domain) WHERE primary_domain IS NOT NULL AND status <> 'CLOSED';

ALTER TABLE candidate_blocked_employers
  ADD CONSTRAINT candidate_blocked_employers_employer_fk FOREIGN KEY (employer_id) REFERENCES employers(id) ON DELETE CASCADE;

CREATE TABLE companies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id   uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  legal_name    text NOT NULL,
  display_name  text NOT NULL,
  slug          text NOT NULL UNIQUE,
  website       text,
  industry      text,
  size_band     text CHECK (size_band IN ('1_10','11_50','51_200','201_500','501_1000','1001_5000','5000_PLUS')),
  founded_year  smallint,
  description   text,
  logo_file_id  uuid REFERENCES files(id),
  hq_city       text,
  hq_state      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_employer_idx ON companies (employer_id);

CREATE TABLE employer_users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_role text NOT NULL CHECK (company_role IN ('COMPANY_ADMIN','HR_MANAGER','COMPANY_RECRUITER','VIEWER')),
  designation  text,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','REMOVED')),
  invited_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employer_id, user_id)
);
CREATE INDEX employer_users_user_idx ON employer_users (user_id) WHERE status = 'ACTIVE';

CREATE TABLE employer_verification (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id                uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  submitted_by               uuid NOT NULL REFERENCES users(id),
  official_email             citext,
  official_email_verified_at timestamptz,
  website                    text,
  registration_type          text CHECK (registration_type IN ('GSTIN','CIN','LLPIN','UDYAM','SHOP_ESTABLISHMENT','OTHER')),
  registration_number        text,
  document_file_ids          uuid[] NOT NULL DEFAULT '{}',
  contact_name               text NOT NULL,
  contact_phone_e164         text NOT NULL,
  status                     text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','IN_REVIEW','NEEDS_INFO','APPROVED','REJECTED')),
  reviewer_id                uuid REFERENCES users(id),
  reviewer_notes             text,         -- internal
  decision_reason            text,         -- shown to employer
  decided_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employer_verification_queue_idx ON employer_verification (status, created_at) WHERE status IN ('SUBMITTED','IN_REVIEW');

-- -----------------------------------------------------------------------------
-- JOBS
-- -----------------------------------------------------------------------------

CREATE TABLE jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id            uuid NOT NULL REFERENCES employers(id),
  company_id             uuid NOT NULL REFERENCES companies(id),
  posted_by_user_id      uuid NOT NULL REFERENCES users(id),
  title                  text NOT NULL,
  slug                   text NOT NULL,
  department             text,
  description            text NOT NULL,       -- sanitized rich text (allow-listed HTML)
  responsibilities       text,
  requirements           text,
  min_education_level    text,
  qualifications         text[] NOT NULL DEFAULT '{}',
  experience_min_months  smallint NOT NULL DEFAULT 0,
  experience_max_months  smallint,
  salary_min_paise       bigint,
  salary_max_paise       bigint,
  salary_period          text NOT NULL DEFAULT 'ANNUAL' CHECK (salary_period IN ('ANNUAL','MONTHLY')),
  salary_visible         boolean NOT NULL DEFAULT true,
  work_mode              text NOT NULL CHECK (work_mode IN ('ONSITE','HYBRID','REMOTE')),
  employment_type        text NOT NULL CHECK (employment_type IN ('FULL_TIME','PART_TIME','INTERNSHIP','CONTRACT','APPRENTICESHIP')),
  openings               smallint NOT NULL DEFAULT 1 CHECK (openings > 0),
  application_deadline   date,
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','PUBLISHED','PAUSED','CLOSED','REJECTED')),
  moderation_reason      text,
  moderated_by           uuid REFERENCES users(id),
  published_at           timestamptz,
  closed_at              timestamptz,
  search_vector          tsvector GENERATED ALWAYS AS (
                           setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                           setweight(to_tsvector('english', coalesce(department,'')), 'B') ||
                           setweight(to_tsvector('english', coalesce(requirements,'')), 'C') ||
                           setweight(to_tsvector('english', coalesce(description,'')), 'D')
                         ) STORED,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (salary_max_paise IS NULL OR salary_min_paise IS NULL OR salary_max_paise >= salary_min_paise),
  CHECK (experience_max_months IS NULL OR experience_max_months >= experience_min_months)
);
CREATE INDEX jobs_public_idx ON jobs (published_at DESC, id) WHERE status = 'PUBLISHED';
CREATE INDEX jobs_employer_idx ON jobs (employer_id, status);
CREATE INDEX jobs_search_idx ON jobs USING gin (search_vector);
CREATE INDEX jobs_title_trgm_idx ON jobs USING gin (title gin_trgm_ops);

CREATE TABLE job_locations (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  city   text NOT NULL,
  state  text NOT NULL,
  PRIMARY KEY (job_id, city, state)
);
CREATE INDEX job_locations_city_idx ON job_locations (city);

CREATE TABLE job_skills (
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id     int  NOT NULL REFERENCES skills(id),
  is_mandatory boolean NOT NULL DEFAULT true,
  PRIMARY KEY (job_id, skill_id)
);
CREATE INDEX job_skills_skill_idx ON job_skills (skill_id);

CREATE TABLE saved_jobs (
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id       uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, job_id)
);

-- -----------------------------------------------------------------------------
-- APPLICATIONS
-- -----------------------------------------------------------------------------

CREATE TABLE applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES jobs(id),
  employer_id       uuid NOT NULL REFERENCES employers(id),   -- denormalised for tenant scoping
  candidate_id      uuid NOT NULL REFERENCES candidates(id),
  resume_id         uuid REFERENCES resumes(id),
  resume_file_id    uuid NOT NULL REFERENCES files(id),       -- snapshot: survives resume replacement
  cover_note        text CHECK (char_length(cover_note) <= 1000),
  profile_snapshot  jsonb NOT NULL,                           -- profile as submitted
  source            text NOT NULL DEFAULT 'DIRECT' CHECK (source IN ('DIRECT','RECRUITER_SUBMISSION','EMPLOYER_INVITE')),
  status            text NOT NULL DEFAULT 'APPLIED'
                    CHECK (status IN ('APPLIED','VIEWED','SCREENING','SHORTLISTED','INTERVIEW','SELECTED','REJECTED','WITHDRAWN')),
  match_score       smallint,                                 -- deterministic skill overlap %, nullable
  applied_at        timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);
CREATE INDEX applications_job_status_idx ON applications (job_id, status, applied_at DESC);
CREATE INDEX applications_employer_idx ON applications (employer_id, applied_at DESC);
CREATE INDEX applications_candidate_idx ON applications (candidate_id, applied_at DESC);

CREATE TABLE application_status_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status    text,
  to_status      text NOT NULL,
  changed_by     uuid REFERENCES users(id),       -- null = system
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_status_history_app_idx ON application_status_history (application_id, created_at);

-- -----------------------------------------------------------------------------
-- TALENT DATABASE (employer ↔ candidate interactions)
-- -----------------------------------------------------------------------------

CREATE TABLE candidate_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'CUSTOM' CHECK (kind IN ('CUSTOM','SHORTLIST')),
  job_id      uuid REFERENCES jobs(id) ON DELETE SET NULL,
  hiring_requirement_id uuid,                     -- FK added later
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employer_id, name)
);

CREATE TABLE saved_candidates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  folder_id    uuid REFERENCES candidate_folders(id) ON DELETE CASCADE,
  saved_by     uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saved_candidates_uniq_idx
  ON saved_candidates (employer_id, candidate_id, coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE candidate_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES users(id),
  body         text NOT NULL CHECK (char_length(body) <= 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_notes_idx ON candidate_notes (employer_id, candidate_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- ENTITLEMENTS (credit buckets + immutable ledger)
-- -----------------------------------------------------------------------------

CREATE TABLE subscriptions (                     -- Phase 6; present so buckets can reference it
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  uuid NOT NULL REFERENCES employers(id),
  plan_code    text NOT NULL,
  status       text NOT NULL CHECK (status IN ('TRIAL','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')),
  period_start date NOT NULL,
  period_end   date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE employer_entitlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id        uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  entitlement_type   text NOT NULL CHECK (entitlement_type IN ('CANDIDATE_PROFILE_VIEW','CONTACT_REVEAL','RESUME_DOWNLOAD','JOB_POST')),
  source             text NOT NULL CHECK (source IN ('FREE_ON_VERIFICATION','SUBSCRIPTION','ADMIN_GRANT','PROMOTION')),
  total_quantity     int NOT NULL CHECK (total_quantity >= 0),
  used_quantity      int NOT NULL DEFAULT 0,
  remaining_quantity int GENERATED ALWAYS AS (total_quantity - used_quantity) STORED,
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_until        timestamptz NOT NULL,
  subscription_id    uuid REFERENCES subscriptions(id),
  granted_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (used_quantity >= 0 AND used_quantity <= total_quantity),
  CHECK (valid_until > valid_from)
);
CREATE INDEX employer_entitlements_active_idx
  ON employer_entitlements (employer_id, entitlement_type, valid_until)
  WHERE used_quantity < total_quantity;
-- Guarantees the free grant is issued at most once per employer
CREATE UNIQUE INDEX employer_entitlements_free_once_idx
  ON employer_entitlements (employer_id, entitlement_type) WHERE source = 'FREE_ON_VERIFICATION';

CREATE TABLE entitlement_ledger (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entitlement_id uuid NOT NULL REFERENCES employer_entitlements(id),
  employer_id    uuid NOT NULL REFERENCES employers(id),
  delta          int NOT NULL CHECK (delta <> 0),   -- +grant / -consume / +refund
  reason         text NOT NULL CHECK (reason IN ('GRANT','CONSUME','REFUND','ADJUST','EXPIRE')),
  reference_type text,                               -- 'profile_unlock', 'admin_adjustment'
  reference_id   uuid,
  actor_user_id  uuid REFERENCES users(id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlement_ledger_employer_idx ON entitlement_ledger (employer_id, created_at DESC);

-- One row per (employer, candidate, unlock_type). Renewal after expiry updates
-- the row (history lives in the ledger + candidate_profile_views).
CREATE TABLE profile_unlocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id   uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  unlock_type   text NOT NULL CHECK (unlock_type IN ('PROFILE','CONTACT')),
  unlocked_by   uuid NOT NULL REFERENCES users(id),
  ledger_id     bigint REFERENCES entitlement_ledger(id),  -- null when unlocked via non-credit basis
  unlocked_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  UNIQUE (employer_id, candidate_id, unlock_type)
);
CREATE INDEX profile_unlocks_candidate_idx ON profile_unlocks (candidate_id, unlocked_at DESC);

-- Access log (spec §24). Append-only. Every full-profile render, resume
-- download and contact reveal by an employer OR recruiter writes a row.
CREATE TABLE candidate_profile_views (
  id                 bigint GENERATED ALWAYS AS IDENTITY,
  viewer_user_id     uuid NOT NULL REFERENCES users(id),
  viewer_type        text NOT NULL CHECK (viewer_type IN ('EMPLOYER','RECRUITER','ADMIN')),
  employer_id        uuid REFERENCES employers(id),
  candidate_id       uuid NOT NULL REFERENCES candidates(id),
  action             text NOT NULL CHECK (action IN ('FULL_PROFILE_VIEW','RESUME_DOWNLOAD','CONTACT_REVEAL','PROFILE_SHARED')),
  access_basis       text NOT NULL CHECK (access_basis IN ('CREDIT','ACTIVE_UNLOCK','APPLICATION','RECRUITER_SUBMISSION','RECRUITER_CASE','CONTACT_ACCEPTED','ADMIN')),
  credits_consumed   smallint NOT NULL DEFAULT 0,
  ledger_id          bigint,
  ip_address         inet,
  user_agent         text,
  request_id         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
-- Monthly partitions created by a scheduled job, e.g.:
CREATE TABLE candidate_profile_views_2026_10 PARTITION OF candidate_profile_views
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX candidate_profile_views_employer_idx ON candidate_profile_views (employer_id, created_at DESC);
CREATE INDEX candidate_profile_views_candidate_idx ON candidate_profile_views (candidate_id, created_at DESC);
CREATE INDEX candidate_profile_views_viewer_idx ON candidate_profile_views (viewer_user_id, created_at DESC);

CREATE TABLE contact_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id  uuid NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  job_id       uuid REFERENCES jobs(id) ON DELETE SET NULL,
  message      text NOT NULL CHECK (char_length(message) <= 1000),
  status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED')),
  responded_at timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_requests_one_pending_idx ON contact_requests (employer_id, candidate_id) WHERE status = 'PENDING';

-- Denormalised read model for candidate search; maintained by the search
-- indexer worker from outbox events. Swappable for OpenSearch later.
CREATE TABLE candidate_search_documents (
  candidate_id          uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  visibility_level      text NOT NULL,
  is_searchable         boolean NOT NULL,          -- visibility + consent + account status + onboarding complete
  display_name_masked   text NOT NULL,             -- "Rahul K."
  headline              text,
  target_role           text,
  current_job_title     text,
  city                  text,
  state                 text,
  highest_education_level text,
  highest_degree        text,
  specializations       text[] NOT NULL DEFAULT '{}',
  graduation_year       smallint,
  experience_months     smallint NOT NULL DEFAULT 0,
  expected_ctc_min_paise bigint,
  availability          text,
  employment_status     text,
  work_modes            text[] NOT NULL DEFAULT '{}',
  preferred_cities      text[] NOT NULL DEFAULT '{}',
  industries            text[] NOT NULL DEFAULT '{}',
  skill_ids             int[] NOT NULL DEFAULT '{}',
  skill_names           text[] NOT NULL DEFAULT '{}',
  certification_names   text[] NOT NULL DEFAULT '{}',
  profile_completion    smallint NOT NULL,
  email_verified        boolean NOT NULL,
  phone_verified        boolean NOT NULL,
  last_active_at        timestamptz,
  search_vector         tsvector NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csd_vector_idx ON candidate_search_documents USING gin (search_vector) WHERE is_searchable;
CREATE INDEX csd_skills_idx ON candidate_search_documents USING gin (skill_ids) WHERE is_searchable;
CREATE INDEX csd_city_idx ON candidate_search_documents (city) WHERE is_searchable;
CREATE INDEX csd_grad_idx ON candidate_search_documents (graduation_year) WHERE is_searchable;
CREATE INDEX csd_active_idx ON candidate_search_documents (last_active_at DESC, candidate_id) WHERE is_searchable;

-- -----------------------------------------------------------------------------
-- RECRUITMENT
-- -----------------------------------------------------------------------------

CREATE TABLE hiring_requirements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id           uuid NOT NULL REFERENCES employers(id),
  company_id            uuid NOT NULL REFERENCES companies(id),
  created_by            uuid NOT NULL REFERENCES users(id),
  role_title            text NOT NULL,
  openings              smallint NOT NULL CHECK (openings > 0),
  qualification         text,
  min_education_level   text,
  experience_min_months smallint NOT NULL DEFAULT 0,
  experience_max_months smallint,
  locations             text[] NOT NULL DEFAULT '{}',
  work_mode             text NOT NULL CHECK (work_mode IN ('ONSITE','HYBRID','REMOTE')),
  ctc_min_paise         bigint,
  ctc_max_paise         bigint,
  joining_timeline      text NOT NULL CHECK (joining_timeline IN ('IMMEDIATE','WITHIN_15_DAYS','WITHIN_30_DAYS','WITHIN_60_DAYS','FLEXIBLE')),
  fulfilment_mode       text NOT NULL CHECK (fulfilment_mode IN ('DATABASE','CONSULTANT','BOTH')),
  notes                 text,
  status                text NOT NULL DEFAULT 'SUBMITTED'
                        CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','ACTIVE','ON_HOLD','FILLED','CLOSED','CANCELLED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hiring_requirements_employer_idx ON hiring_requirements (employer_id, status);

ALTER TABLE candidate_folders
  ADD CONSTRAINT candidate_folders_req_fk FOREIGN KEY (hiring_requirement_id) REFERENCES hiring_requirements(id) ON DELETE SET NULL;

CREATE TABLE hiring_requirement_skills (
  hiring_requirement_id uuid NOT NULL REFERENCES hiring_requirements(id) ON DELETE CASCADE,
  skill_id              int  NOT NULL REFERENCES skills(id),
  is_mandatory          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (hiring_requirement_id, skill_id)
);

CREATE TABLE recruiters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL UNIQUE REFERENCES users(id),
  employee_code    text UNIQUE,
  display_name     text NOT NULL,
  designation      text,
  max_active_cases smallint NOT NULL DEFAULT 10,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ON_LEAVE','INACTIVE')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Commercial terms. Values are SNAPSHOTTED onto billing rows so later edits
-- to settings/agreements never change historic fees.
CREATE TABLE recruitment_agreements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id          uuid NOT NULL REFERENCES employers(id),
  reference_no         text NOT NULL UNIQUE,
  fee_percentage       numeric(5,2) NOT NULL CHECK (fee_percentage > 0 AND fee_percentage <= 100),
  payment_trigger_days smallint NOT NULL CHECK (payment_trigger_days > 0),
  payment_terms_days   smallint NOT NULL DEFAULT 15,        -- invoice due in N days
  replacement_terms    text,
  valid_from           date NOT NULL,
  valid_until          date,
  signed_file_id       uuid REFERENCES files(id),
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recruitment_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hiring_requirement_id uuid NOT NULL UNIQUE REFERENCES hiring_requirements(id),
  employer_id           uuid NOT NULL REFERENCES employers(id),
  agreement_id          uuid NOT NULL REFERENCES recruitment_agreements(id),
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ON_HOLD','FILLED','CLOSED','CANCELLED')),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz
);

CREATE TABLE recruitment_case_assignments (
  case_id      uuid NOT NULL REFERENCES recruitment_cases(id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES recruiters(id),
  role         text NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','CONTRIBUTOR')),
  assigned_by  uuid NOT NULL REFERENCES users(id),
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  PRIMARY KEY (case_id, recruiter_id)
);

-- Configurable stages; `semantic` is fixed and drives system behaviour.
CREATE TABLE pipeline_stages (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  semantic    text NOT NULL CHECK (semantic IN ('SOURCING','SCREENING','SHORTLISTED','SUBMITTED','INTERVIEW','SELECTED','OFFER','JOINED','TRACKING','BILLABLE','INVOICED','PAID','REJECTED','WITHDRAWN','DROPPED')),
  sort_order  smallint NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  is_system   boolean NOT NULL DEFAULT true   -- system stages can be relabelled, not deleted
);

CREATE TABLE recruitment_candidates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid NOT NULL REFERENCES recruitment_cases(id) ON DELETE CASCADE,
  candidate_id         uuid NOT NULL REFERENCES candidates(id),
  stage_id             smallint NOT NULL REFERENCES pipeline_stages(id),
  sourced_by           uuid NOT NULL REFERENCES recruiters(id),
  source               text NOT NULL CHECK (source IN ('DATABASE','APPLICATION','REFERRAL','EXTERNAL')),
  screening_notes      text,
  submitted_at         timestamptz,
  employer_decision    text CHECK (employer_decision IN ('PENDING','ACCEPTED','REJECTED')),
  employer_feedback    text,
  drop_reason          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, candidate_id)
);
CREATE INDEX recruitment_candidates_stage_idx ON recruitment_candidates (case_id, stage_id);
CREATE INDEX recruitment_candidates_candidate_idx ON recruitment_candidates (candidate_id);

CREATE TABLE recruitment_stage_history (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recruitment_candidate_id uuid NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  from_stage_id            smallint REFERENCES pipeline_stages(id),
  to_stage_id              smallint NOT NULL REFERENCES pipeline_stages(id),
  changed_by               uuid REFERENCES users(id),
  note                     text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE interviews (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_candidate_id uuid REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  application_id           uuid REFERENCES applications(id) ON DELETE CASCADE,
  round_no                 smallint NOT NULL DEFAULT 1,
  round_name               text NOT NULL,
  mode                     text NOT NULL CHECK (mode IN ('IN_PERSON','VIDEO','PHONE')),
  scheduled_start          timestamptz NOT NULL,
  scheduled_end            timestamptz NOT NULL,
  location_or_link         text,
  interviewer_names        text,
  status                   text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','RESCHEDULED','COMPLETED','NO_SHOW','CANCELLED')),
  outcome                  text NOT NULL DEFAULT 'PENDING' CHECK (outcome IN ('PENDING','PASSED','FAILED','ON_HOLD')),
  feedback                 text,
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(recruitment_candidate_id, application_id) = 1),
  CHECK (scheduled_end > scheduled_start)
);
CREATE INDEX interviews_schedule_idx ON interviews (scheduled_start) WHERE status IN ('SCHEDULED','RESCHEDULED');

CREATE TABLE offers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_candidate_id uuid NOT NULL REFERENCES recruitment_candidates(id) ON DELETE CASCADE,
  designation              text NOT NULL,
  annual_ctc_paise         bigint NOT NULL CHECK (annual_ctc_paise > 0),
  offer_date               date NOT NULL,
  expected_joining_date    date NOT NULL,
  status                   text NOT NULL DEFAULT 'EXTENDED' CHECK (status IN ('EXTENDED','ACCEPTED','DECLINED','REVOKED')),
  offer_letter_file_id     uuid REFERENCES files(id),
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_joinings (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruitment_candidate_id   uuid NOT NULL UNIQUE REFERENCES recruitment_candidates(id),
  offer_id                   uuid NOT NULL REFERENCES offers(id),
  joining_date               date NOT NULL,
  annual_ctc_paise           bigint NOT NULL CHECK (annual_ctc_paise > 0),
  recruiter_confirmed_by     uuid REFERENCES users(id),
  recruiter_confirmed_at     timestamptz,
  employer_confirmed_by      uuid REFERENCES users(id),
  employer_confirmed_at      timestamptz,
  payment_trigger_days       smallint NOT NULL,          -- snapshot from agreement
  billing_due_date           date GENERATED ALWAYS AS (joining_date + payment_trigger_days) STORED,
  tracking_status            text NOT NULL DEFAULT 'AWAITING_CONFIRMATION'
                             CHECK (tracking_status IN ('AWAITING_CONFIRMATION','TRACKING','COMPLETED','LEFT_EARLY','DISPUTED')),
  left_on                    date,
  left_reason                text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidate_joinings_due_idx ON candidate_joinings (billing_due_date) WHERE tracking_status = 'TRACKING';

CREATE TABLE joining_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  joining_id  uuid NOT NULL REFERENCES candidate_joinings(id) ON DELETE CASCADE,
  day_offset  smallint NOT NULL,
  due_on      date NOT NULL,
  sent_at     timestamptz,
  UNIQUE (joining_id, day_offset)
);
CREATE INDEX joining_reminders_due_idx ON joining_reminders (due_on) WHERE sent_at IS NULL;

-- -----------------------------------------------------------------------------
-- BILLING
-- -----------------------------------------------------------------------------

CREATE TABLE consultant_billing (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  joining_id         uuid NOT NULL UNIQUE REFERENCES candidate_joinings(id),
  employer_id        uuid NOT NULL REFERENCES employers(id),
  agreement_id       uuid NOT NULL REFERENCES recruitment_agreements(id),
  annual_ctc_paise   bigint NOT NULL,
  fee_percentage     numeric(5,2) NOT NULL,       -- snapshot
  fee_amount_paise   bigint NOT NULL,             -- round_half_up(ctc * pct / 100)
  status             text NOT NULL DEFAULT 'PENDING_TRIGGER'
                     CHECK (status IN ('PENDING_TRIGGER','BILLABLE','INVOICED','PAID','CANCELLED','WAIVED','DISPUTED')),
  billable_at        timestamptz,
  status_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number     text UNIQUE,                 -- assigned on ISSUE, gapless per FY
  employer_id        uuid NOT NULL REFERENCES employers(id),
  buyer_legal_name   text NOT NULL,
  buyer_gstin        text,
  buyer_address      text NOT NULL,
  place_of_supply    text NOT NULL,               -- state code, determines CGST+SGST vs IGST
  subtotal_paise     bigint NOT NULL,
  tax_rate           numeric(5,2) NOT NULL,
  cgst_paise         bigint NOT NULL DEFAULT 0,
  sgst_paise         bigint NOT NULL DEFAULT 0,
  igst_paise         bigint NOT NULL DEFAULT 0,
  total_paise        bigint NOT NULL,
  amount_paid_paise  bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOID')),
  issued_at          timestamptz,
  due_date           date,
  pdf_file_id        uuid REFERENCES files(id),
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (total_paise = subtotal_paise + cgst_paise + sgst_paise + igst_paise)
);

CREATE TABLE invoice_number_sequences (          -- gapless numbering per financial year
  financial_year text PRIMARY KEY,               -- '2026-27'
  last_value     int NOT NULL DEFAULT 0
);

CREATE TABLE invoice_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  consultant_billing_id uuid UNIQUE REFERENCES consultant_billing(id),
  description           text NOT NULL,
  sac_code              text,
  amount_paise          bigint NOT NULL
);

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  tds_paise    bigint NOT NULL DEFAULT 0,
  method       text NOT NULL CHECK (method IN ('BANK_TRANSFER','UPI','CHEQUE','PAYMENT_GATEWAY')),
  reference    text NOT NULL,
  received_on  date NOT NULL,
  recorded_by  uuid NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','REVERSED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS
-- -----------------------------------------------------------------------------

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app        text NOT NULL,                       -- which app's bell shows it
  type       text NOT NULL,                       -- APPLICATION_STATUS_CHANGED, PROFILE_UNLOCKED ...
  title      text NOT NULL,
  body       text NOT NULL,
  link       text,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (user_id, app, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id, app) WHERE read_at IS NULL;

CREATE TABLE notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id     uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
  status              text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED','SUPPRESSED')),
  provider_message_id text,
  attempts            smallint NOT NULL DEFAULT 0,
  last_error          text,
  sent_at             timestamptz
);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  enabled boolean NOT NULL,
  PRIMARY KEY (user_id, type, channel)
);

-- -----------------------------------------------------------------------------
-- TRUST & SAFETY
-- -----------------------------------------------------------------------------

CREATE TABLE abuse_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid REFERENCES users(id),
  target_type  text NOT NULL CHECK (target_type IN ('JOB','EMPLOYER','CANDIDATE','CONTACT_REQUEST')),
  target_id    uuid NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('FAKE_JOB','SCAM_PAYMENT_REQUEST','SPAM','HARASSMENT','DISCRIMINATION','MISLEADING','OTHER')),
  details      text,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','ACTIONED','DISMISSED')),
  handled_by   uuid REFERENCES users(id),
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL,          -- SCRAPING_VELOCITY, HONEYTOKEN_ACCESS, CREDENTIAL_STUFFING, IMPOSSIBLE_TRAVEL, REFRESH_TOKEN_REUSE
  severity    text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  user_id     uuid REFERENCES users(id),
  employer_id uuid REFERENCES employers(id),
  details     jsonb NOT NULL,
  auto_action text,                   -- THROTTLED, SESSIONS_REVOKED, SUSPENDED
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','FALSE_POSITIVE')),
  resolved_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PLATFORM: settings, audit, outbox, analytics, data-subject requests
-- -----------------------------------------------------------------------------

CREATE TABLE system_settings (
  key         text PRIMARY KEY,               -- 'billing.consultant_fee_percentage'
  value       jsonb NOT NULL,
  schema      jsonb NOT NULL,                 -- JSON Schema for validation in admin UI
  description text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  old_value  jsonb,
  new_value  jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id),
  reason     text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable audit log. The app DB role has INSERT + SELECT only (see grants
-- below). Each row carries a SHA-256 hash chained to the previous row so
-- tampering by a privileged DB user is detectable.
CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  actor_id    uuid,                          -- null = system
  actor_role  text,
  actor_app   text,
  action      text NOT NULL,                 -- 'candidate.profile_unlocked'
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  employer_id uuid,                          -- tenant context when relevant
  metadata    jsonb NOT NULL DEFAULT '{}',   -- never contains secrets or full PII
  ip_address  inet,
  user_agent  text,
  request_id  text,
  prev_hash   bytea,
  hash        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE audit_logs_2026_10 PARTITION OF audit_logs FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- Transactional outbox: domain events written in the same transaction as the
-- state change; a relay publishes them to BullMQ queues.
CREATE TABLE outbox_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  event_type     text NOT NULL,              -- 'application.status_changed'
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (id) WHERE published_at IS NULL;

CREATE TABLE analytics_events (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at  timestamptz NOT NULL,
  user_id      uuid,
  anonymous_id text,
  app          text NOT NULL,
  event_name   text NOT NULL,                -- 'job.viewed', 'talent.search_performed'
  properties   jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE analytics_events_2026_10 PARTITION OF analytics_events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE data_subject_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  type         text NOT NULL CHECK (type IN ('EXPORT','DELETION','CORRECTION','GRIEVANCE')),
  status       text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','IN_PROGRESS','COMPLETED','REJECTED')),
  details      text,
  due_by       date NOT NULL,
  completed_at timestamptz,
  handled_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- DB ROLES (least privilege). Migrations run as genzhire_owner.
-- -----------------------------------------------------------------------------
-- CREATE ROLE genzhire_app LOGIN;          -- API + workers
-- CREATE ROLE genzhire_readonly LOGIN;     -- analytics/reporting replica
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO genzhire_app;
-- REVOKE UPDATE, DELETE ON audit_logs, candidate_profile_views, entitlement_ledger,
--        candidate_consents, login_history, system_settings_history FROM genzhire_app;

-- -----------------------------------------------------------------------------
-- SEED: settings (see 06-business-rules.md for semantics)
-- -----------------------------------------------------------------------------
INSERT INTO system_settings (key, value, schema, description) VALUES
 ('billing.consultant_fee_percentage', '8.33',               '{"type":"number","minimum":0.01,"maximum":100}', 'Default fee % for new recruitment agreements'),
 ('billing.payment_trigger_days',      '90',                 '{"type":"integer","minimum":1}',                 'Default days after joining before fee is billable'),
 ('billing.reminder_offsets_days',     '[30,60,75,85,90]',   '{"type":"array","items":{"type":"integer"}}',    'Reminder days after joining'),
 ('billing.gst_rate_percentage',       '18',                 '{"type":"number"}',                               'GST on consultant fee'),
 ('entitlements.free_profile_views',   '50',                 '{"type":"integer","minimum":0}',                  'Free CANDIDATE_PROFILE_VIEW credits on verification'),
 ('entitlements.free_validity_days',   '365',                '{"type":"integer","minimum":1}',                  'Validity of free credits'),
 ('talent.unlock_validity_days',       '90',                 '{"type":"integer","minimum":1}',                  'Re-opening an unlocked profile is free for this window'),
 ('talent.contact_reveal_mode',        '"CANDIDATE_APPROVAL"','{"enum":["CANDIDATE_APPROVAL","ENTITLEMENT","INCLUDED_WITH_UNLOCK"]}', 'How contact details are released'),
 ('talent.resume_download_mode',       '"INCLUDED_WITH_UNLOCK"','{"enum":["INCLUDED_WITH_UNLOCK","ENTITLEMENT"]}', 'Whether resume download needs its own credit'),
 ('talent.search_card_name_display',   '"FIRST_NAME_LAST_INITIAL"','{"enum":["FULL","FIRST_NAME_LAST_INITIAL","INITIALS"]}', 'Name shown on search cards before unlock'),
 ('talent.search_page_size_max',       '25',                 '{"type":"integer"}',                              'Max candidate search page size'),
 ('talent.search_max_depth',           '500',                '{"type":"integer"}',                              'Max results reachable by paging'),
 ('talent.daily_unlock_cap_per_user',  '100',                '{"type":"integer"}',                              'Hard cap regardless of credits'),
 ('talent.daily_resume_download_cap_per_user','20',          '{"type":"integer"}',                              'Resume downloads per user per day'),
 ('talent.require_verification_for_unlock','true',           '{"type":"boolean"}',                              'Unverified employers cannot unlock'),
 ('jobs.auto_approve_verified_employers','true',             '{"type":"boolean"}',                              'Skip moderation for verified, unflagged employers'),
 ('contact_requests.expiry_days',      '14',                 '{"type":"integer"}',                              'Pending contact requests expire after N days');
