import { Pipe, PipeTransform } from '@angular/core';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export interface StatusDef {
  label: string;
  tone: Tone;
  candidateLabel?: string;
}

/** One status vocabulary shared by every app (docs/10-design-system.md §7). */
export const STATUS: Record<string, Record<string, StatusDef>> = {
  application: {
    APPLIED: { label: 'Applied', tone: 'neutral' },
    VIEWED: { label: 'Viewed', tone: 'neutral' },
    SCREENING: { label: 'Screening', tone: 'primary', candidateLabel: 'In review' },
    SHORTLISTED: { label: 'Shortlisted', tone: 'primary' },
    INTERVIEW: { label: 'Interview', tone: 'warning' },
    SELECTED: { label: 'Selected', tone: 'success' },
    REJECTED: { label: 'Rejected', tone: 'danger', candidateLabel: 'Not selected' },
    WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
  },
  job: {
    DRAFT: { label: 'Draft', tone: 'neutral' },
    PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
    PUBLISHED: { label: 'Published', tone: 'success' },
    PAUSED: { label: 'Paused', tone: 'neutral' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
    REJECTED: { label: 'Rejected', tone: 'danger' },
  },
  verification: {
    PENDING: { label: 'Not verified', tone: 'warning' },
    VERIFIED: { label: 'Verified', tone: 'success' },
    REJECTED: { label: 'Rejected', tone: 'danger' },
    SUSPENDED: { label: 'Suspended', tone: 'danger' },
    SUBMITTED: { label: 'Submitted', tone: 'primary' },
    IN_REVIEW: { label: 'In review', tone: 'primary' },
    NEEDS_INFO: { label: 'Needs info', tone: 'warning' },
    APPROVED: { label: 'Approved', tone: 'success' },
  },
  requirement: {
    DRAFT: { label: 'Draft', tone: 'neutral' },
    SUBMITTED: { label: 'Submitted', tone: 'warning' },
    UNDER_REVIEW: { label: 'Under review', tone: 'primary' },
    ACTIVE: { label: 'Active', tone: 'success' },
    ON_HOLD: { label: 'On hold', tone: 'neutral' },
    FILLED: { label: 'Filled', tone: 'success' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  case: {
    OPEN: { label: 'Open', tone: 'success' },
    ON_HOLD: { label: 'On hold', tone: 'neutral' },
    FILLED: { label: 'Filled', tone: 'primary' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  tracking: {
    AWAITING_CONFIRMATION: { label: 'Awaiting confirmation', tone: 'warning' },
    TRACKING: { label: 'Tracking', tone: 'primary' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    LEFT_EARLY: { label: 'Left early', tone: 'danger' },
    DISPUTED: { label: 'Disputed', tone: 'danger' },
  },
  billing: {
    PENDING_TRIGGER: { label: 'Pending 90 days', tone: 'neutral' },
    BILLABLE: { label: 'Billable', tone: 'warning' },
    INVOICED: { label: 'Invoiced', tone: 'primary' },
    PAID: { label: 'Paid', tone: 'success' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
    WAIVED: { label: 'Waived', tone: 'neutral' },
    DISPUTED: { label: 'Disputed', tone: 'danger' },
  },
  user: {
    ACTIVE: { label: 'Active', tone: 'success' },
    PENDING_VERIFICATION: { label: 'Unverified email', tone: 'warning' },
    SUSPENDED: { label: 'Suspended', tone: 'danger' },
    DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
    PENDING_DELETION: { label: 'Deletion pending', tone: 'warning' },
    DELETED: { label: 'Deleted', tone: 'neutral' },
    CLOSED: { label: 'Closed', tone: 'neutral' },
  },
  contact: {
    PENDING: { label: 'Pending', tone: 'warning' },
    ACCEPTED: { label: 'Accepted', tone: 'success' },
    DECLINED: { label: 'Declined', tone: 'neutral' },
    EXPIRED: { label: 'Expired', tone: 'neutral' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  interview: {
    SCHEDULED: { label: 'Scheduled', tone: 'primary' },
    RESCHEDULED: { label: 'Rescheduled', tone: 'warning' },
    COMPLETED: { label: 'Completed', tone: 'success' },
    NO_SHOW: { label: 'No-show', tone: 'danger' },
    CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  },
  alert: {
    OPEN: { label: 'Open', tone: 'danger' },
    ACKNOWLEDGED: { label: 'Acknowledged', tone: 'warning' },
    RESOLVED: { label: 'Resolved', tone: 'success' },
    FALSE_POSITIVE: { label: 'False positive', tone: 'neutral' },
    INVESTIGATING: { label: 'Investigating', tone: 'warning' },
    ACTIONED: { label: 'Actioned', tone: 'success' },
    DISMISSED: { label: 'Dismissed', tone: 'neutral' },
  },
};

export function statusOf(kind: string, value: string | null | undefined, audience?: 'candidate'): StatusDef {
  const def = value ? STATUS[kind]?.[value] : undefined;
  if (!def) return { label: humanize(value), tone: 'neutral' };
  return audience === 'candidate' && def.candidateLabel ? { ...def, label: def.candidateLabel } : def;
}

const LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERNSHIP: 'Internship', CONTRACT: 'Contract', APPRENTICESHIP: 'Apprenticeship', FREELANCE: 'Freelance',
  ONSITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote',
  SECONDARY: '10th', HIGHER_SECONDARY: '12th', DIPLOMA: 'Diploma', UG: 'Graduate (UG)', PG: 'Postgraduate (PG)', DOCTORATE: 'Doctorate', CERTIFICATE_PROGRAM: 'Certificate program',
  IMMEDIATE: 'Immediate', WITHIN_15_DAYS: 'Within 15 days', WITHIN_30_DAYS: 'Within 30 days', WITHIN_60_DAYS: 'Within 60 days', AFTER_GRADUATION: 'After graduation', FLEXIBLE: 'Flexible',
  STUDENT: 'Student', FRESHER: 'Fresher', EMPLOYED: 'Employed', INTERNING: 'Interning', BETWEEN_JOBS: 'Between jobs',
  PUBLIC: 'Public', EMPLOYER_VISIBLE: 'Visible to verified employers', APPLICATION_ONLY: 'Only employers I apply to', HIDDEN: 'Hidden',
  DATABASE: 'Candidate database', CONSULTANT: 'HR consultant', BOTH: 'Both',
  CGPA_10: 'CGPA (10)', CGPA_4: 'CGPA (4)', PERCENTAGE: '%',
  IN_PERSON: 'In person', VIDEO: 'Video', PHONE: 'Phone',
  FULL_PROFILE_VIEW: 'Profile view', RESUME_DOWNLOAD: 'Resume download', CONTACT_REVEAL: 'Contact reveal', PROFILE_SHARED: 'Shared',
  CREDIT: 'Credit used', ACTIVE_UNLOCK: 'Already unlocked', APPLICATION: 'Applied', RECRUITER_SUBMISSION: 'Recruiter submission',
  RECRUITER_CASE: 'Recruiter case', CONTACT_ACCEPTED: 'Contact accepted', ADMIN: 'Admin',
  CANDIDATE_PROFILE_VIEW: 'Profile views', FREE_ON_VERIFICATION: 'Free on verification', ADMIN_GRANT: 'Granted by GenZHire', SUBSCRIPTION: 'Subscription', PROMOTION: 'Promotion',
  GRANT: 'Granted', CONSUME: 'Used', REFUND: 'Refunded', ADJUST: 'Adjusted', EXPIRE: 'Expired',
  GSTIN: 'GSTIN', CIN: 'CIN', LLPIN: 'LLPIN', UDYAM: 'Udyam', SHOP_ESTABLISHMENT: 'Shop & Establishment', OTHER: 'Other',
  COMPANY_ADMIN: 'Company admin', HR_MANAGER: 'HR manager', COMPANY_RECRUITER: 'Recruiter', VIEWER: 'Viewer',
  JOBSEEKER: 'Jobseeker', EMPLOYER: 'Employer', RECRUITER: 'Recruiter',
  '1_10': '1–10', '11_50': '11–50', '51_200': '51–200', '201_500': '201–500', '501_1000': '501–1,000', '1001_5000': '1,001–5,000', '5000_PLUS': '5,000+',
  FAKE_JOB: 'Fake job', SCAM_PAYMENT_REQUEST: 'Asked for payment', SPAM: 'Spam', HARASSMENT: 'Harassment', DISCRIMINATION: 'Discrimination', MISLEADING: 'Misleading',
  REFERRAL: 'Referral', EXTERNAL: 'External',
};

export function humanize(v: string | null | undefined): string {
  if (!v) return '—';
  if (LABELS[v]) return LABELS[v];
  const s = v.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(v: string | null | undefined | string[]): string {
    return Array.isArray(v) ? v.map(humanize).join(', ') : humanize(v);
  }
}

export const OPTIONS = {
  workMode: ['ONSITE', 'HYBRID', 'REMOTE'],
  employmentType: ['FULL_TIME', 'INTERNSHIP', 'PART_TIME', 'CONTRACT', 'APPRENTICESHIP'],
  educationLevel: ['UG', 'PG', 'DIPLOMA', 'HIGHER_SECONDARY', 'SECONDARY', 'DOCTORATE', 'CERTIFICATE_PROGRAM'],
  availability: ['IMMEDIATE', 'WITHIN_15_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'AFTER_GRADUATION'],
  employmentStatus: ['FRESHER', 'STUDENT', 'INTERNING', 'EMPLOYED', 'BETWEEN_JOBS'],
  joiningTimeline: ['IMMEDIATE', 'WITHIN_15_DAYS', 'WITHIN_30_DAYS', 'WITHIN_60_DAYS', 'FLEXIBLE'],
  sizeBand: ['1_10', '11_50', '51_200', '201_500', '501_1000', '1001_5000', '5000_PLUS'],
  registrationType: ['GSTIN', 'CIN', 'LLPIN', 'UDYAM', 'SHOP_ESTABLISHMENT', 'OTHER'],
  reportReason: ['FAKE_JOB', 'SCAM_PAYMENT_REQUEST', 'SPAM', 'MISLEADING', 'DISCRIMINATION', 'HARASSMENT', 'OTHER'],
  states: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
    'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
    'Uttarakhand', 'West Bengal', 'Chandigarh', 'Ladakh', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep',
  ],
  cities: ['Bengaluru', 'Chennai', 'Hyderabad', 'Pune', 'Mumbai', 'Delhi', 'Noida', 'Gurugram', 'Kolkata', 'Ahmedabad', 'Coimbatore', 'Kochi', 'Jaipur', 'Chandigarh', 'Indore', 'Lucknow', 'Bhubaneswar', 'Visakhapatnam', 'Nagpur', 'Mysuru', 'Trivandrum', 'Madurai'],
};
