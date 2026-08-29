'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Check, CheckCheck } from 'lucide-react';
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDto,
} from './actions';
import { Badge, Button, Card, CardHeader, cn } from '@/components/ui';
import { relativeTime } from '@/lib/format';

export function NotificationsList({ items }: { items: NotificationDto[] }) {
  const [rows, setRows] = useState(items);
  const [pending, startTransition] = useTransition();

  const unread = rows.filter((r) => !r.read).length;

  const markAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      setRows((current) => current.map((r) => ({ ...r, read: true })));
    });
  };

  const markOne = (id: string) => {
    setRows((current) =>
      current.map((r) => (r.id === id ? { ...r, read: true } : r)),
    );
    void markNotificationRead(id);
  };

  return (
    <Card>
      <CardHeader
        title={unread > 0 ? `${unread} unread` : 'All caught up'}
        action={
          unread > 0 ? (
            <Button size="sm" variant="secondary" onClick={markAll} disabled={pending}>
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          ) : null
        }
      />
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((item) => (
          <li
            key={item.id}
            className={cn('px-5 py-3.5', !item.read && 'bg-brand-soft/30')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium">{item.title}</p>
                  {!item.read ? <Badge tone="brand">New</Badge> : null}
                </div>
                <p className="mt-0.5 text-sm text-muted">{item.body}</p>
                <p className="mt-1 text-xs text-muted">
                  {relativeTime(new Date(item.createdAt))}
                  {' · '}
                  {item.type.replaceAll('_', ' ').toLowerCase()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {item.href ? (
                  <Link href={item.href} onClick={() => markOne(item.id)}>
                    <Button size="sm" variant="secondary">
                      Open
                    </Button>
                  </Link>
                ) : null}
                {!item.read ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markOne(item.id)}
                    aria-label="Mark read"
                  >
                    <Check className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
