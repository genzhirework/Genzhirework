import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth';

/** UX-only gate: the API enforces every permission server-side. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.signedIn()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  if (!auth.signedIn()) return true;
  const target = (route.queryParamMap.get('returnUrl') ?? '').startsWith('/') ? route.queryParamMap.get('returnUrl')! : '/';
  return inject(Router).parseUrl(target);
};
