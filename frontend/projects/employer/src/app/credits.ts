import { Injectable, inject, signal } from '@angular/core';
import { Api } from '@gh/core';

/** Profile-view credit balance shared by the top bar and the pages that spend credits. */
@Injectable({ providedIn: 'root' })
export class CreditsState {
  private readonly api = inject(Api);
  readonly credits = signal<{ remaining: number; total: number } | null>(null);

  async refresh() {
    this.credits.set(await this.api.get<{ remaining: number; total: number }>('/employer/entitlements/summary').catch(() => null));
  }

  /** Apply a balance returned by an unlock response without another round trip. */
  setRemaining(remaining: number | null | undefined) {
    const c = this.credits();
    if (c && typeof remaining === 'number') this.credits.set({ ...c, remaining });
  }
}
