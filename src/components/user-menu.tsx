'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { signOutAction } from '@/app/(app)/actions';
import { Badge, cn } from './ui';
import { ConnectionDot } from './toaster';
import { initials } from '@/lib/format';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
};

export function UserMenu({
  name,
  email,
  role,
  timezone,
}: {
  name: string;
  email: string;
  role: Role;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-muted',
          open && 'bg-surface-muted',
        )}
      >
        <span className="grid size-7 place-items-center rounded-full bg-brand text-[11px] font-semibold text-white dark:text-[#08211f]">
          {initials(name)}
        </span>
        <span className="hidden text-sm font-medium sm:block">{name}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-slide-in absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
            <div className="mt-2 flex items-center gap-2">
              <Badge tone="brand">{ROLE_LABEL[role]}</Badge>
              <span className="text-[11px] text-muted">{timezone}</span>
            </div>
            <div className="mt-2 lg:hidden">
              <ConnectionDot />
            </div>
          </div>

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
            className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-surface-muted"
          >
            <Settings className="size-4 text-muted" />
            Notification settings
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
            >
              <LogOut className="size-4 text-muted" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
