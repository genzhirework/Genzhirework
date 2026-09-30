import { signal, WritableSignal } from '@angular/core';
import { ApiError } from './api';

export type LoadStatus = 'loading' | 'ready' | 'empty' | 'error' | 'forbidden' | 'notfound';

export interface Loader<T> {
  data: WritableSignal<T | undefined>;
  status: WritableSignal<LoadStatus>;
  error: WritableSignal<ApiError | null>;
  reload: () => Promise<void>;
}

/**
 * Async page state as signals (zoneless-safe). Every routed page renders through
 * <gh-page-state>, so loading / empty / error / 403 / 404 are never forgotten.
 */
export function loader<T>(fetch: () => Promise<T>, isEmpty?: (d: T) => boolean): Loader<T> {
  const data = signal<T | undefined>(undefined);
  const status = signal<LoadStatus>('loading');
  const error = signal<ApiError | null>(null);
  let seq = 0;

  const reload = async () => {
    const mine = ++seq;
    if (data() === undefined) status.set('loading');
    try {
      const d = await fetch();
      if (mine !== seq) return;
      data.set(d);
      error.set(null);
      status.set(isEmpty?.(d) ? 'empty' : 'ready');
    } catch (e) {
      if (mine !== seq) return;
      const err = ApiError.from(e);
      error.set(err);
      status.set(err.status === 403 ? 'forbidden' : err.status === 404 ? 'notfound' : 'error');
    }
  };

  // Deferred one microtask: router-bound inputs (e.g. :id) are set right after construction.
  queueMicrotask(() => void reload());
  return { data, status, error, reload };
}

export const isEmptyArray = (d: unknown) => Array.isArray(d) && d.length === 0;
export const isEmptyPage = (d: { data: unknown[] }) => d.data.length === 0;
