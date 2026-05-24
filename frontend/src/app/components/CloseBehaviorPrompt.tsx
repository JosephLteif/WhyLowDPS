'use client';

import { useEffect, useState } from 'react';
import { isDesktop } from '../lib/api';

type CloseBehaviorPreferenceResponse = {
  minimize_to_tray_on_close?: boolean | null;
};

export default function CloseBehaviorPrompt() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rememberChoice, setRememberChoice] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        if (cancelled) return;
        unlisten = await listen('whylowdps-close-choice-requested', () => {
          setError('');
          setRememberChoice(false);
          setOpen(true);
        });
      } catch {}
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const chooseCloseBehavior = async (minimizeToTray: boolean) => {
    setSaving(true);
    setError('');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (rememberChoice) {
        try {
          await invoke<CloseBehaviorPreferenceResponse>('set_close_behavior_preference', {
            minimizeToTrayOnClose: minimizeToTray,
          });
        } catch {
          await invoke<CloseBehaviorPreferenceResponse>('set_close_behavior_preference', {
            minimize_to_tray_on_close: minimizeToTray,
          });
        }

        if (minimizeToTray) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().hide();
        } else {
          try {
            await invoke('quit_app_now');
          } catch {
            await invoke('apply_close_behavior_choice', { minimizeToTrayOnClose: false });
          }
        }
      } else {
        if (minimizeToTray) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().hide();
        } else {
          try {
            await invoke('quit_app_now');
          } catch {
            await invoke('apply_close_behavior_choice', { minimizeToTrayOnClose: false });
            await invoke('clear_close_behavior_preference');
          }
        }
      }
      setOpen(false);
    } catch (err: any) {
      const detail =
        err?.message ||
        err?.toString?.() ||
        (typeof err === 'string' ? err : '') ||
        'Failed to apply close behavior.';
      console.error('[CloseBehaviorPrompt] Failed to apply close behavior:', err);
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  if (!isDesktop || !open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">When closing WhyLowDps</h3>
        <p className="mt-2 text-sm text-zinc-300">
          Choose what should happen when you close the window. You can change this anytime in
          Settings.
        </p>

        {error ? (
          <p className="mt-3 rounded-md border border-red-700/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}

        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-gold focus:ring-gold/60"
          />
          Do not show again
        </label>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void chooseCloseBehavior(false)}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            Close App
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void chooseCloseBehavior(true)}
            className="rounded-lg border border-gold/50 bg-gold/15 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
          >
            Minimize to Tray
          </button>
        </div>
      </div>
    </div>
  );
}
