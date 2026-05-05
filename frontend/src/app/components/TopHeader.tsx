'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import { API_URL, fetchJsonCached, isDesktop } from '../lib/api';
import { characterHref } from '../lib/routes';

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
  const { user, loading, login, logout, checkCredentialsStatus } = useAuth();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [characterRegion, setCharacterRegion] = useState('us');
  const [characterRealm, setCharacterRealm] = useState('');
  const [realmOptions, setRealmOptions] = useState<RealmOption[]>([]);
  const [isMaximized, setIsMaximized] = useState(false);

  const handleLoginClick = async () => {
    const status = await checkCredentialsStatus();
    if (status.globally_configured) login();
    else setIsModalOpen(true);
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

  const handleWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (!isDesktop) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    if (action === 'maximize') {
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    }
    if (action === 'close') await win.close();
  };

  useEffect(() => {
    if (!isDesktop) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        setIsMaximized(await win.isMaximized());
      });
    })();
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadDefaultRegion = async () => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRealmOptions = async () => {
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
  }, [characterRegion]);

  useEffect(() => {
    if (!characterRealm && realmOptions.length > 0) setCharacterRealm(realmOptions[0].slug);
  }, [realmOptions, characterRealm]);

  const handleCharacterSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedName = characterName.trim();
    const trimmedRealm = characterRealm.trim();
    if (!trimmedName || !trimmedRealm) return;
    router.push(characterHref(characterRegion, trimmedRealm, trimmedName));
  };

  return (
    <>
      <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-bg/90 backdrop-blur-xl">
        {isDesktop && (
          <div data-tauri-drag-region className="relative h-8 border-b border-white/5">
            <Link data-tauri-drag-region="false" href="/" className="absolute left-2 top-0 flex h-8 items-center gap-2 pr-2">
              <img src="/icon.png" alt="WhyLowDps" className="h-5 w-5 object-contain" />
              <span className="text-[14px] font-semibold tracking-tight text-zinc-100">WhyLowDps</span>
            </Link>
            <div data-tauri-drag-region="false" className="absolute right-0 top-0 flex h-8 items-center">
              <button onClick={() => void handleWindowAction('minimize')} className="grid h-8 w-10 place-items-center text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100" title="Minimize">
                <span className="mb-1 block h-px w-3 bg-current" />
              </button>
              <button onClick={() => void handleWindowAction('maximize')} className="grid h-8 w-10 place-items-center text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100" title={isMaximized ? 'Restore' : 'Maximize'}>
                <span className="block h-2.5 w-2.5 border border-current" />
              </button>
              <button onClick={() => void handleWindowAction('close')} className="grid h-8 w-10 place-items-center text-zinc-400 transition-colors hover:bg-red-500/85 hover:text-white" title="Close">
                <span className="text-sm leading-none">x</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid h-12 grid-cols-[auto_1fr_auto] items-center gap-3 px-3 md:px-5">
          <div className="flex items-center gap-2">
            <button data-tauri-drag-region="false" type="button" onClick={handleSidebarToggle} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white xl:hidden" title="Toggle sidebar" aria-label="Toggle sidebar">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M2.5 4h11" />
                <path d="M2.5 8h11" />
                <path d="M2.5 12h11" />
              </svg>
            </button>
            <button data-tauri-drag-region="false" type="button" onClick={handleBack} className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-white/5 hover:text-white" title="Go back" aria-label="Go back">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M7 3L2 8l5 5" />
                <path d="M3 8h10" />
              </svg>
              <span className="hidden sm:inline">Back</span>
            </button>
          </div>

          <form data-tauri-drag-region="false" onSubmit={handleCharacterSearch} className="mx-auto hidden w-full max-w-[560px] items-center gap-1.5 xl:flex">
            <input type="text" value={characterName} onChange={(e) => setCharacterName(e.target.value)} placeholder="Character" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none" aria-label="Character name" />
            <select value={characterRegion} onChange={(e) => setCharacterRegion(e.target.value)} className="h-8 w-16 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none" aria-label="Character region">
              <option value="us">US</option><option value="eu">EU</option><option value="kr">KR</option><option value="tw">TW</option>
            </select>
            <select value={characterRealm} onChange={(e) => setCharacterRealm(e.target.value)} className="h-8 w-40 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-zinc-200 focus:border-zinc-500 focus:outline-none" aria-label="Character realm">
              {realmOptions.length === 0 ? <option value="">Realm</option> : realmOptions.map((realm) => <option key={realm.slug} value={realm.slug}>{realm.name}</option>)}
            </select>
            <button type="submit" className="h-8 rounded-md border border-gold/25 bg-gold/15 px-3 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/25">Go</button>
          </form>

          <div data-tauri-drag-region="false" className="flex items-center gap-3 justify-self-end">
            {!loading && (user ? (
              <div className="flex items-center gap-3">
                <div className="hidden h-6 w-px bg-border sm:block" />
                <div className="hidden min-w-0 flex-col items-end sm:flex">
                  <span className="truncate text-[13px] font-medium text-gold">{user.battletag}</span>
                  <Link href="/characters" className="text-[13px] text-zinc-300 transition-colors hover:text-white">My Characters</Link>
                </div>
                <button onClick={() => logout(true)} className="text-[14px] font-medium text-zinc-300 transition-colors hover:text-white">Logout</button>
              </div>
            ) : (
              <button onClick={handleLoginClick} className="rounded-md bg-[#0074e0] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#005fb8]">Login with Battle.net</button>
            ))}
          </div>
        </div>
      </header>

      <LoginModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onConfirm={handleModalConfirm} />
    </>
  );
}
