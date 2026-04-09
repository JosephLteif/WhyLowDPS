'use client';

import React from 'react';
import { API_URL } from '../lib/api';
import { useAuth } from './AuthContext';

interface SplashScreenProps {
  status: string;
  progress: string;
  onRetry?: () => void;
  onConfigureKeys?: () => void;
}

export default function SplashScreen({
  status,
  progress,
  onRetry,
  onConfigureKeys,
}: SplashScreenProps) {
  const { login, logout } = useAuth();
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  const isError = status.toLowerCase().includes('error');
  const needsCredentials = status === 'needs_credentials';
  const isSyncing = status === 'syncing';

  // Helper to parse: "TASK:CURRENT:TOTAL:DETAILS"
  const parseProgress = (str: string) => {
    const parts = str.split(':');
    if (parts.length < 4) return { task: '', current: 0, total: 0, details: str };
    return {
      task: parts[0],
      current: parseInt(parts[1], 10),
      total: parseInt(parts[2], 10),
      details: parts[3],
    };
  };

  const progressData = parseProgress(progress);
  const progressPercent =
    progressData.total > 0 ? Math.round((progressData.current / progressData.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-zinc-950">
      {/* Background Glows */}
      <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-pulse rounded-full bg-gold/10 blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-gold-dark/10 blur-[120px] delay-1000" />

      <div className="relative flex w-full max-w-md flex-col items-center px-6">
        {/* Animated Logo Container */}
        <div className="relative mb-12">
          <div className="absolute inset-0 animate-pulse rounded-full bg-gold/20 blur-2xl" />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-b from-gold to-gold-dark shadow-2xl">
            <svg className="h-12 w-12 text-black" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2l10 6-10 6V2z" />
            </svg>
          </div>
        </div>

        <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-gray-100">
          WhyLowDps
        </h1>

        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wide text-zinc-400">
          Initial Synchronization
        </p>

        {/* Status Bubble */}
        <div className="w-full rounded-2xl border border-white/5 bg-white/[0.03] p-6 backdrop-blur-xl">
          <div className="flex flex-col items-center">
            {isSyncing ? (
              <div className="w-full">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
                  <span className="text-gold">{progressData.task || 'Initializing'}</span>
                  <span className="text-zinc-500">
                    {progressData.total > 0
                      ? `${progressData.current} / ${progressData.total}`
                      : ''}
                  </span>
                </div>

                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
                  {progressData.total > 0 ? (
                    <div
                      className="shadow-glow-sm h-full bg-gradient-to-r from-gold-dark to-gold transition-all duration-500 ease-out"
                      style={{ width: `${progressPercent}%` }}
                    />
                  ) : (
                    <div className="animate-progress-indefinite shadow-glow-sm h-full bg-gold" />
                  )}
                </div>

                <div className="flex flex-col items-center gap-1">
                  <p className="w-full truncate text-center text-sm font-medium text-zinc-100">
                    {progressData.details || 'Syncing with Blizzard...'}
                  </p>
                  {progressData.total > 0 && (
                    <p className="text-[10px] text-zinc-500">{progressPercent}% Complete</p>
                  )}
                </div>
              </div>
            ) : status === 'unauthenticated' ? (
              <div className="w-full text-center">
                <p className="mb-6 text-sm font-medium text-zinc-300">Authentication Required</p>
                <button
                  onClick={() => login()}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 active:scale-95"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm0-8h-2V7h2v2zm4 8h-2V7h2v10z" />
                  </svg>
                  Login with Battle.net
                </button>
              </div>
            ) : status === 'unauthenticated_needs_keys' ? (
              <div className="w-full space-y-4 text-center">
                <p className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
                  Blizzard API Credentials Required
                </p>

                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Client ID"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-gold/50 focus:outline-none"
                  />
                  <input
                    type="password"
                    placeholder="Client Secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-gold/50 focus:outline-none"
                  />
                </div>

                <p className="text-[10px] text-zinc-500">
                  <a
                    href="https://develop.battle.net/access/clients"
                    target="_blank"
                    className="text-gold hover:underline"
                  >
                    Create a client
                  </a>{' '}
                  on the Blizzard Developer Portal.
                </p>

                <button
                  onClick={() => login(clientId, clientSecret)}
                  disabled={!clientId || !clientSecret}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 active:scale-95 disabled:opacity-50 disabled:grayscale"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm0-8h-2V7h2v2zm4 8h-2V7h2v10z" />
                  </svg>
                  Login with Battle.net
                </button>
              </div>
            ) : needsCredentials ? (
              <div className="text-center">
                <p className="mb-6 text-sm text-zinc-300">
                  Blizzard API credentials are required to download game data for the current
                  season.
                </p>
                <button
                  onClick={onConfigureKeys}
                  className="w-full rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-black shadow-lg shadow-gold/20 transition-all hover:bg-gold-light active:scale-95"
                >
                  Configure API Keys
                </button>
              </div>
            ) : isError ? (
              <div className="text-center">
                <p className="mb-6 text-sm text-red-400">{status}</p>
                <button
                  onClick={onRetry}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/10 active:scale-95"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <p className="text-sm text-zinc-300">Preparing workspace...</p>
            )}
          </div>
        </div>

        <div className="mt-12 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
          Version 1.0.0 • Production Ready
        </div>
      </div>

      <style jsx global>{`
        @keyframes progress-indefinite {
          0% {
            transform: translateX(-100%);
            width: 30%;
          }
          50% {
            width: 60%;
          }
          100% {
            transform: translateX(400%);
            width: 30%;
          }
        }
        .animate-progress-indefinite {
          animation: progress-indefinite 2s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
}
