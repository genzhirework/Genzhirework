import { HttpClient } from '@angular/common/http';
import { computed, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE, APP_AUDIENCE, ApiError } from './api';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  app: string;
  roles: string[];
  permissions: string[];
  employerId: string | null;
  companyRole: string | null;
  candidateId: string | null;
  recruiterId: string | null;
  emailVerified: boolean;
}

interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

/**
 * Access token lives only in memory (never localStorage — docs/13-security.md §3).
 * The refresh token is an HttpOnly cookie the browser sends to /api/v1/auth/<app>/refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly app = inject(APP_AUDIENCE);

  private token: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  readonly user = signal<SessionUser | null>(null);
  readonly ready = signal(false);
  readonly signedIn = computed(() => !!this.user());
  readonly firstName = computed(() => (this.user()?.fullName ?? this.user()?.email ?? '').split(/[ @]/)[0]);

  get accessToken() {
    return this.token;
  }

  hasPermission(p: string) {
    return this.user()?.permissions.includes(p) ?? false;
  }

  /** Called once at startup: silently resumes a session from the refresh cookie. */
  async restore() {
    await this.refresh();
    this.ready.set(true);
  }

  async login(email: string, password: string) {
    try {
      const r = await firstValueFrom(this.http.post<SessionResponse>(`${API_BASE}/auth/${this.app}/login`, { email, password }));
      this.set(r);
      return r.user;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  /** Single-flight: concurrent 401s share one refresh request. */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = firstValueFrom(this.http.post<SessionResponse>(`${API_BASE}/auth/${this.app}/refresh`, {}))
        .then((r) => {
          this.set(r);
          return true;
        })
        .catch(() => {
          this.clear();
          return false;
        })
        .finally(() => (this.refreshing = null));
    }
    return this.refreshing;
  }

  async logout() {
    try {
      await firstValueFrom(this.http.post(`${API_BASE}/auth/${this.app}/logout`, {}));
    } catch {
      /* session may already be gone */
    }
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  async logoutAll() {
    await firstValueFrom(this.http.post(`${API_BASE}/auth/logout-all`, {}));
    this.clear();
    await this.router.navigateByUrl('/login');
  }

  /** Session ended server-side (expired / revoked) — send the user to sign in. */
  expire() {
    this.clear();
    const returnUrl = this.router.url;
    void this.router.navigate(['/login'], { queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {} });
  }

  private set(r: SessionResponse) {
    this.token = r.accessToken;
    this.user.set(r.user);
  }

  clear() {
    this.token = null;
    this.user.set(null);
  }
}
