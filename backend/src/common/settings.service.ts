import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Business rules read their numbers from system_settings, never from code or
 * env (docs/06-business-rules.md). Cached for 60 s; cleared on admin change.
 */
@Injectable()
export class SettingsService {
  private cache: { at: number; values: Map<string, unknown> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async all() {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.values;
    const rows = await this.prisma.system_settings.findMany();
    const values = new Map(rows.map((r) => [r.key, r.value as unknown]));
    this.cache = { at: Date.now(), values };
    return values;
  }

  async get<T>(key: string): Promise<T> {
    const v = (await this.all()).get(key);
    if (v === undefined) throw new Error(`Missing system setting: ${key}`);
    return v as T;
  }

  num = (key: string) => this.get<number>(key).then(Number);
  bool = (key: string) => this.get<boolean>(key).then(Boolean);
  str = (key: string) => this.get<string>(key).then(String);

  invalidate() {
    this.cache = null;
  }
}
