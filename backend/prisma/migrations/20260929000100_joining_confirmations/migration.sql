-- 90-day tracking: the recruiter's "still employed" checkpoint (business rules §8)
ALTER TABLE candidate_joinings ADD COLUMN still_employed_confirmed_at timestamptz;
ALTER TABLE candidate_joinings ADD COLUMN still_employed_confirmed_by uuid REFERENCES users(id);
