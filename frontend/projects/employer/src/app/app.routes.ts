import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@gh/core';
import { EmployerShell } from './shell';

const t = (s: string) => `${s} | GenZHire for Employers`;

export const routes: Routes = [
  { path: 'login', title: t('Sign in'), canActivate: [guestGuard], loadComponent: () => import('./pages/auth').then((m) => m.LoginPage) },
  { path: 'register', title: t('Create account'), canActivate: [guestGuard], loadComponent: () => import('./pages/auth').then((m) => m.RegisterPage) },
  {
    path: '',
    component: EmployerShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: t('Dashboard'), loadComponent: () => import('./pages/dashboard').then((m) => m.DashboardPage) },
      { path: 'jobs', title: t('Jobs'), loadComponent: () => import('./pages/jobs').then((m) => m.JobsPage) },
      { path: 'jobs/new', title: t('Post a job'), loadComponent: () => import('./pages/jobs').then((m) => m.JobFormPage) },
      { path: 'jobs/:id/edit', title: t('Edit job'), loadComponent: () => import('./pages/jobs').then((m) => m.JobFormPage) },
      { path: 'jobs/:id/applications', title: t('Applicants'), loadComponent: () => import('./pages/applications').then((m) => m.ApplicationsPage) },
      { path: 'applications', title: t('Applications'), loadComponent: () => import('./pages/applications').then((m) => m.ApplicationsPage) },
      { path: 'applications/:id', title: t('Applicant'), loadComponent: () => import('./pages/applications').then((m) => m.ApplicationDetailPage) },
      { path: 'talent', title: t('Find talent'), loadComponent: () => import('./pages/talent').then((m) => m.TalentPage) },
      { path: 'talent/candidates/:id', title: t('Candidate'), loadComponent: () => import('./pages/talent').then((m) => m.CandidatePage) },
      { path: 'saved', title: t('Saved candidates'), loadComponent: () => import('./pages/talent').then((m) => m.SavedPage) },
      { path: 'requirements', title: t('Hiring requirements'), loadComponent: () => import('./pages/account').then((m) => m.RequirementsPage) },
      { path: 'requirements/new', title: t('I need candidates'), loadComponent: () => import('./pages/account').then((m) => m.RequirementFormPage) },
      { path: 'requirements/:id', title: t('Requirement'), loadComponent: () => import('./pages/account').then((m) => m.RequirementPage) },
      { path: 'usage', title: t('Usage & credits'), loadComponent: () => import('./pages/account').then((m) => m.UsagePage) },
      { path: 'company', title: t('Company'), loadComponent: () => import('./pages/account').then((m) => m.CompanyPage), data: { tab: 'profile' } },
      { path: 'company/verification', title: t('Verification'), loadComponent: () => import('./pages/account').then((m) => m.CompanyPage), data: { tab: 'verification' } },
      { path: 'company/team', title: t('Team'), loadComponent: () => import('./pages/account').then((m) => m.CompanyPage), data: { tab: 'team' } },
      { path: 'settings', title: t('Settings'), loadComponent: () => import('./pages/account').then((m) => m.SettingsPage) },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
