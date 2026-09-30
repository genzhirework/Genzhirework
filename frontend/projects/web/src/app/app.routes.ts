import { Routes } from '@angular/router';
import { authGuard, guestGuard } from '@gh/core';
import { SiteLayoutComponent } from './layout';

export const routes: Routes = [
  {
    path: '',
    component: SiteLayoutComponent,
    children: [
      { path: '', title: 'GenZHire — Find your next opportunity', loadComponent: () => import('./pages/home').then((m) => m.HomePage) },
      { path: 'jobs', title: 'Jobs for freshers | GenZHire', loadComponent: () => import('./pages/jobs').then((m) => m.JobsPage) },
      { path: 'jobs/:id', title: 'Job details | GenZHire', loadComponent: () => import('./pages/job-detail').then((m) => m.JobDetailPage) },
      { path: 'login', title: 'Sign in | GenZHire', canActivate: [guestGuard], loadComponent: () => import('./pages/auth').then((m) => m.LoginPage) },
      { path: 'register', title: 'Create your profile | GenZHire', canActivate: [guestGuard], loadComponent: () => import('./pages/auth').then((m) => m.RegisterPage) },
      { path: 'verify-email', title: 'Verify email | GenZHire', loadComponent: () => import('./pages/auth').then((m) => m.VerifyEmailPage) },
      { path: 'forgot-password', title: 'Reset password | GenZHire', loadComponent: () => import('./pages/auth').then((m) => m.ForgotPasswordPage) },
      { path: 'reset-password', title: 'Reset password | GenZHire', loadComponent: () => import('./pages/auth').then((m) => m.ResetPasswordPage) },
      { path: 'legal/:doc', title: 'Legal | GenZHire', loadComponent: () => import('./pages/settings').then((m) => m.LegalPage) },
      { path: 'onboarding', title: 'Set up your profile | GenZHire', canActivate: [authGuard], loadComponent: () => import('./pages/onboarding').then((m) => m.OnboardingPage) },
      {
        path: 'app',
        canActivate: [authGuard],
        children: [
          { path: '', title: 'Home | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.DashboardPage) },
          { path: 'applications', title: 'Applications | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.ApplicationsPage) },
          { path: 'applications/:id', title: 'Application | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.ApplicationDetailPage) },
          { path: 'saved-jobs', title: 'Saved jobs | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.SavedJobsPage) },
          { path: 'notifications', title: 'Notifications | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.NotificationsPage) },
          { path: 'contact-requests', title: 'Contact requests | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.ContactRequestsPage) },
          { path: 'more', title: 'More | GenZHire', loadComponent: () => import('./pages/app-pages').then((m) => m.MorePage) },
          { path: 'profile', title: 'My profile | GenZHire', loadComponent: () => import('./pages/profile').then((m) => m.ProfilePage) },
          { path: 'profile/preview', title: 'Profile preview | GenZHire', loadComponent: () => import('./pages/profile').then((m) => m.ProfilePreviewPage) },
          { path: 'resume', title: 'Resume | GenZHire', loadComponent: () => import('./pages/settings').then((m) => m.ResumePage) },
          { path: 'settings', title: 'Settings | GenZHire', loadComponent: () => import('./pages/settings').then((m) => m.SettingsPage) },
          { path: 'settings/privacy', title: 'Privacy | GenZHire', loadComponent: () => import('./pages/settings').then((m) => m.PrivacyPage) },
        ],
      },
      { path: '**', title: 'Not found | GenZHire', loadComponent: () => import('./pages/settings').then((m) => m.NotFoundPage) },
    ],
  },
];
