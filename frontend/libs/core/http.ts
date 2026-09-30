import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { API_BASE } from './api';
import { AuthService } from './auth';

const isAuthCall = (url: string) => /\/auth\/[a-z]+\/(login|refresh|logout)$/.test(url);

function withHeaders(req: HttpRequest<unknown>, token: string | null) {
  if (!req.url.startsWith(API_BASE)) return req;
  let headers = req.headers.set('X-Requested-With', 'genzhire');
  if (token && !isAuthCall(req.url)) headers = headers.set('Authorization', `Bearer ${token}`);
  return req.clone({ headers, withCredentials: isAuthCall(req.url) });
}

/**
 * Attaches the bearer token + CSRF header; on 401 performs one silent refresh
 * and retries once. A second 401 ends the session.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(withHeaders(req, auth.accessToken)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || isAuthCall(req.url) || !req.url.startsWith(API_BASE)) {
        return throwError(() => err);
      }
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            auth.expire();
            return throwError(() => err);
          }
          return next(withHeaders(req, auth.accessToken));
        }),
      );
    }),
  );
};
