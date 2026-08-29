'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileClock,
  Gauge,
  Inbox,
  LayoutDashboard,
  Mail,
  Scale,
  Users,
} from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { cn } from './ui';

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
}

export const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        roles: ['ADMIN', 'MANAGER', 'STAFF'],
      },
      {
        href: '/on-duty',
        label: 'On duty now',
        icon: Clock,
        roles: ['ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    heading: 'Schedule',
    items: [
      {
        href: '/schedule',
        label: 'My schedule',
        icon: CalendarDays,
        roles: ['STAFF'],
      },
      {
        href: '/manage/schedule',
        label: 'Build schedule',
        icon: CalendarDays,
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        href: '/availability',
        label: 'My availability',
        icon: ClipboardList,
        roles: ['STAFF'],
      },
    ],
  },
  {
    heading: 'Coverage',
    items: [
      { href: '/swaps', label: 'My requests', icon: Inbox, roles: ['STAFF'] },
      {
        href: '/swaps/open',
        label: 'Open shifts',
        icon: ClipboardCheck,
        roles: ['STAFF'],
      },
      {
        href: '/manage/swaps',
        label: 'Approvals',
        icon: ClipboardCheck,
        roles: ['ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    heading: 'Insight',
    items: [
      {
        href: '/manage/overtime',
        label: 'Overtime',
        icon: Gauge,
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        href: '/manage/fairness',
        label: 'Fairness',
        icon: Scale,
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        href: '/manage/staff',
        label: 'Team',
        icon: Users,
        roles: ['ADMIN', 'MANAGER'],
      },
    ],
  },
  {
    heading: 'Records',
    items: [
      {
        href: '/audit',
        label: 'Audit trail',
        icon: FileClock,
        roles: ['ADMIN', 'MANAGER'],
      },
      {
        href: '/admin/outbox',
        label: 'Email outbox',
        icon: Mail,
        roles: ['ADMIN'],
      },
    ],
  },
];

export function sectionsFor(role: Role) {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

export function NavLinks({
  role,
  onNavigate,
}: {
  role: Role;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const sections = sectionsFor(role);

  return (
    <>
      {sections.map((section) => (
        <div key={section.heading}>
          <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (pathname.startsWith(`${item.href}/`) &&
                  !SECTIONS.some((s) =>
                    s.items.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href) &&
                        pathname.startsWith(other.href),
                    ),
                  ));
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors lg:py-1.5',
                      active
                        ? 'bg-brand-soft font-medium text-brand'
                        : 'text-muted hover:bg-surface-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
