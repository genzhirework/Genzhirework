import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@gh/core';
import { AdminShell } from './pages/core';

const t = (s: string) => `${s} | GenZHire Admin`;

export const routes: Routes = [
  { path: 'login', title: t('Sign in'), canActivate: [guestGuard], loadComponent: () => import('./pages/core').then((m) => m.LoginPage) },
  {
    path: '',
    component: AdminShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: t('Overview'), loadComponent: () => import('./pages/core').then((m) => m.DashboardPage) },
      { path: 'users', title: t('Users'), loadComponent: () => import('./pages/people').then((m) => m.UsersPage) },
      { path: 'users/:id', title: t('User'), loadComponent: () => import('./pages/people').then((m) => m.UserPage) },
      { path: 'candidates', title: t('Candidates'), loadComponent: () => import('./pages/people').then((m) => m.CandidatesPage) },
      { path: 'candidates/:id', title: t('Candidate'), loadComponent: () => import('./pages/people').then((m) => m.CandidatePage) },
      { path: 'employers', title: t('Employers'), loadComponent: () => import('./pages/people').then((m) => m.EmployersPage) },
      { path: 'employers/:id', title: t('Employer'), loadComponent: () => import('./pages/people').then((m) => m.EmployerPage) },
      { path: 'recruiters', title: t('Recruiters'), loadComponent: () => import('./pages/people').then((m) => m.RecruitersPage) },
      { path: 'verification', title: t('Verification'), loadComponent: () => import('./pages/ops').then((m) => m.VerificationPage) },
      { path: 'jobs', title: t('Job moderation'), loadComponent: () => import('./pages/ops').then((m) => m.JobsPage) },
      { path: 'applications', title: t('Applications'), loadComponent: () => import('./pages/ops').then((m) => m.ApplicationsPage) },
      { path: 'requirements', title: t('Hiring requirements'), loadComponent: () => import('./pages/ops').then((m) => m.RequirementsPage) },
      { path: 'recruitment', title: t('Recruitment cases'), loadComponent: () => import('./pages/ops').then((m) => m.RecruitmentPage) },
      { path: 'billing', title: t('Billing'), loadComponent: () => import('./pages/ops').then((m) => m.BillingPage) },
      { path: 'access-logs', title: t('Access logs'), loadComponent: () => import('./pages/ops').then((m) => m.AccessLogsPage) },
      { path: 'audit-logs', title: t('Audit log'), loadComponent: () => import('./pages/ops').then((m) => m.AuditLogsPage) },
      { path: 'security', title: t('Trust & safety'), loadComponent: () => import('./pages/ops').then((m) => m.SecurityPage) },
      { path: 'system', title: t('System settings'), loadComponent: () => import('./pages/ops').then((m) => m.SystemPage) },
      { path: 'settings', title: t('Account'), loadComponent: () => import('./pages/core').then((m) => m.AccountPage) },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
