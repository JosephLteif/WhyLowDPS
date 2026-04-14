'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';

export default function TopHeader() {
  const router = useRouter();
  const { user, loading, login, logout, checkCredentialsStatus } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

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

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/');
  };

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-white/5 hover:text-white"
              title="Go back"
              aria-label="Go back"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <path d="M7 3L2 8l5 5" />
                <path d="M3 8h10" />
              </svg>
              Back
            </button>
            <Link href="/" className="group flex items-center gap-2.5">
              <img
                src="/icon.png"
                alt="WhyLowDps"
                className="h-8 w-8 rounded-md shadow-sm ring-1 ring-white/10"
              />
              <span className="text-[18px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
                WhyLowDps
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {!loading && (
              <>
                {user ? (
                  <div className="flex items-center gap-4">
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
      </header>

      <LoginModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleModalConfirm}
      />
    </>
  );
}
