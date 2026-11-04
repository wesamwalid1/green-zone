import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSQL } from '@prisma/adapter-libsql';

// TURSO_DATABASE_URL switches to a hosted libSQL (SQLite-compatible) database;
// without it the local SQLite file from DATABASE_URL is used.
function clientOptions() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return {};
  return { adapter: new PrismaLibSQL({ url, authToken: process.env.TURSO_AUTH_TOKEN }) };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(clientOptions());
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
