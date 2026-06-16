'use client';

import { useEffect, useState } from 'react';
import { type BlizzardCredentialProfile, isDesktop, listBlizzardCredentialProfiles } from '../lib/api';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (clientId: string, clientSecret: string, credentialId?: string) => void;
}

export default function LoginModal({ isOpen, onClose, onConfirm }: LoginModalProps) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [credentialProfiles, setCredentialProfiles] = useState<BlizzardCredentialProfile[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState('');

  useEffect(() => {
    if (!isOpen || !isDesktop) return;
    let cancelled = false;
    listBlizzardCredentialProfiles()
      .then((profiles) => {
        if (cancelled) return;
        setCredentialProfiles(profiles);
        setSelectedCredentialId((current) => current || profiles[0]?.id || '');
      })
      .catch(() => {
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCredentialId) {
      onConfirm('', '', selectedCredentialId);
      return;
    }
    if (clientId && clientSecret) {
      onConfirm(clientId, clientSecret);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="animate-in fade-in absolute inset-0 bg-black/60 backdrop-blur-sm duration-300"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="animate-in fade-in zoom-in-95 relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e] p-6 shadow-2xl duration-300">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Blizzard API Credentials Required</h2>
          <p className="mt-2 text-sm text-zinc-400">
            This instance of WhyLowDps is not configured with global Blizzard API keys. Please
            provide your own to continue with login.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {credentialProfiles.length > 0 && (
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-zinc-300">Saved Credentials</label>
              <div className="space-y-2">
                {credentialProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedCredentialId(profile.id)}
                    className={`w-full rounded-lg border px-4 py-2.5 text-left transition-colors ${
                      selectedCredentialId === profile.id
                        ? 'border-gold/60 bg-gold/10 text-white'
                        : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                    }`}
                  >
                    <span className="block truncate text-sm font-semibold">{profile.name}</span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      {profile.client_id}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedCredentialId('')}
                  className={`w-full rounded-lg border px-4 py-2.5 text-left text-sm font-semibold transition-colors ${
                    selectedCredentialId
                      ? 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                      : 'border-gold/60 bg-gold/10 text-white'
                  }`}
                >
                  Use new credentials
                </button>
              </div>
            </div>
          )}

          {!selectedCredentialId && (
            <>
              <div className="space-y-2">
                <label className="text-[13px] font-medium text-zinc-300">Client ID</label>
                <input
                  type="text"
                  required
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Enter your Client ID"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white transition-all placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[13px] font-medium text-zinc-300">Client Secret</label>
                <input
                  type="password"
                  required
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Enter your Client Secret"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-white transition-all placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/50"
                />
              </div>
            </>
          )}

          <div className="rounded-lg border border-gold/10 bg-gold/5 p-3 text-[12px] leading-relaxed text-gold/80">
            You can create these on the{' '}
            <a
              href="https://develop.battle.net/access/clients"
              target="_blank"
              rel="noopener noreferrer"
              className="underline transition-colors hover:text-gold"
            >
              Blizzard Developer Portal
            </a>
            . These will be saved to your profile and used for future sessions.
          </div>

          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedCredentialId && (!clientId || !clientSecret)}
              className="flex-[2] rounded-lg bg-[#0074e0] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/10 transition-all hover:bg-[#005fb8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Link & Proceed to Login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
