'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { useRouter } from 'next/navigation';
import { API_URL } from '../lib/api';

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!user) {
      router.push('/');
      return;
    }

    fetch(`${API_URL}/api/user/config`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setClientId(data.blizzard_client_id || '');
        setHasSecret(data.has_blizzard_client_secret || false);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setLoading(false);
      });
  }, [user, router]);

  const handleSave = async (
    key: 'blizzard_client_id' | 'blizzard_client_secret',
    value: string
  ) => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/user/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
        credentials: 'include',
      });

      if (res.ok) {
        setMessage({ type: 'success', text: `${key.replace(/_/g, ' ')} updated successfully.` });
        if (key === 'blizzard_client_secret') setHasSecret(true);
      } else {
        setMessage({ type: 'error', text: `Failed to update ${key.replace(/_/g, ' ')}.` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error.' });
    }
    setSaving(false);
  };

  const testCredentials = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/user/blizzard/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
        credentials: 'include',
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: 'Credentials verified successfully!' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to verify credentials.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Network error during test.' });
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gold"></div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 space-y-8 duration-500">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-2 text-zinc-400">Manage your account and API credentials.</p>
      </header>

      <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
        <h2 className="mb-6 text-xl font-semibold text-white">Blizzard API (BYOK)</h2>
        <p className="mb-8 text-sm text-zinc-400">
          Provide your own Blizzard API credentials to fetch your characters and gear. If not
          provided, the system will use global default keys.
          <br />
          <a
            href="https://develop.battle.net/access/clients"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-gold hover:underline"
          >
            Create a client on the Blizzard Developer Portal &rarr;
          </a>
        </p>

        <div className="max-w-2xl space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Client ID</label>
            <div className="flex gap-3">
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter Client ID"
                className="flex-1 rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
              />
              <button
                onClick={() => handleSave('blizzard_client_id', clientId)}
                disabled={saving}
                className="rounded-lg bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Client Secret</label>
            <div className="flex gap-3">
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={hasSecret ? '••••••••••••••••' : 'Enter Client Secret'}
                className="flex-1 rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
              />
              <button
                onClick={() => handleSave('blizzard_client_secret', clientSecret)}
                disabled={saving || !clientSecret}
                className="rounded-lg bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {hasSecret ? 'Update' : 'Save'}
              </button>
            </div>
            {hasSecret && !clientSecret && (
              <p className="text-[12px] text-zinc-500">
                A secret is already saved. Enter a new one to overwrite it.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 pt-4">
            <div className="flex items-center gap-4">
              <button
                onClick={testCredentials}
                disabled={testing || !clientId || (!clientSecret && !hasSecret)}
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>

              <button
                onClick={async () => {
                  if (
                    confirm(
                      'Are you sure you want to clear your saved Blizzard API credentials? You will be unable to fetch new character data until they are re-configured.'
                    )
                  ) {
                    setSaving(true);
                    try {
                      const res = await fetch(`${API_URL}/api/user/config`, {
                        method: 'DELETE',
                        credentials: 'include',
                      });
                      if (res.ok) {
                        setClientId('');
                        setHasSecret(false);
                        setMessage({ type: 'success', text: 'All Blizzard credentials cleared.' });
                      } else {
                        setMessage({ type: 'error', text: 'Failed to clear credentials.' });
                      }
                    } catch (err) {
                      setMessage({ type: 'error', text: 'Network error.' });
                    }
                    setSaving(false);
                  }
                }}
                disabled={saving || (!clientId && !hasSecret)}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-6 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                Clear All Credentials
              </button>
            </div>

            {message && (
              <div
                className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
                  message.type === 'success'
                    ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                    : 'border border-red-500/20 bg-red-500/10 text-red-400'
                }`}
              >
                {message.text}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border/50 bg-surface/10 p-6 opacity-60">
        <h2 className="mb-4 text-xl font-semibold text-white">Account Security</h2>
        <p className="text-sm text-zinc-400">
          Your credentials are used solely to fetch character data directly from Blizzard. They are
          stored in our secure database and are never shared with third parties.
        </p>
      </section>
    </div>
  );
}
