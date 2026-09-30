import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { EnvironmentProviders, Provider, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, Routes, withComponentInputBinding, withInMemoryScrolling, withRouterConfig } from '@angular/router';
import { APP_AUDIENCE, Audience } from './api';
import { AuthService } from './auth';
import { authInterceptor } from './http';

/** Shared bootstrap for all four apps: HTTP + auth restore + router conventions. */
export function provideGenZHire(audience: Audience, routes: Routes): (Provider | EnvironmentProviders)[] {
  return [
    provideBrowserGlobalErrorListeners(),
    { provide: APP_AUDIENCE, useValue: audience },
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    provideAppInitializer(() => inject(AuthService).restore()),
  ];
}
