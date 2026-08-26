import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationCenter from './NotificationCenter';
import {
  NOTIFICATION_EXIT_ANIMATION_MS,
  NotificationProvider,
  useNotifications,
} from './NotificationSystem';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function NotificationTrigger() {
  const { notify } = useNotifications();

  return (
    <button
      type="button"
      onClick={() =>
        notify({
          title: 'Simulation finished',
          description: 'Lazaruss · Quick Sim',
          durationMs: 100,
          action: { label: 'Open result', onClick: vi.fn() },
        })
      }
    >
      Notify
    </button>
  );
}

function HistoryNotificationTrigger({ onAction }: { onAction?: () => void }) {
  const { notify } = useNotifications();

  return (
    <button
      type="button"
      onClick={() =>
        notify({
          title: 'Simulation finished',
          description: 'Lazaruss · Quick Sim',
          durationMs: 0,
          href: '/sim/result-123',
          action: { label: 'Open result', onClick: onAction ?? vi.fn() },
        })
      }
    >
      Notify with history
    </button>
  );
}

describe('NotificationSystem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('auto-dismisses after the configured duration and waits for the exit animation', () => {
    render(
      <NotificationProvider>
        <NotificationTrigger />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('Simulation finished')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByText('Simulation finished').closest('[role="status"]')).toHaveClass(
      'notification-exit'
    );

    act(() => vi.advanceTimersByTime(NOTIFICATION_EXIT_ANIMATION_MS));
    expect(screen.queryByText('Simulation finished')).not.toBeInTheDocument();
  });

  it('dismisses when the action is selected', () => {
    render(
      <NotificationProvider>
        <NotificationTrigger />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open result' }));

    act(() => vi.advanceTimersByTime(NOTIFICATION_EXIT_ANIMATION_MS));
    expect(screen.queryByText('Simulation finished')).not.toBeInTheDocument();
  });

  it('returns the existing notification for a repeated dedupe key', () => {
    function DuplicateTrigger() {
      const { notify } = useNotifications();

      return (
        <button
          type="button"
          onClick={() => {
            notify({ title: 'Simulation finished', dedupeKey: 'simulation:123' });
            notify({ title: 'Simulation finished', dedupeKey: 'simulation:123' });
          }}
        >
          Notify duplicate
        </button>
      );
    }

    render(
      <NotificationProvider>
        <DuplicateTrigger />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify duplicate' }));
    expect(screen.getAllByText('Simulation finished')).toHaveLength(1);
  });

  it('removes an active duplicate when the replacement is history-only', () => {
    function HistoryOnlyReplacementTrigger() {
      const { notify } = useNotifications();

      return (
        <button
          type="button"
          onClick={() => {
            notify({ title: 'App update available', dedupeKey: 'app-update:3.7.0' });
            notify({
              title: 'App update available',
              dedupeKey: 'app-update:3.7.0',
              historyOnly: true,
            });
          }}
        >
          Replace with history
        </button>
      );
    }

    render(
      <NotificationProvider>
        <HistoryOnlyReplacementTrigger />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Replace with history' }));
    expect(screen.getByRole('status')).toHaveClass('notification-exit');
    act(() => vi.advanceTimersByTime(NOTIFICATION_EXIT_ANIMATION_MS));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps notifications in history, marks them read when opened, and preserves actions', () => {
    const onAction = vi.fn();
    render(
      <NotificationProvider>
        <NotificationCenter />
        <HistoryNotificationTrigger onAction={onAction} />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify with history' }));
    expect(screen.getByRole('status')).toHaveClass('pointer-events-auto');
    fireEvent.click(screen.getByRole('button', { name: 'Open result' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(NOTIFICATION_EXIT_ANIMATION_MS));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.getByText('Simulation finished')).toBeInTheDocument();
  });

  it('shows unread history and supports marking everything as read', () => {
    render(
      <NotificationProvider>
        <NotificationCenter />
        <HistoryNotificationTrigger />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify with history' }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByText('1 unread')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all notifications as read' }));
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });
});
