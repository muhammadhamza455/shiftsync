import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

export const LOCK_NAMESPACE = {
  STAFF_ASSIGNMENT: 1,
  COVERAGE_REQUEST: 2,
} as const;

export async function acquireAdvisoryLock(
  tx: Pick<PrismaClient, '$executeRaw'>,
  namespace: number,
  key: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key})::int)
  `;
}
