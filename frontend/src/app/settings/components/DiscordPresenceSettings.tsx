'use client';

import { useEffect, useState } from 'react';
import { isDesktop } from '../../lib/api';

type DiscordPresenceSettingsResponse = {
  enabled: boolean;
  client_id?: string | null;
  configured: boolean;
  connected: boolean;
  message: string;
};

export default function DiscordPresenceSettings() {
  const [enabled, setEnabled] = useState(false);
  const [clientId, setClientId] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!isDesktop) return;

    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const settings = await invoke<DiscordPresenceSettingsResponse>(
          'get_discord_presence_settings'
        );
        if (cancelled) return;
        setEnabled(settings.enabled);
        setClientId(settings.client_id || '');
        setConnected(settings.connected);
        setMessage({ type: 'info', text: settings.message });
      } catch {
        if (!cancelled) {
          setMessage({
            type: 'error',
            text: 'Discord Rich Presence is unavailable in this build.',
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isDesktop) return null;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const settings = await invoke<DiscordPresenceSettingsResponse>(
        'set_discord_presence_settings',
        {
          enabled,
          client_id: clientId.trim() || null,
        }
      );
      setEnabled(settings.enabled);
      setClientId(settings.client_id || '');
      setConnected(settings.connected);
      setMessage({
        type: settings.connected ? 'success' : 'info',
        text: settings.enabled
          ? settings.message
          : 'Discord Rich Presence disabled for this device.',
      });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.message || 'Failed to save Discord Rich Presence settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border/70 bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Discord Rich Presence</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-zinc-400">
            Optionally show your current WhyLowDPS workspace and active character in Discord while
            the Discord desktop app is running.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
            connected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-border/70 bg-surface-2 text-zinc-500'
          }`}
        >
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="mt-4 max-w-2xl space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="discord-client-id">
            Discord Application ID
          </label>
          <input
            id="discord-client-id"
            inputMode="numeric"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="Paste your public Discord Application ID"
            disabled={loading || saving}
            className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 font-mono text-sm text-white transition-colors focus:border-gold/50 focus:outline-none disabled:opacity-60"
          />
          <p className="text-[12px] leading-relaxed text-zinc-500">
            Create or select an application in the{' '}
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:underline"
            >
              Discord Developer Portal
            </a>
            . This is a public ID, not a Discord token.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Share activity in Discord</p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Rich Presence is opt-in and never blocks simulations if Discord is unavailable.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((value) => !value)}
            disabled={loading || saving}
            aria-pressed={enabled}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? 'bg-gold' : 'border border-border bg-surface-2'
            } disabled:opacity-60`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                enabled ? 'left-[22px] bg-black' : 'left-0.5 bg-gray-500'
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || (enabled && !clientId.trim())}
            className="rounded-lg bg-gold/10 px-5 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
          >
            {saving ? 'Saving Discord settings...' : 'Save Discord settings'}
          </button>
          {message && (
            <p
              role={message.type === 'error' ? 'alert' : 'status'}
              className={`text-xs ${
                message.type === 'error'
                  ? 'text-red-300'
                  : message.type === 'success'
                    ? 'text-emerald-300'
                    : 'text-zinc-400'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
