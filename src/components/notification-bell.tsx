'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, Check } from 'lucide-react';
import {
  fetchNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDto,
} from '@/app/(app)/notifications/actions';
import { useRealtime } from './realtime-provider';
import { Button, cn } from './ui';
import { relativeTime } from '@/lib/format';

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const { subscribe } = useRealtime();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== 'notification.created') return;
        setUnread((n) => n + 1);
        if (open) {
          startTransition(async () => setItems(await fetchNotifications()));
        }
      }),
    [subscribe, open],
  );

  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      const [list, count] = await Promise.all([
        fetchNotifications(),
        getUnreadCount(),
      ]);
      setItems(list);
      setUnread(count);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
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

  const handleMarkAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      setUnread(0);
      setItems((current) =>
        current ? current.map((n) => ({ ...n, read: true })) : current,
      );
    });
  };

  const handleOpenItem = (item: NotificationDto) => {
    if (item.read) return;
    setUnread((n) => Math.max(0, n - 1));
    setItems((current) =>
      current
        ? current.map((n) => (n.id === item.id ? { ...n, read: true } : n))
        : current,
    );
    void markNotificationRead(item.id);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
        }
        className="relative rounded-lg p-2 text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <Bell className="size-4.5" />
        {unread > 0 ? (
          <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-block px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="animate-slide-in absolute right-0 top-11 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 ? (
              <Button size="sm" variant="ghost" onClick={handleMarkAll} disabled={pending}>
                <Check className="size-3.5" />
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Nothing yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((item) => {
                  const content = (
                    <div
                      className={cn(
                        'flex gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-muted',
                        !item.read && 'bg-brand-soft/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          item.read ? 'bg-transparent' : 'bg-brand',
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">{item.body}</p>
                        <p className="mt-1 text-[11px] text-muted">
                          {relativeTime(new Date(item.createdAt))}
                        </p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={item.id}>
                      {item.href ? (
                        <Link
                          href={item.href}
                          onClick={() => {
                            handleOpenItem(item);
                            setOpen(false);
                          }}
                          className="block"
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="block w-full"
                          onClick={() => handleOpenItem(item)}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-line px-4 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-brand hover:underline"
            >
              See all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
