'use client';

import Link from 'next/link';
import type { Role } from '@/generated/prisma/enums';
import { NavLinks } from './nav-items';

export function SideNav({ role }: { role: Role }) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3 py-4 lg:flex"
    >
      <Link href="/dashboard" className="px-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">
          Coastal Eats
        </p>
        <p className="text-base font-semibold tracking-tight">ShiftSync</p>
      </Link>

      <NavLinks role={role} />
    </nav>
  );
}
