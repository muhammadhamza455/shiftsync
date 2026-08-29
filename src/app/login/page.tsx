import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { LoginForm } from './login-form';
import { Card, CardBody } from '@/components/ui';

export const metadata = { title: 'Sign in — ShiftSync' };

const DEMO_DOMAIN = '@coastaleats.com';
const DEMO_PASSWORD = 'Coastal2026!';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  const demoAccounts = await db.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN }, isActive: true },
    select: {
      email: true,
      name: true,
      role: true,
      managedLocations: { select: { location: { select: { name: true } } } },
      certifications: {
        where: { revokedAt: null },
        select: { location: { select: { name: true } } },
      },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  const byRole = {
    ADMIN: demoAccounts.filter((a) => a.role === 'ADMIN'),
    MANAGER: demoAccounts.filter((a) => a.role === 'MANAGER'),
    STAFF: demoAccounts.filter((a) => a.role === 'STAFF'),
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-8 px-5 py-10 lg:flex-row lg:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">
            Coastal Eats
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            ShiftSync
          </h1>
          <p className="mt-2 text-sm text-muted">
            Scheduling across four locations and two timezones.
          </p>
        </div>
        <Card>
          <CardBody>
            <LoginForm />
          </CardBody>
        </Card>
        <p className="mt-4 text-xs text-muted">
          Every demo account uses the password{' '}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono">
            {DEMO_PASSWORD}
          </code>
        </p>
      </div>

      {demoAccounts.length > 0 ? (
        <div className="w-full max-w-md">
          <Card>
            <div className="border-b border-line px-5 py-4">
              <h2 className="text-sm font-semibold">Seeded accounts</h2>
              <p className="mt-0.5 text-sm text-muted">
                Pick one to fill the form. Each role sees a different app.
              </p>
            </div>
            <CardBody className="max-h-[26rem] space-y-4 overflow-y-auto">
              {(['ADMIN', 'MANAGER', 'STAFF'] as const).map((role) =>
                byRole[role].length ? (
                  <div key={role}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {role === 'ADMIN'
                        ? 'Admin — sees every location'
                        : role === 'MANAGER'
                          ? 'Managers — scoped to their locations'
                          : 'Staff'}
                    </p>
                    <ul className="space-y-1">
                      {byRole[role].map((account) => {
                        const scope =
                          role === 'MANAGER'
                            ? account.managedLocations
                                .map((m) => m.location.name.replace('Coastal Eats — ', ''))
                                .join(', ')
                            : role === 'STAFF'
                              ? account.certifications
                                  .map((c) => c.location.name.replace('Coastal Eats — ', ''))
                                  .join(', ')
                              : 'All locations';
                        return (
                          <li key={account.email}>
                            <Link
                              href={`/login?email=${encodeURIComponent(account.email)}`}
                              scroll={false}
                              className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                            >
                              <span className="font-medium">{account.name}</span>
                              <span className="truncate text-xs text-muted">
                                {scope || '—'}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null,
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
