/**
 * Role → permission matrix (docs/08-rbac.md §3). This constant is the single
 * source: the seed writes it to roles/permissions/role_permissions, and the
 * AuthGuard evaluates it. Scope (self/tenant/assigned) is enforced in services.
 */
export type Audience = 'jobseeker' | 'employer' | 'recruiter' | 'admin';

export const AUDIENCE_ROLE: Record<Audience, string> = {
  jobseeker: 'JOBSEEKER',
  employer: 'EMPLOYER',
  recruiter: 'RECRUITER',
  admin: 'ADMIN',
};

export const PERMISSIONS = {
  'candidate.profile.edit': 'Edit own candidate profile',
  'candidate.privacy.manage': 'Manage own visibility, consents and blocks',
  'candidate.applications.manage': 'Apply to jobs and manage own applications',
  'candidate.contact_requests.respond': 'Accept or decline employer contact requests',
  'jobs.manage': 'Create and manage jobs for own employer',
  'jobs.moderate': 'Approve or reject jobs',
  'applications.read': 'Read applications',
  'applications.manage': 'Change application status',
  'talent.search': 'Search the candidate database',
  'talent.view': 'View candidate previews',
  'talent.unlock': 'Unlock full candidate profiles (uses credits)',
  'talent.resume.download': 'Download candidate resumes',
  'talent.contact': 'Request or view candidate contact details',
  'talent.save': 'Save candidates and manage folders',
  'talent.note': 'Add internal notes to candidates',
  'employer.dashboard.read': 'Read employer dashboard',
  'employer.company.manage': 'Manage company profile',
  'employer.verification.submit': 'Submit employer verification',
  'employer.usage.read': 'Read credit usage',
  'requirements.manage': 'Create and manage hiring requirements',
  'recruitment.review': 'Review recruiter submissions and confirm joinings',
  'recruitment.pipeline.manage': 'Manage recruitment pipeline for assigned cases',
  'recruitment.joining.confirm': 'Confirm joinings',
  'requirements.assign': 'Open recruitment cases and assign recruiters',
  'users.read': 'Read users',
  'users.manage': 'Suspend, reactivate and manage users',
  'employer.verification.review': 'Review employer verification',
  'entitlements.manage': 'Grant and adjust employer credits',
  'billing.read': 'Read billing',
  'billing.manage': 'Manage agreements, invoices and payments',
  'audit.read': 'Read audit and access logs',
  'settings.manage': 'Manage system settings',
  'notifications.read': 'Read own notifications',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  JOBSEEKER: [
    'candidate.profile.edit',
    'candidate.privacy.manage',
    'candidate.applications.manage',
    'candidate.contact_requests.respond',
    'notifications.read',
  ],
  EMPLOYER: [
    'jobs.manage',
    'applications.read',
    'applications.manage',
    'talent.search',
    'talent.view',
    'talent.unlock',
    'talent.resume.download',
    'talent.contact',
    'talent.save',
    'talent.note',
    'employer.dashboard.read',
    'employer.company.manage',
    'employer.verification.submit',
    'employer.usage.read',
    'requirements.manage',
    'recruitment.review',
    'recruitment.joining.confirm',
    'billing.read',
    'notifications.read',
  ],
  RECRUITER: [
    'talent.search',
    'talent.view',
    'talent.resume.download',
    'talent.contact',
    'recruitment.pipeline.manage',
    'recruitment.joining.confirm',
    'billing.read',
    'notifications.read',
  ],
  ADMIN: [
    'jobs.moderate',
    'applications.read',
    'talent.search',
    'talent.view',
    'talent.resume.download',
    'requirements.assign',
    'users.read',
    'users.manage',
    'employer.verification.review',
    'entitlements.manage',
    'billing.read',
    'billing.manage',
    'audit.read',
    'settings.manage',
    'notifications.read',
  ],
};

/** Company roles narrow EMPLOYER permissions (docs/08-rbac.md §1). */
export const COMPANY_ROLE_DENY: Record<string, Permission[]> = {
  COMPANY_ADMIN: [],
  HR_MANAGER: ['employer.verification.submit'],
  COMPANY_RECRUITER: ['employer.verification.submit', 'employer.company.manage'],
  VIEWER: [
    'jobs.manage',
    'applications.manage',
    'talent.unlock',
    'talent.contact',
    'employer.company.manage',
    'employer.verification.submit',
    'requirements.manage',
    'recruitment.review',
    'recruitment.joining.confirm',
  ],
};
