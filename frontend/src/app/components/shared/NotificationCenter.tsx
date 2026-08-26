'use client';

import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useNotifications, type NotificationHistoryItem } from './NotificationSystem';

const unreadDotStyles: Record<NotificationHistoryItem['variant'], string> = {
  default: 'bg-gold',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
  info: 'bg-sky-400',
};

function formatNotificationTime(createdAt: number) {
  const ageMs = Math.max(0, Date.now() - createdAt);
  if (ageMs < 60_000) return 'Just now';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(createdAt));
}

export default function NotificationCenter() {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { history, unreadCount, markAsRead, markAllAsRead, clearHistory } = useNotifications();

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  const handleNotificationClick = (notification: NotificationHistoryItem) => {
    markAsRead(notification.id);
    setIsOpen(false);

    try {
      const result = notification.action?.onClick();
      if (result) {
        void result.catch(() => undefined);
      } else if (notification.href) {
        router.push(notification.href);
      }
    } catch {
      if (!notification.action && notification.href) router.push(notification.href);
    }
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white sm:h-8 sm:w-8"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Bell className="h-4 w-4" strokeWidth={2} />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold leading-none text-black">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Notification history"
          className="absolute right-0 top-full z-[150] mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-zinc-100">Notifications</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                  title="Mark all as read"
                  aria-label="Mark all notifications as read"
                >
                  <CheckCheck className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
              {history.length > 0 ? (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  title="Clear history"
                  aria-label="Clear notification history"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                aria-label="Close notification history"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>

          {history.length > 0 ? (
            <div className="max-h-[min(28rem,calc(100dvh-9rem))] overflow-y-auto p-2">
              {[...history].reverse().map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-white/[0.06] ${notification.read ? 'opacity-70' : 'bg-white/[0.035]'}`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.read ? 'bg-zinc-600' : unreadDotStyles[notification.variant]}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-100">
                      {notification.title}
                    </span>
                    {notification.description ? (
                      <span className="mt-1 block truncate text-xs text-zinc-400">
                        {notification.description}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-zinc-600">
                      {formatNotificationTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto h-5 w-5 text-zinc-600" strokeWidth={1.5} />
              <p className="mt-2 text-sm text-zinc-400">No notifications yet</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
