# D. Database ER Diagram

The full column definitions are in [05-schema.sql](05-schema.sql). The model is split into one diagram per bounded context so each stays readable. Tables that appear in more than one diagram are shown with key columns only.

## 1. Identity & access

```mermaid
erDiagram
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : assigned
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : in
  users ||--o{ sessions : "logs in (per app)"
  users ||--o{ login_history : attempts
  users ||--o{ verification_tokens : receives
  users ||--o{ mfa_recovery_codes : holds
  users ||--o{ policy_acceptances : accepts
  policy_documents ||--o{ policy_acceptances : "version of"
  users {
    uuid id PK
    citext email UK
    text status
    bool mfa_enabled
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text app
    bytea refresh_token_hash UK
    timestamptz revoked_at
  }
```

## 2. Candidate

```mermaid
erDiagram
  users ||--o| candidates : "is (JOBSEEKER)"
  candidates ||--|| candidate_profiles : "professional data"
  candidates ||--|| candidate_visibility : controls
  candidates ||--o{ candidate_education : has
  candidates ||--o{ candidate_experience : has
  candidates ||--o{ candidate_skills : has
  skills ||--o{ candidate_skills : tagged
  candidates ||--o{ candidate_projects : has
  candidates ||--o{ candidate_certifications : has
  candidates ||--o{ resumes : uploads
  files ||--o| resumes : stores
  candidates ||--o{ candidate_consents : "grants/withdraws"
  candidates ||--o{ candidate_blocked_employers : blocks
  employers ||--o{ candidate_blocked_employers : "blocked by"
  candidates ||--|| candidate_search_documents : "indexed as"
  candidates {
    uuid id PK
    uuid user_id FK
    text first_name
    text contact_phone_e164 "PROTECTED"
    bool is_honeytoken
  }
  candidate_visibility {
    uuid candidate_id PK
    text level "PUBLIC|EMPLOYER_VISIBLE|APPLICATION_ONLY|HIDDEN"
  }
```

## 3. Employer, jobs & applications

```mermaid
erDiagram
  employers ||--o{ companies : "brands (1 today)"
  employers ||--o{ employer_users : members
  users ||--o{ employer_users : "works at"
  employers ||--o{ employer_verification : submits
  employers ||--o{ jobs : owns
  companies ||--o{ jobs : "shown as"
  jobs ||--o{ job_locations : at
  jobs ||--o{ job_skills : requires
  skills ||--o{ job_skills : tagged
  candidates ||--o{ saved_jobs : saves
  jobs ||--o{ saved_jobs : saved
  jobs ||--o{ applications : receives
  candidates ||--o{ applications : submits
  resumes ||--o{ applications : attached
  applications ||--o{ application_status_history : transitions
  applications ||--o{ interviews : "may have"
  employers {
    uuid id PK
    text verification_status
    citext primary_domain UK
  }
  jobs {
    uuid id PK
    uuid employer_id FK
    text status
    tsvector search_vector
  }
  applications {
    uuid id PK
    uuid job_id FK
    uuid candidate_id FK
    text status
    jsonb profile_snapshot
  }
```

## 4. Talent database & entitlements

```mermaid
erDiagram
  employers ||--o{ employer_entitlements : "credit buckets"
  subscriptions ||--o{ employer_entitlements : funds
  employer_entitlements ||--o{ entitlement_ledger : "movements"
  employers ||--o{ profile_unlocks : unlocks
  candidates ||--o{ profile_unlocks : "unlocked by"
  entitlement_ledger ||--o| profile_unlocks : "paid by"
  employers ||--o{ candidate_profile_views : "access log"
  candidates ||--o{ candidate_profile_views : "accessed"
  employers ||--o{ candidate_folders : organises
  candidate_folders ||--o{ saved_candidates : contains
  candidates ||--o{ saved_candidates : saved
  employers ||--o{ candidate_notes : writes
  employers ||--o{ contact_requests : sends
  candidates ||--o{ contact_requests : receives
  employer_entitlements {
    uuid id PK
    text entitlement_type
    int total_quantity
    int used_quantity
    int remaining_quantity "GENERATED"
    timestamptz valid_until
  }
  profile_unlocks {
    uuid employer_id UK
    uuid candidate_id UK
    text unlock_type UK
    timestamptz expires_at
  }
  candidate_profile_views {
    bigint id PK
    text action
    text access_basis
    smallint credits_consumed
  }
```

## 5. Recruitment & billing

```mermaid
erDiagram
  employers ||--o{ hiring_requirements : raises
  hiring_requirements ||--o{ hiring_requirement_skills : requires
  hiring_requirements ||--o| recruitment_cases : "becomes (consultant mode)"
  employers ||--o{ recruitment_agreements : signs
  recruitment_agreements ||--o{ recruitment_cases : governs
  recruitment_cases ||--o{ recruitment_case_assignments : staffed
  recruiters ||--o{ recruitment_case_assignments : works
  users ||--o| recruiters : "is (RECRUITER)"
  recruitment_cases ||--o{ recruitment_candidates : pipeline
  candidates ||--o{ recruitment_candidates : "placed in"
  pipeline_stages ||--o{ recruitment_candidates : "current stage"
  recruitment_candidates ||--o{ recruitment_stage_history : moves
  recruitment_candidates ||--o{ interviews : attends
  recruitment_candidates ||--o{ offers : receives
  recruitment_candidates ||--o| candidate_joinings : joins
  candidate_joinings ||--o{ joining_reminders : schedules
  candidate_joinings ||--|| consultant_billing : triggers
  consultant_billing ||--o| invoice_lines : "billed on"
  invoices ||--o{ invoice_lines : contains
  invoices ||--o{ payments : settled
  candidate_joinings {
    date joining_date
    smallint payment_trigger_days "snapshot"
    date billing_due_date "GENERATED"
    text tracking_status
  }
  consultant_billing {
    bigint annual_ctc_paise
    numeric fee_percentage "snapshot"
    bigint fee_amount_paise
    text status
  }
```

## 6. Platform (cross-cutting)

```mermaid
erDiagram
  users ||--o{ notifications : receives
  notifications ||--o{ notification_deliveries : "sent via"
  users ||--o{ notification_preferences : sets
  users ||--o{ audit_logs : "acts (actor)"
  users ||--o{ abuse_reports : files
  users ||--o{ security_alerts : "subject of"
  users ||--o{ data_subject_requests : requests
  system_settings ||--o{ system_settings_history : "changed"
  outbox_events }o--|| outbox_events : "relay → queues"
```

`audit_logs`, `candidate_profile_views` and `analytics_events` are range-partitioned by month. The application's database role cannot UPDATE or DELETE rows in `audit_logs`, `candidate_profile_views`, `entitlement_ledger`, `candidate_consents`, `login_history` or `system_settings_history`.
