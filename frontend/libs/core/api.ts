import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Audience = 'jobseeker' | 'employer' | 'recruiter' | 'admin';

/** Which application this bundle is — drives the auth endpoints and refresh cookie. */
export const APP_AUDIENCE = new InjectionToken<Audience>('APP_AUDIENCE');

export const API_BASE = '/api/v1';

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** RFC 9457 problem details from the API, as a typed error. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly errors: FieldError[] = [],
    public readonly requestId?: string,
  ) {
    super(message);
  }

  static from(e: unknown): ApiError {
    if (e instanceof ApiError) return e;
    if (e instanceof HttpErrorResponse) {
      const b = e.error && typeof e.error === 'object' ? e.error : {};
      if (e.status === 0) return new ApiError(0, 'NETWORK', 'You appear to be offline. Check your connection and try again.');
      return new ApiError(e.status, b.code ?? 'HTTP_ERROR', b.title ?? e.statusText ?? 'Request failed', b.errors ?? [], b.requestId);
    }
    return new ApiError(0, 'UNKNOWN', (e as Error)?.message ?? 'Something went wrong');
  }

  /** First validation message for a field (errors[].field is the DTO property). */
  fieldMessage(field: string): string | undefined {
    return this.errors.find((x) => x.field === field)?.message;
  }
}

export interface Page<T> {
  data: T[];
  page: { nextCursor: string | null; limit: number };
  totalEstimate?: number;
}

type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

function toParams(p?: Params) {
  let hp = new HttpParams();
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    hp = hp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return hp;
}

/** Promise-based wrapper so components can use async/await with signals. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  private async run<T>(o: Promise<T>): Promise<T> {
    try {
      return await o;
    } catch (e) {
      throw ApiError.from(e);
    }
  }

  get<T>(path: string, params?: Params) {
    return this.run(firstValueFrom(this.http.get<T>(API_BASE + path, { params: toParams(params) })));
  }
  post<T>(path: string, body: unknown = {}) {
    return this.run(firstValueFrom(this.http.post<T>(API_BASE + path, body)));
  }
  patch<T>(path: string, body: unknown) {
    return this.run(firstValueFrom(this.http.patch<T>(API_BASE + path, body)));
  }
  put<T>(path: string, body: unknown = {}) {
    return this.run(firstValueFrom(this.http.put<T>(API_BASE + path, body)));
  }
  delete<T = void>(path: string) {
    return this.run(firstValueFrom(this.http.delete<T>(API_BASE + path)));
  }

  upload(file: File, purpose: 'RESUME' | 'PROFILE_PHOTO' | 'COMPANY_LOGO' | 'VERIFICATION_DOC' | 'CERTIFICATE') {
    const fd = new FormData();
    fd.append('purpose', purpose);
    fd.append('file', file, file.name);
    return this.run(firstValueFrom(this.http.post<UploadedFile>(API_BASE + '/files', fd)));
  }

  /** Fetches a protected file (auth header attached by the interceptor) and saves it. */
  async download(path: string, fallbackName = 'download') {
    const res = await this.run(firstValueFrom(this.http.get(API_BASE + path, { observe: 'response', responseType: 'blob' })));
    const cd = res.headers.get('Content-Disposition') ?? '';
    const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(res.body!);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export interface UploadedFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: string;
}
