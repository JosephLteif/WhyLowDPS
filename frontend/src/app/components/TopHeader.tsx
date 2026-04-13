'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';

export default function TopHeader() {
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

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-border/80 bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-6">
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
