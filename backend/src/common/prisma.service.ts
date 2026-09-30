import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Interactive transaction with timeouts suited to the Supabase pooler round-trip. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(fn, { maxWait: 10_000, timeout: 20_000 });
  }
}
