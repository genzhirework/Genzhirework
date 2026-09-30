import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@gh/core';
import { RecruiterShell } from './pages';

const t = (s: string) => `${s} | GenZHire Recruiter`;

export const routes: Routes = [
  { path: 'login', title: t('Sign in'), canActivate: [guestGuard], loadComponent: () => import('./pages').then((m) => m.LoginPage) },
  {
    path: '',
    component: RecruiterShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: t('Dashboard'), loadComponent: () => import('./pages').then((m) => m.DashboardPage) },
      { path: 'requirements', title: t('Requirements'), loadComponent: () => import('./pages').then((m) => m.CasesPage) },
      { path: 'requirements/:id', title: t('Case'), loadComponent: () => import('./pages').then((m) => m.CasePage) },
      { path: 'pipeline/:id', title: t('Candidate'), loadComponent: () => import('./pages').then((m) => m.PipelineCandidatePage) },
      { path: 'candidates', title: t('Find candidates'), loadComponent: () => import('./pages').then((m) => m.FindPage) },
      { path: 'interviews', title: t('Interviews'), loadComponent: () => import('./pages').then((m) => m.InterviewsPage) },
      { path: 'tracking', title: t('90-day tracking'), loadComponent: () => import('./pages').then((m) => m.TrackingPage) },
      { path: 'billing', title: t('Billing'), loadComponent: () => import('./pages').then((m) => m.BillingPage) },
      { path: 'settings', title: t('Settings'), loadComponent: () => import('./pages').then((m) => m.SettingsPage) },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
