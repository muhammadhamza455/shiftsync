import { redirect } from 'next/navigation';
import Link from 'next/link';

import { getViewer } from '@/lib/auth/session';
import { unreadCount } from '@/lib/services/notifications';
import { expireStaleDrops } from '@/lib/services/coverage';
import { RealtimeProvider } from '@/components/realtime-provider';
import { Toaster, ConnectionDot } from '@/components/toaster';
import { SideNav } from '@/components/side-nav';
import { MobileNav } from '@/components/mobile-nav';
import { NotificationBell } from '@/components/notification-bell';
import { UserMenu } from '@/components/user-menu';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  await expireStaleDrops().catch(() => 0);

  const unread = await unreadCount(viewer.id);

  return (
    <RealtimeProvider userId={viewer.id}>
      <div className="flex min-h-dvh">
        <SideNav role={viewer.role} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur sm:px-6">
            <div className="flex min-w-0 items-center gap-1">
              <MobileNav role={viewer.role} />
              <Link href="/dashboard" className="min-w-0 lg:hidden">
                <span className="truncate text-sm font-semibold tracking-tight">
                  ShiftSync
                </span>
              </Link>
            </div>
            <div className="hidden lg:block">
              <ConnectionDot />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <NotificationBell initialUnread={unread} />
              <UserMenu
                name={viewer.name}
                email={viewer.email}
                role={viewer.role}
                timezone={viewer.timezone}
              />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
      <Toaster />
    </RealtimeProvider>
  );
}
