'use client';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type NotificationVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export type NotificationAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

export type NotificationOptions = {
  title: string;
  description?: ReactNode;
  variant?: NotificationVariant;
  durationMs?: number;
  icon?: ReactNode;
  action?: NotificationAction;
  href?: string;
  dedupeKey?: string;
  historyOnly?: boolean;
};

export const DEFAULT_NOTIFICATION_DURATION_MS = 6000;
export const NOTIFICATION_EXIT_ANIMATION_MS = 180;
const NOTIFICATION_HISTORY_STORAGE_KEY = 'whylowdps_notification_history';
const MAX_NOTIFICATION_HISTORY = 50;

export type NotificationHistoryItem = {
  id: string;
  title: string;
  description?: string;
  variant: NotificationVariant;
  action?: NotificationAction;
  href?: string;
  dedupeKey?: string;
  createdAt: number;
  read: boolean;
};

type NotificationRecord = {
  id: string;
  title: string;
  description?: ReactNode;
  variant: NotificationVariant;
  durationMs: number;
  icon?: ReactNode;
  action?: NotificationAction;
  href?: string;
  dedupeKey?: string;
  isExiting: boolean;
};

export type NotificationContextValue = {
  notify: (options: NotificationOptions) => string;
  dismiss: (id: string) => void;
  history: NotificationHistoryItem[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearHistory: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const notificationStyles: Record<
  NotificationVariant,
  { border: string; icon: string; title: string; progress: string; action: string }
> = {
  default: {
    border: 'border-gold/30',
    icon: 'bg-gold/10 text-gold',
    title: 'text-zinc-100',
    progress: 'bg-gold',
    action: 'bg-gold/15 text-gold hover:bg-gold/25',
  },
  success: {
    border: 'border-emerald-500/30',
    icon: 'bg-emerald-500/10 text-emerald-300',
    title: 'text-emerald-100',
    progress: 'bg-emerald-400',
    action: 'bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
  },
  warning: {
    border: 'border-amber-500/30',
    icon: 'bg-amber-500/10 text-amber-300',
    title: 'text-amber-100',
    progress: 'bg-amber-400',
    action: 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
  },
  error: {
    border: 'border-red-500/30',
    icon: 'bg-red-500/10 text-red-300',
    title: 'text-red-100',
    progress: 'bg-red-400',
    action: 'bg-red-500/15 text-red-200 hover:bg-red-500/25',
  },
  info: {
    border: 'border-sky-500/30',
    icon: 'bg-sky-500/10 text-sky-300',
    title: 'text-sky-100',
    progress: 'bg-sky-400',
    action: 'bg-sky-500/15 text-sky-200 hover:bg-sky-500/25',
  },
};

const fallbackIcons = {
  default: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  error: AlertCircle,
  info: Info,
};

let nextNotificationId = 0;

function createNotificationId() {
  nextNotificationId += 1;
  return `notification-${Date.now()}-${nextNotificationId}`;
}

function isNotificationVariant(value: unknown): value is NotificationVariant {
  return ['default', 'success', 'warning', 'error', 'info'].includes(value as string);
}

function loadNotificationHistory(): NotificationHistoryItem[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(NOTIFICATION_HISTORY_STORAGE_KEY) || 'null'
    );
    if (!Array.isArray(stored)) return [];

    return stored
      .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : undefined,
        variant: isNotificationVariant(item.variant) ? item.variant : 'default',
        href: typeof item.href === 'string' ? item.href : undefined,
        dedupeKey: typeof item.dedupeKey === 'string' ? item.dedupeKey : undefined,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        read: item.read === true,
      }))
      .slice(-MAX_NOTIFICATION_HISTORY);
  } catch {
    return [];
  }
}

function saveNotificationHistory(history: NotificationHistoryItem[]) {
  try {
    window.localStorage.setItem(
      NOTIFICATION_HISTORY_STORAGE_KEY,
      JSON.stringify(
        history.map(({ id, title, description, variant, href, dedupeKey, createdAt, read }) => ({
          id,
          title,
          description,
          variant,
          href,
          dedupeKey,
          createdAt,
          read,
        }))
      )
    );
  } catch {
    // Notifications remain available for the current session when storage is unavailable.
  }
}

function NotificationCard({
  notification,
  onDismiss,
  onMarkAsRead,
}: {
  notification: NotificationRecord;
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
}) {
  const styles = notificationStyles[notification.variant];
  const FallbackIcon = fallbackIcons[notification.variant];

  useEffect(() => {
    if (notification.isExiting || notification.durationMs <= 0) return;

    const timer = window.setTimeout(() => onDismiss(notification.id), notification.durationMs);
    return () => window.clearTimeout(timer);
  }, [notification.durationMs, notification.id, notification.isExiting, onDismiss]);

  return (
    <div
      role="status"
      className={`notification-card pointer-events-auto relative w-[min(92vw,380px)] overflow-hidden rounded-xl border bg-surface/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-sm ${styles.border} ${notification.isExiting ? 'notification-exit' : 'notification-enter'}`}
      style={{ '--notification-duration': `${notification.durationMs}ms` } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${styles.icon}`}
        >
          {notification.icon ?? <FallbackIcon className="h-4 w-4" strokeWidth={2} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${styles.title}`}>{notification.title}</p>
          {notification.description ? (
            <div className="mt-1 text-xs leading-5 text-zinc-400">{notification.description}</div>
          ) : null}
          {notification.action ? (
            <button
              type="button"
              onClick={() => {
                onMarkAsRead(notification.id);
                try {
                  const result = notification.action?.onClick();
                  if (result) void result.catch(() => undefined);
                } finally {
                  onDismiss(notification.id);
                }
              }}
              className={`mt-3 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 ${styles.action}`}
            >
              {notification.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(notification.id)}
          className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          aria-label={`Dismiss ${notification.title}`}
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {notification.durationMs > 0 ? (
        <div
          className={`notification-progress absolute inset-x-0 bottom-0 h-0.5 ${styles.progress}`}
        />
      ) : null}
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const exitTimers = useRef(new Map<string, number>());
  const dedupeIds = useRef(new Map<string, string>());

  const dismiss = useCallback((id: string) => {
    if (exitTimers.current.has(id)) return;

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, isExiting: true } : notification
      )
    );

    const timer = window.setTimeout(() => {
      setNotifications((current) => current.filter((notification) => notification.id !== id));
      exitTimers.current.delete(id);
    }, NOTIFICATION_EXIT_ANIMATION_MS);
    exitTimers.current.set(id, timer);
  }, []);

  const notify = useCallback(
    (options: NotificationOptions) => {
      if (options.dedupeKey) {
        const existingId = dedupeIds.current.get(options.dedupeKey);
        if (existingId) {
          if (options.historyOnly) dismiss(existingId);
          setHistory((current) =>
            current.map((notification) =>
              notification.id === existingId
                ? {
                    ...notification,
                    description:
                      typeof options.description === 'string'
                        ? options.description
                        : notification.description,
                    action: options.action,
                    href: options.href ?? notification.href,
                  }
                : notification
            )
          );
          return existingId;
        }
      }

      const id = createNotificationId();
      const createdAt = Date.now();
      const notification: NotificationRecord = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? 'default',
        durationMs: Math.max(0, options.durationMs ?? DEFAULT_NOTIFICATION_DURATION_MS),
        icon: options.icon,
        action: options.action,
        href: options.href,
        dedupeKey: options.dedupeKey,
        isExiting: false,
      };
      const historyItem: NotificationHistoryItem = {
        id,
        title: options.title,
        description: typeof options.description === 'string' ? options.description : undefined,
        variant: options.variant ?? 'default',
        action: options.action,
        href: options.href,
        dedupeKey: options.dedupeKey,
        createdAt,
        read: false,
      };

      if (!options.historyOnly) {
        setNotifications((current) => [...current, notification].slice(-4));
      }
      setHistory((current) => [...current, historyItem].slice(-MAX_NOTIFICATION_HISTORY));
      if (options.dedupeKey) dedupeIds.current.set(options.dedupeKey, id);
      return id;
    },
    [dismiss]
  );

  const markAsRead = useCallback((id: string) => {
    setHistory((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setHistory((current) => current.map((notification) => ({ ...notification, read: true })));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  useEffect(() => {
    setHistory((current) => {
      const stored = loadNotificationHistory();
      const merged = new Map(stored.map((notification) => [notification.id, notification]));
      stored.forEach((notification) => {
        if (notification.dedupeKey && !dedupeIds.current.has(notification.dedupeKey)) {
          dedupeIds.current.set(notification.dedupeKey, notification.id);
        }
      });
      current.forEach((notification) => merged.set(notification.id, notification));
      current.forEach((notification) => {
        if (notification.dedupeKey) dedupeIds.current.set(notification.dedupeKey, notification.id);
      });
      return [...merged.values()]
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-MAX_NOTIFICATION_HISTORY);
    });
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (historyReady) saveNotificationHistory(history);
  }, [history, historyReady]);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const unreadCount = history.reduce(
    (count, notification) => count + (notification.read ? 0 : 1),
    0
  );

  return (
    <NotificationContext.Provider
      value={{ history, unreadCount, notify, dismiss, markAsRead, markAllAsRead, clearHistory }}
    >
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[140] flex w-[calc(100%-2rem)] max-w-[380px] flex-col items-end gap-3 sm:bottom-6 sm:right-6"
      >
        {notifications.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onDismiss={dismiss}
            onMarkAsRead={markAsRead}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}
