'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import type { Role } from '@/generated/prisma/enums';
import { NavLinks } from './nav-items';

export function MobileNav({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="-ml-1 rounded-lg p-2 text-muted transition-colors hover:bg-surface-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && mounted
        ? createPortal(
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <nav
            aria-label="Main"
            className="animate-slide-in absolute inset-y-0 left-0 flex w-[min(17rem,85vw)] flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3 py-4"
          >
            <div className="flex items-start justify-between gap-2 px-2">
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-brand">
                  Coastal Eats
                </p>
                <p className="text-base font-semibold tracking-tight">
                  ShiftSync
                </p>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="-mr-1 rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <NavLinks role={role} onNavigate={() => setOpen(false)} />
          </nav>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
