'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeEvent, RealtimeEventType } from '@/lib/realtime/events';

const REFRESH_DEBOUNCE_MS = 250;

export type ConnectionState = 'connecting' | 'live' | 'offline';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  href?: string;
}

interface RealtimeContextValue {
  connection: ConnectionState;
  lastEventAt: Date | null;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const SELF_SUPPRESSED: RealtimeEventType[] = [
  'shift.created',
  'shift.updated',
  'shift.deleted',
  'assignment.created',
  'assignment.cancelled',
];

const TONE_BY_TYPE: Partial<Record<RealtimeEventType, Toast['tone']>> = {
  'schedule.published': 'success',
  'schedule.unpublished': 'warn',
  'coverage.requested': 'info',
  'coverage.accepted': 'info',
  'coverage.declined': 'warn',
  'coverage.claimed': 'info',
  'coverage.resolved': 'success',
  'coverage.cancelled': 'warn',
  'assignment.conflict': 'error',
  'notification.created': 'info',
};

export function RealtimeProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const listenersRef = useRef(new Set<(event: RealtimeEvent) => void>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current.slice(-3), { ...toast, id }]);
    if (toast.tone !== 'error') {
      setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 6000);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const subscribe = useCallback((listener: (event: RealtimeEvent) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    const source = new EventSource('/api/events');

    source.addEventListener('ready', () => setConnection('live'));
    source.addEventListener('open', () => setConnection('live'));
    source.addEventListener('error', () => {
      setConnection((current) => (current === 'live' ? 'offline' : 'connecting'));
    });

    const handle = (raw: MessageEvent<string>) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(raw.data) as RealtimeEvent;
      } catch {
        return;
      }

      setLastEventAt(new Date());
      setConnection('live');

      for (const listener of listenersRef.current) {
        try {
          listener(event);
        } catch {
        }
      }

      const isOwnAction = event.actorId === userId;
      if (
        event.message &&
        !(isOwnAction && SELF_SUPPRESSED.includes(event.type))
      ) {
        pushToast({
          title: event.message,
          body:
            typeof event.payload?.body === 'string'
              ? event.payload.body
              : undefined,
          tone: TONE_BY_TYPE[event.type] ?? 'info',
          href:
            typeof event.payload?.href === 'string'
              ? event.payload.href
              : undefined,
        });
      }

      if (!isOwnAction) scheduleRefresh();
    };

    const types: RealtimeEventType[] = [
      'schedule.published',
      'schedule.unpublished',
      'shift.created',
      'shift.updated',
      'shift.deleted',
      'assignment.created',
      'assignment.cancelled',
      'assignment.conflict',
      'coverage.requested',
      'coverage.accepted',
      'coverage.declined',
      'coverage.claimed',
      'coverage.resolved',
      'coverage.cancelled',
      'notification.created',
      'duty.changed',
      'availability.changed',
    ];
    for (const type of types) {
      source.addEventListener(type, handle as EventListener);
    }

    return () => {
      for (const type of types) {
        source.removeEventListener(type, handle as EventListener);
      }
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [userId, pushToast, scheduleRefresh]);

  const value = useMemo(
    () => ({
      connection,
      lastEventAt,
      toasts,
      pushToast,
      dismissToast,
      subscribe,
    }),
    [connection, lastEventAt, toasts, pushToast, dismissToast, subscribe],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used inside a RealtimeProvider');
  }
  return context;
}

export function useRealtimeOptional(): RealtimeContextValue | null {
  return useContext(RealtimeContext);
}
