'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Menu, Sparkles } from 'lucide-react';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import { API_URL, fetchJsonCached } from '../lib/api';
import { characterHref } from '../lib/routes';
import DesktopWindowTitleBar from './DesktopWindowTitleBar';
import { CHANGELOG_OPEN_EVENT } from './ChangelogPopup';

type SearchCharacter = {
  realm: string;
  region: string;
};

type RealmOption = {
  slug: string;
  name: string;
};

export default function TopHeader() {
  const router = useRouter();
  const { user, loading, lightMode, disableLightMode, login, logout, checkCredentialsStatus } =
    useAuth();
  const headerRef = useRef<HTMLElement | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [characterRegion, setCharacterRegion] = useState('us');
  const [characterRealm, setCharacterRealm] = useState('');
  const [realmOptions, setRealmOptions] = useState<RealmOption[]>([]);

  const handleLoginClick = async () => {
    const status = await checkCredentialsStatus();
    if (status.globally_configured) login();
    else setIsModalOpen(true);
  };

  const handleModalConfirm = (clientId: string, clientSecret: string, credentialId?: string) => {
    setIsModalOpen(false);
    login(clientId, clientSecret, credentialId);
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

  const handleWhatsNew = () => {
    window.dispatchEvent(new Event(CHANGELOG_OPEN_EVENT));
  };

  useEffect(() => {
    let cancelled = false;
    const loadDefaultRegion = async () => {
      if (lightMode) return;
      try {
        const res = await fetchJsonCached<{ characters?: SearchCharacter[] }>(
          `${API_URL}/api/bnet/user/characters`,
          { ttl: 600000 }
        );
        if (cancelled) return;
        const chars = Array.isArray(res?.characters) ? res.characters : [];
        const preferred = chars.find((c) => c?.region)?.region?.toLowerCase();
        if (preferred) setCharacterRegion(preferred);
      } catch {}
    };
    void loadDefaultRegion();
    return () => {
      cancelled = true;
    };
  }, [lightMode]);

  useEffect(() => {
    let cancelled = false;
    const loadRealmOptions = async () => {
      if (lightMode) {
        setRealmOptions([]);
        return;
      }
      try {
        const res = await fetchJsonCached<{ realms?: RealmOption[] }>(
          `${API_URL}/api/blizzard/realms?region=${encodeURIComponent(characterRegion)}`,
          { ttl: 86400000 }
        );
        if (cancelled) return;
        setRealmOptions(Array.isArray(res?.realms) ? res.realms : []);
      } catch {
        if (!cancelled) setRealmOptions([]);
      }
    };
    void loadRealmOptions();
    return () => {
      cancelled = true;
    };
  }, [characterRegion, lightMode]);

  useEffect(() => {
    if (!characterRealm && realmOptions.length > 0) setCharacterRealm(realmOptions[0].slug);
  }, [realmOptions, characterRealm]);

  useLayoutEffect(() => {
    const applyHeaderHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight;
      if (!headerHeight) return;
      document.body.style.setProperty('--app-header-height', `${headerHeight}px`);
      window.dispatchEvent(new Event('whylowdps:layout-updated'));
    };

    applyHeaderHeight();

    const header = headerRef.current;
    const observer =
      header && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            applyHeaderHeight();
          })
        : null;

    if (header && observer) {
      observer.observe(header);
    }

    window.addEventListener('resize', applyHeaderHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', applyHeaderHeight);
      document.body.style.setProperty('--app-header-height', '3rem');
    };
  }, []);

  const handleCharacterSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = characterName.trim();
    const trimmedRealm = characterRealm.trim();
    if (!trimmedName || !trimmedRealm) return;
    router.push(characterHref(characterRegion, trimmedRealm, trimmedName));
  };

  return (
    <>
      <header
        ref={headerRef}
        className="fixed top-0 z-50 w-full border-b border-white/5 bg-bg/90 backdrop-blur-xl"
      >
        <DesktopWindowTitleBar />

        <div className="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-3 px-3 md:px-5">
          <div className="flex items-center gap-2">
            <button
              data-tauri-drag-region="false"
              type="button"
              onClick={handleSidebarToggle}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white xl:hidden"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-4 w-4" strokeWidth={2} />
            </button>
            <button
              data-tauri-drag-region="false"
              type="button"
              onClick={handleBack}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white"
              title="Go back"
              aria-label="Go back"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden sm:inline">Back</span>
            </button>
          </div>

          {!lightMode && (
            <form
              data-tauri-drag-region="false"
              onSubmit={handleCharacterSearch}
              className="mx-auto hidden w-full max-w-[560px] items-center gap-1.5 xl:flex"
            >
              <input
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder="Character"
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
                aria-label="Character name"
              />
              <select
                value={characterRegion}
                onChange={(e) => setCharacterRegion(e.target.value)}
                className="h-8 w-16 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
                aria-label="Character region"
              >
                <option value="us">US</option>
                <option value="eu">EU</option>
                <option value="kr">KR</option>
                <option value="tw">TW</option>
              </select>
              <select
                value={characterRealm}
                onChange={(e) => setCharacterRealm(e.target.value)}
                className="h-8 w-40 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
                aria-label="Character realm"
              >
                {realmOptions.length === 0 ? (
                  <option value="">Realm</option>
                ) : (
                  realmOptions.map((realm) => (
                    <option key={realm.slug} value={realm.slug}>
                      {realm.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="submit"
                className="h-8 rounded-md border border-gold/25 bg-gold/15 px-3 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25"
              >
                Go
              </button>
            </form>
          )}

          <div data-tauri-drag-region="false" className="flex items-center gap-3 justify-self-end">
            <button
              type="button"
              onClick={handleWhatsNew}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-semibold text-zinc-200 transition-colors hover:bg-white/[0.1] hover:text-white"
              title="What's new"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              <span className="hidden md:inline">What&apos;s new</span>
            </button>
            {!loading &&
              (lightMode ? (
                <div className="flex items-center gap-2">
                  <span className="hidden text-[13px] font-medium text-zinc-300 sm:inline">
                    Light mode
                  </span>
                  <button
                    onClick={disableLightMode}
                    className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-zinc-100 transition-colors hover:bg-white/10"
                  >
                    Full mode
                  </button>
                </div>
              ) : user ? (
                <div className="flex items-center gap-3">
                  <div className="hidden h-6 w-px bg-border sm:block" />
                  <div className="hidden min-w-0 flex-col items-end sm:flex">
                    <span className="truncate text-[13px] font-medium text-gold">
                      {user.battletag}
                    </span>
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
              ))}
          </div>
        </div>
        {!lightMode && (
          <form
            data-tauri-drag-region="false"
            onSubmit={handleCharacterSearch}
            className="flex items-center gap-1.5 border-t border-white/5 px-3 py-2 md:px-5 xl:hidden"
          >
            <input
              type="text"
              value={characterName}
              onChange={(e) => setCharacterName(e.target.value)}
              placeholder="Character"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              aria-label="Character name"
            />
            <select
              value={characterRegion}
              onChange={(e) => setCharacterRegion(e.target.value)}
              className="h-8 w-16 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
              aria-label="Character region"
            >
              <option value="us">US</option>
              <option value="eu">EU</option>
              <option value="kr">KR</option>
              <option value="tw">TW</option>
            </select>
            <select
              value={characterRealm}
              onChange={(e) => setCharacterRealm(e.target.value)}
              className="h-8 w-28 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none"
              aria-label="Character realm"
            >
              {realmOptions.length === 0 ? (
                <option value="">Realm</option>
              ) : (
                realmOptions.map((realm) => (
                  <option key={realm.slug} value={realm.slug}>
                    {realm.name}
                  </option>
                ))
              )}
            </select>
            <button
              type="submit"
              className="h-8 rounded-md border border-gold/25 bg-gold/15 px-3 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25"
            >
              Go
            </button>
          </form>
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
