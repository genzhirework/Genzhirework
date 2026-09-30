import type { Audience } from './api';

const DEV_PORTS: Record<Audience, number> = { jobseeker: 4200, employer: 4201, recruiter: 4202, admin: 4203 };
const SUBDOMAIN: Record<Audience, string> = { jobseeker: '', employer: 'employer.', recruiter: 'recruiter.', admin: 'admin.' };

/** Absolute URL of another GenZHire application (ports locally, subdomains in production). */
export function appUrl(app: Audience, path = '/'): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:${DEV_PORTS[app]}${path}`;
  const root = hostname.replace(/^(employer|recruiter|admin)\./, '');
  return `${protocol}//${SUBDOMAIN[app]}${root}${path}`;
}
