import { useEffect, useState } from 'react';
import type { BlizzardCredentialProfile } from '../../lib/api';

type BlizzardMessage = { type: 'success' | 'error'; text: string } | null;

type IntegrationsSettingsSectionProps = {
  clientId: string;
  setClientId: (value: string) => void;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  credentialName: string;
  setCredentialName: (value: string) => void;
  credentialProfiles: BlizzardCredentialProfile[];
  renameSavedCredential: (id: string, nextName: string) => Promise<void>;
  deleteSavedCredential: (id: string) => Promise<void>;
  secretTouched: boolean;
  setSecretTouched: (value: boolean) => void;
  hasSecret: boolean;
  blizzardTesting: boolean;
  blizzardSaving: boolean;
  testBlizzardCredentials: () => Promise<void>;
  saveBlizzardSettings: () => Promise<void>;
  blizzardMessage: BlizzardMessage;
};

export default function IntegrationsSettingsSection({
  clientId,
  setClientId,
  clientSecret,
  setClientSecret,
                                                      credentialName,
                                                      setCredentialName,
                                                      credentialProfiles,
                                                      renameSavedCredential,
                                                      deleteSavedCredential,
  secretTouched,
  setSecretTouched,
  hasSecret,
  blizzardTesting,
  blizzardSaving,
  testBlizzardCredentials,
  saveBlizzardSettings,
  blizzardMessage,
}: IntegrationsSettingsSectionProps) {
  const hasUsableSavedCredentials = credentialProfiles.some(
    (profile) => profile.has_secret !== false,
  );
  const hasBrokenSavedCredentials = credentialProfiles.some(
    (profile) => profile.has_secret === false,
  );
  const [showNewCredentialForm, setShowNewCredentialForm] = useState(
    credentialProfiles.length === 0 || !hasUsableSavedCredentials,
  );
  const [editingCredentialId, setEditingCredentialId] = useState('');
  const [editingCredentialName, setEditingCredentialName] = useState('');

  useEffect(() => {
    if (credentialProfiles.length > 0 && !clientSecret.trim() && hasUsableSavedCredentials) {
      setShowNewCredentialForm(false);
    }
  }, [clientSecret, credentialProfiles.length, hasUsableSavedCredentials]);

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <h2 className="mb-6 text-xl font-semibold text-white">API Integrations</h2>

      <div className="max-w-2xl space-y-6">
        {credentialProfiles.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-300">Saved Credentials</p>
            <div className="space-y-2">
              {credentialProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                    profile.has_secret === false
                      ? 'border-amber-500/20 bg-amber-500/10'
                      : 'border-border/50 bg-surface-2'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {editingCredentialId === profile.id ? (
                      <input
                        value={editingCredentialName}
                        onChange={(e) => setEditingCredentialName(e.target.value)}
                        className="w-full rounded border border-border/50 bg-surface px-2 py-1 text-sm font-semibold text-zinc-100 focus:border-gold/50 focus:outline-none"
                      />
                    ) : (
                      <p className="truncate text-sm font-semibold text-zinc-100">{profile.name}</p>
                    )}
                    <p className="truncate text-[12px] text-zinc-500">{profile.client_id}</p>
                    {profile.has_secret === false && (
                      <p className="mt-1 text-[12px] text-amber-200">
                        Secure secret missing. Re-enter the client secret to repair this saved
                        credential.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {editingCredentialId === profile.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void renameSavedCredential(profile.id, editingCredentialName).then(
                              () => {
                                setEditingCredentialId('');
                                setEditingCredentialName('');
                              },
                            );
                          }}
                          disabled={!editingCredentialName.trim()}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingCredentialId('');
                            setEditingCredentialName('');
                          }}
                          className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCredentialId(profile.id);
                          setEditingCredentialName(profile.name);
                        }}
                        className="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 hover:bg-white/10"
                      >
                        Rename
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteSavedCredential(profile.id)}
                      className="rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-red-200 hover:bg-red-500/20"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {hasBrokenSavedCredentials && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
            Some saved Blizzard credentials are incomplete on this device. Enter the client secret
            again and save to repair them.
          </div>
        )}

        <div className="rounded-lg border border-border/70 bg-surface px-4 py-3">
          <p className="text-sm font-semibold text-zinc-200">Blizzard API (BYOK)</p>
          <p className="mt-1 text-[13px] text-zinc-400">
            Provide your own Blizzard API credentials to fetch your characters and gear.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
            <span className="font-semibold text-zinc-300">Setup Instructions:</span>
            <br />
            1. Create a client on the{' '}
            <a
              href="https://develop.battle.net/access/clients"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold hover:underline"
            >
              Blizzard Developer Portal
            </a>
            .
            <br />
            2. Add{' '}
            <code className="text-zinc-300">http://localhost:17384/api/auth/bnet/callback</code> to
            your Redirect URIs.
          </p>
        </div>

        {credentialProfiles.length > 0 && !showNewCredentialForm && (
          <button
            type="button"
            onClick={() => setShowNewCredentialForm(true)}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
          >
            Use new credentials
          </button>
        )}

        {showNewCredentialForm && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Credential Name</label>
              <input
                type="text"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder="Main Blizzard app"
                className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter Client ID"
                className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Client Secret</label>
              <input
                type="password"
                value={secretTouched ? clientSecret : hasSecret ? '••••••••••••••••' : clientSecret}
                onFocus={() => {
                  if (!secretTouched && hasSecret) {
                    setSecretTouched(true);
                    setClientSecret('');
                  }
                }}
                onChange={(e) => {
                  setSecretTouched(true);
                  setClientSecret(e.target.value);
                }}
                placeholder="Enter Client Secret"
                className="w-full rounded-lg border border-border/50 bg-surface-2 px-4 py-2.5 text-white transition-colors focus:border-gold/50 focus:outline-none"
              />
              <p className="text-[12px] text-zinc-500">
                {hasSecret && !clientSecret
                  ? 'A secret is already saved and hidden. Type to replace it.'
                  : 'Your secret is hidden in this field.'}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => void testBlizzardCredentials()}
                disabled={
                  blizzardTesting || !clientId.trim() || (!clientSecret.trim() && !hasSecret)
                }
                className="rounded-lg border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {blizzardTesting ? 'Testing Blizzard...' : 'Test Blizzard Connection'}
              </button>

              <button
                onClick={() => void saveBlizzardSettings()}
                disabled={blizzardSaving || (!clientId.trim() && !clientSecret.trim())}
                className="rounded-lg bg-gold/10 px-6 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {blizzardSaving ? 'Saving Blizzard...' : 'Save Blizzard Settings'}
              </button>
            </div>
          </>
        )}

        {blizzardMessage && (
          <div
            className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
              blizzardMessage.type === 'success'
                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border border-red-500/20 bg-red-500/10 text-red-400'
            }`}
          >
            {blizzardMessage.text}
          </div>
        )}
      </div>
    </section>
  );
}
