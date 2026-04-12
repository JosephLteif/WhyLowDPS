'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import { downloadLatestSimc, getSimcStatus, isDesktop, type SimcStatus } from '../lib/api';

export default function TopHeader() {
  const { user, loading, login, logout, checkCredentialsStatus } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [simcStatus, setSimcStatus] = useState<SimcStatus | null>(null);
  const [simcLoading, setSimcLoading] = useState(false);
  const [simcUpdating, setSimcUpdating] = useState(false);
  const [simcError, setSimcError] = useState<string | null>(null);

  const refreshSimcStatus = useCallback(async () => {
    if (!isDesktop || !user) return;
    setSimcLoading(true);
    setSimcError(null);
    try {
      const status = await getSimcStatus();
      setSimcStatus(status);
    } catch (err: any) {
      setSimcError(err?.detail || err?.message || 'Failed to check SimC update status.');
    } finally {
      setSimcLoading(false);
    }
  }, [user]);

  const handleSimcUpdate = async () => {
    setSimcUpdating(true);
    setSimcError(null);
    try {
      const status = await downloadLatestSimc();
      setSimcStatus(status);
    } catch (err: any) {
      setSimcError(err?.detail || err?.message || 'Failed to update SimC.');
    } finally {
      setSimcUpdating(false);
    }
  };

  const handleLoginClick = async () => {
    const status = await checkCredentialsStatus();
    if (status.globally_configured) {
      login();
    } else {
      setIsModalOpen(true);
    }
  };

  const handleModalConfirm = (clientId: string, clientSecret: string) => {
    setIsModalOpen(false);
    login(clientId, clientSecret);
  };

  useEffect(() => {
    if (!isDesktop || !user) {
      setSimcStatus(null);
      setSimcError(null);
      return;
    }

    void refreshSimcStatus();

    const interval = window.setInterval(() => {
      void refreshSimcStatus();
    }, 120000);

    return () => window.clearInterval(interval);
  }, [user, refreshSimcStatus]);

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-b from-gold to-gold-dark shadow-sm">
              <svg className="h-4 w-4 text-black" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2l10 6-10 6V2z" />
              </svg>
            </div>
            <span className="text-[18px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
              WhyLowDps
            </span>
          </Link>

          <div className="flex items-center gap-4">
            {!loading && (
              <>
                {user ? (
                  <div className="flex items-center gap-4">
                    {isDesktop && simcStatus?.update_available && (
                      <div className="flex flex-col items-end">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                          SimC Update Available
                        </span>
                        <button
                          onClick={() => void handleSimcUpdate()}
                          disabled={simcUpdating || simcLoading}
                          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {simcUpdating ? 'Updating...' : 'Update SimC'}
                        </button>
                      </div>
                    )}
                    <div className="flex flex-col items-end">
                      <span className="text-[13px] font-medium text-gold">{user.battletag}</span>
                      <Link
                        href="/characters"
                        className="text-[11px] text-zinc-400 transition-colors hover:text-white"
                      >
                        My Characters
                      </Link>
                    </div>
                    <div className="h-6 w-px bg-border" />
                    <button
                      onClick={() => logout(true)}
                      className="text-[13px] font-medium text-zinc-400 transition-colors hover:text-white"
                    >
                      Logout
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLoginClick}
                    className="rounded-md bg-[#0074e0] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#005fb8]"
                  >
                    Login with Battle.net
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {isDesktop && simcError && (
          <div className="border-t border-red-900/30 bg-red-950/20 px-6 py-1.5 text-right text-[11px] text-red-300">
            {simcError}
          </div>
        )}
      </header>

      <LoginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleModalConfirm}
      />
    </>
  );
}
