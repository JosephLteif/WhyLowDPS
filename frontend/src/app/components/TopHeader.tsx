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

  const handleSidebarToggle = () => {
    window.dispatchEvent(new Event('whylowdps:toggle-sidebar'));
  };

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between gap-2 px-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSidebarToggle}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition-all hover:border-zinc-500 hover:bg-white/5 hover:text-white xl:hidden"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2.5 4h11" />
                <path d="M2.5 8h11" />
                <path d="M2.5 12h11" />
              </svg>
            </button>
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-white/5 hover:text-white sm:px-3"
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
              <span className="hidden sm:inline">Back</span>
            </button>
            <Link href="/" className="group flex items-center gap-2.5">
              <img
                src="/icon.png"
                alt="WhyLowDps"
                className="h-8 w-8 object-contain drop-shadow-sm"
              />
              <span className="text-[17px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white sm:text-[18px]">
                WhyLowDps
              </span>
            </Link>
          </div>

          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {!loading && (
              <>
                {user ? (
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div className="hidden h-6 w-px bg-border sm:block" />
                    <div className="hidden min-w-0 flex-col items-end sm:flex">
                      <span className="truncate text-[13px] font-medium text-gold">{user.battletag}</span>
                      <Link
                        href="/characters"
                        className="text-[13px] text-zinc-300 transition-colors hover:text-white"
                      >
                        My Characters
                      </Link>
                    </div>
                    <button
                      onClick={() => logout(true)}
                      className="text-[14px] font-medium text-zinc-300 transition-colors hover:text-white"
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
