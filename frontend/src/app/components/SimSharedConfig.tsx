'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { useSimContext } from './SimContext';
import TalentPicker from './TalentPicker';
import {
  API_URL,
  deleteCharacterProfile,
  deleteSavedRoute,
  fetchJson,
  isDesktop,
  listCharacterProfiles,
  listSavedRoutes,
  saveCharacterProfile,
  SavedCharacterProfile,
  saveRoute,
} from '../lib/api';
import { SavedRoute, specDisplayName } from '../lib/types';
import { parseCharacterInfo, SimcClipboardInfo } from '@/lib/simc-parser';
import { convertMdtToSimc, isMdtString, parseMdtString } from '@/lib/mdt-parser';
import ClipboardBanner from './shared/ClipboardBanner';
import SimcInputEditor from './shared/SimcInputEditor';
import RouteDetailsModal from './RouteDetailsModal';
import RouteSelectorModal from './RouteSelectorModal';
import ConfirmModal from './ConfirmModal';
import {
  AdvancedOptions,
  CharacterInfoBar,
  ConsumablesAndRaidBuffsOptions,
  DungeonInfoBar,
  FightSetupOptions,
} from './SimSharedConfigSections';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { formatRealmName, resolveClassColor } from '../lib/profile-format';
import {
  normalizeClipboardTextPayload,
  splitSimcProfiles,
  validateChecksum,
} from '../lib/simc-input-utils';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}


export default function SimSharedConfig() {
  const pathname = usePathname();
  const { simcInput, setSimcInput, simcFooter, setSimcFooter, autoClipboardPasteSimc } =
    useSimContext();
  const checksumStatus = useMemo(() => validateChecksum(simcInput), [simcInput]);

  const detectedCharacterInfo = useMemo(() => {
    const info = parseCharacterInfo(simcInput);
    return info?.kind === 'character' ? info : null;
  }, [simcInput]);
  const detectedDungeonInfo = useMemo(() => {
    const info = parseCharacterInfo(simcFooter);
    return info?.kind === 'dungeon' ? info : null;
  }, [simcFooter]);
  const [banner, setBanner] = useState<{ text: string; id: number } | null>(null);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [isRouteModalOpen, setIsRouteModalOpen] = useState(false);
  const [viewingDungeonRoute, setViewingDungeonRoute] = useState<SavedRoute | null>(null);
  const [simcInputHistory, setSimcInputHistory] = useState<string[]>([]);
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number | null>(null);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<'saved' | 'history'>('saved');
  const [bnetProfiles, setBnetProfiles] = useState<SavedCharacterProfile[]>([]);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);

  const deleteTargetProfile = useMemo(
    () => bnetProfiles.find((p) => p.id === deleteProfileId) || null,
    [bnetProfiles, deleteProfileId]
  );
  useDismissOnOutside(historyDropdownRef, historyDropdownOpen, () => setHistoryDropdownOpen(false));

  const addToHistory = useCallback((value: string) => {
    if (!value || value.length < 50) return;

    // Find existing entry by character name (compute before setState)
    const info = parseCharacterInfo(value);
    const charName = info?.kind === 'character' ? info.name : null;

    setSimcInputHistory((prev) => {
      let existingIdx = -1;

      if (charName) {
        existingIdx = prev.findIndex((p) => {
          const existingInfo = parseCharacterInfo(p);
          return existingInfo?.kind === 'character' && existingInfo.name === charName;
        });
      }

      if (existingIdx !== -1) {
        // Update existing entry
        const newHistory = [...prev];
        newHistory[existingIdx] = value;
        return newHistory;
      }

      // Add new entry
      const newHistory = [...prev, value];
      return newHistory.slice(-20);
    });
  }, []);

  // Helper to add to history and return index (for selection)
  const addToHistoryWithSelection = useCallback(
    (value: string): number | null => {
      if (!value || value.length < 50) return null;

      const info = parseCharacterInfo(value);
      const charName = info?.kind === 'character' ? info.name : null;

      // Get current history to find index
      let existingIdx = -1;
      if (charName) {
        existingIdx = simcInputHistory.findIndex((p) => {
          const hInfo = parseCharacterInfo(p);
          return hInfo?.kind === 'character' && hInfo.name === charName;
        });
      }

      const newIdx = existingIdx >= 0 ? existingIdx : simcInputHistory.length;
      addToHistory(value);
      return newIdx;
    },
    [addToHistory, simcInputHistory],
  );

  // Wrap setSimcInput to also track history
  const handleSetSimcInput = useCallback(
    (value: string) => {
      setSimcInput(value);
      if (!value || value.length < 50) {
        setSelectedHistoryIdx(null);
        return;
      }

      // Add to history and get the selected index
      const newIdx = addToHistoryWithSelection(value);
      setSelectedHistoryIdx(newIdx);
    },
    [setSimcInput, addToHistoryWithSelection],
  );

  const isRouteAlreadySaved = useMemo(() => {
    if (!simcFooter || !savedRoutes.length) return false;
    const normalizedCurrent = simcFooter.trim();
    return savedRoutes.some((r) => r.route_data.trim() === normalizedCurrent);
  }, [simcFooter, savedRoutes]);

  const refreshRoutes = useCallback(async () => {
    try {
      const routes = await listSavedRoutes();
      setSavedRoutes(routes);
    } catch (e) {
      console.error('Failed to list saved routes:', e);
    }
  }, []);

  useEffect(() => {
    refreshRoutes();
  }, [refreshRoutes]);

  // Load BNet character profiles when dropdown opens or when tab changes to saved
  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    listCharacterProfiles()
      .then(setBnetProfiles)
      .catch(() => setBnetProfiles([]));
  }, [historyDropdownOpen, historyTab]);

  // Refresh profiles when dropdown is already open (realtime update)
  const refreshProfiles = useCallback(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    listCharacterProfiles()
      .then(setBnetProfiles)
      .catch(() => setBnetProfiles([]));
  }, [historyDropdownOpen, historyTab]);

  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    const interval = setInterval(refreshProfiles, 5000);
    return () => clearInterval(interval);
  }, [historyDropdownOpen, historyTab, refreshProfiles]);

  const handleViewDungeonDetails = () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setViewingDungeonRoute({
      id: 'temporary',
      name: detectedDungeonInfo.title,
      dungeon: detectedDungeonInfo.dungeon || 'Unknown',
      level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
      pull_count: detectedDungeonInfo.pullCount ?? undefined,
      route_data: simcFooter,
      created_at: new Date().toISOString(),
    });
  };

  const handleSaveRoute = async () => {
    if (!detectedDungeonInfo || !simcFooter) return;
    setIsSavingRoute(true);
    try {
      await saveRoute({
        name: detectedDungeonInfo.title,
        dungeon: detectedDungeonInfo.dungeon || 'Unknown',
        level: detectedDungeonInfo.level ? Number(detectedDungeonInfo.level) : undefined,
        pull_count: detectedDungeonInfo.pullCount || undefined,
        route_data: simcFooter,
      });
      await refreshRoutes();
      setBanner({ text: `Saved route: ${detectedDungeonInfo.title}`, id: Date.now() });
    } catch (e) {
      console.error('Failed to save route:', e);
    } finally {
      setIsSavingRoute(false);
    }
  };

  const handleSelectRoute = (route: SavedRoute) => {
    setSimcFooter(route.route_data);
    setBanner({ text: `Loaded route: ${route.name}`, id: Date.now() });
  };

  const handleDeleteRoute = async (id: string) => {
    try {
      await deleteSavedRoute(id);
      await refreshRoutes();
    } catch (e) {
      console.error('Failed to delete route:', e);
    }
  };

  const handleDeleteProfile = useCallback(async () => {
    if (!deleteProfileId) return;
    try {
      await deleteCharacterProfile(deleteProfileId);
      setBnetProfiles((prev) => prev.filter((p) => p.id !== deleteProfileId));
      if (selectedSavedId === deleteProfileId) {
        setSelectedSavedId(null);
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  }, [deleteProfileId, selectedSavedId]);

  const bannerTimerRef = useRef<number | null>(null);
  const lastAppliedClipboardRef = useRef<string>('');
  const simcInputRef = useRef<string>(simcInput);

  useEffect(() => {
    simcInputRef.current = simcInput;
  }, [simcInput]);

  const normalizedPath =
    pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;

  const showConfig =
    normalizedPath === '/quick-sim' ||
    normalizedPath === '/top-gear' ||
    normalizedPath === '/drop-finder' ||
    normalizedPath === '/stat-weights' ||
    normalizedPath.startsWith('/analysis') ||
    normalizedPath.startsWith('/upgrade');

  const selectedProfileMeta = useMemo(() => {
    if (selectedSavedId !== null) {
      const saved = bnetProfiles.find((p) => p.id === selectedSavedId);
      if (!saved) return null;
      const classLabel = [saved.spec ? specDisplayName(saved.spec) : null, saved.class]
        .filter(Boolean)
        .join(' ');
      const realmLabel = [formatRealmName(saved.realm), saved.region ? `(${saved.region})` : null]
        .filter(Boolean)
        .join(' ');
      return {
        name: saved.name,
        classLabel: classLabel || saved.class || null,
        classColor: resolveClassColor(saved.class),
        combinedLabel:
          saved.name && (classLabel || saved.class)
            ? `${saved.name} - ${classLabel || saved.class}`
            : saved.name || classLabel || saved.class || 'Select profile',
        realmLabel: realmLabel || null,
      };
    }

    if (selectedHistoryIdx !== null) {
      const profile = simcInputHistory[selectedHistoryIdx];
      if (!profile) return null;
      const info = parseCharacterInfo(profile);
      if (info?.kind === 'character') {
        const classLabel = [specDisplayName(info.spec), info.className].filter(Boolean).join(' ');
        const realmLabel = [info.server, info.region ? `(${info.region})` : null]
          .filter(Boolean)
          .join(' ');
        return {
          name: info.name,
          classLabel,
          classColor: resolveClassColor(info.className),
          combinedLabel:
            info.name && classLabel
              ? `${info.name} - ${classLabel}`
              : info.name || classLabel || `Profile ${selectedHistoryIdx + 1}`,
          realmLabel: realmLabel || null,
        };
      }
      return {
        name: `Profile ${selectedHistoryIdx + 1}`,
        classLabel: null,
        classColor: undefined,
        combinedLabel: `Profile ${selectedHistoryIdx + 1}`,
        realmLabel: null,
      };
    }

    return null;
  }, [bnetProfiles, selectedHistoryIdx, selectedSavedId, simcInputHistory]);

  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      // Native desktop invoke can be slower on some systems; avoid aggressive timeout here.
      const raw = await invoke<unknown>('get_clipboard_text');
      const normalized = normalizeClipboardTextPayload(raw);
      if (normalized) return normalized;
    } catch {}

    if (navigator.clipboard?.readText) {
      try {
        return await withTimeout(navigator.clipboard.readText(), 2500);
      } catch {}
    }
    return '';
  }, []);

  useEffect(() => {
    // On mount, capture current clipboard so we only auto-paste *new* changes.
    void readClipboardText().then((text) => {
      if (text) lastAppliedClipboardRef.current = text.trim();
    });
  }, [readClipboardText]);

  useEffect(() => {
    if (typeof window === 'undefined' || !autoClipboardPasteSimc) return;
    let cancelled = false;

    const readClipboardIntoSimc = async (isFocusTrigger = false) => {
      try {
        if (document.visibilityState === 'hidden') return;
        const text = await readClipboardText();
        if (cancelled || !text) return;

        // Always track the last seen clipboard text to avoid re-processing non-SimC text repeatedly.
        // We trim to handle trailing whitespace differences that can happen on some systems.
        const trimmedText = text.trim();
        if (trimmedText === lastAppliedClipboardRef.current) {
          return;
        }
        lastAppliedClipboardRef.current = trimmedText;

        const profiles = splitSimcProfiles(text);
        if (profiles.length === 0) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard content is not a SimC profile.');
          return;
        }

        const first = profiles[0];
        // If it's already what we have in the editor, skip to avoid overwrite.
        if (first.trim() === simcInputRef.current.trim()) {
          if (isFocusTrigger)
            console.log('[SimSharedConfig] Clipboard matches current input, skipping.');
          return;
        }

        if (isMdtString(first)) {
          const mdtInfo = parseMdtString(first) as SimcClipboardInfo | null;
          if (mdtInfo && mdtInfo.kind === 'dungeon') {
            console.log(
              '[SimSharedConfig] Auto-pasting MDT route:',
              (mdtInfo as { title: string }).title,
            );
            const simcData = convertMdtToSimc(mdtInfo);
            setSimcFooter(simcData);
            setBanner({
              text: `Detected and converted MDT route: ${(mdtInfo as { title: string }).title}`,
              id: Date.now(),
            });
            return;
          }
        }

        const info = parseCharacterInfo(first);
        if (info?.kind === 'dungeon') {
          console.log('[SimSharedConfig] Auto-pasting dungeon route:', info.title);
          setSimcFooter(first);
          setBanner({ text: `Detected dungeon route: ${info.title}`, id: Date.now() });
        } else if (info?.kind === 'character') {
          console.log('[SimSharedConfig] Auto-pasting character:', info.name);
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });

          // Try to save character profile if character is in BNet roster
          if (info.name && info.server) {
            try {
              const bnetData = await fetchJson<{
                characters: Array<{ name: string; realm: string; region: string }>;
              }>(`${API_URL}/api/bnet/user/characters`).catch(() => ({ characters: [] }));
              const characters = bnetData.characters || [];
              const bnetChar = characters.find(
                (c: any) =>
                  c.name.toLowerCase() === info.name?.toLowerCase() &&
                  c.realm.toLowerCase() === info.server?.toLowerCase(),
              );
              if (bnetChar) {
                await saveCharacterProfile({
                  name: info.name,
                  realm: info.server,
                  region: info.region || 'us',
                  class: info.className,
                  spec: info.spec,
                  simc_input: first,
                });
                console.log('[SimSharedConfig] Saved character profile for:', info.name);
              }
            } catch (e) {
              console.error('[SimSharedConfig] Failed to save character profile:', e);
            }
          }
        } else {
          console.log(
            '[SimSharedConfig] Detected SimC content but could not parse info, pasting anyway.',
          );
          const newIdx = addToHistoryWithSelection(first);
          setSelectedHistoryIdx(newIdx);
          setSimcInput(first);
          setBanner({ text: 'Detected and pasted SimC export.', id: Date.now() });
        }
      } catch (err) {
        console.error('[SimSharedConfig] Auto-paste failed:', err);
      }
    };

    const onFocus = () => void readClipboardIntoSimc(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void readClipboardIntoSimc(true);
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    autoClipboardPasteSimc,
    readClipboardText,
    setSimcFooter,
    setSimcInput,
    addToHistoryWithSelection,
  ]);

  useEffect(() => {
    if (!banner) return;
    if (bannerTimerRef.current != null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    bannerTimerRef.current = window.setTimeout(() => {
      setBanner(null);
      bannerTimerRef.current = null;
    }, 3500);
    return () => {
      if (bannerTimerRef.current != null) {
        window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, [banner]);

  if (!showConfig) return null;

  return (
    <div className="mb-6 space-y-4">
      {banner && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[90]">
          <ClipboardBanner message={banner.text} onDismiss={() => setBanner(null)} />
        </div>
      )}
      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <label className="label-text">SimC Addon Export</label>
          <div ref={historyDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setHistoryDropdownOpen(!historyDropdownOpen)}
              className="flex min-w-[220px] items-center justify-between gap-3 rounded-md border border-gold/35 bg-surface-2/95 px-3 py-1.5 text-left shadow-sm shadow-black/30 transition-colors hover:border-gold/60 hover:bg-surface"
            >
              <div className="min-w-0">
                {selectedProfileMeta?.name && selectedProfileMeta?.classLabel ? (
                  <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">
                    <span>{selectedProfileMeta.name}</span>
                    <span className="text-zinc-100"> - </span>
                    <span style={{ color: selectedProfileMeta.classColor || '#f4f4f5' }}>
                      {selectedProfileMeta.classLabel}
                    </span>
                  </p>
                ) : (
                  <p className="truncate text-[13px] font-semibold tracking-tight text-zinc-100">
                    {selectedProfileMeta?.combinedLabel || 'Select profile'}
                  </p>
                )}
                <p className="truncate text-[12px] font-medium text-zinc-100">
                  {selectedProfileMeta?.realmLabel || 'Saved and recent exports'}
                </p>
              </div>
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${historyDropdownOpen ? 'rotate-180 text-zinc-300' : ''}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.5 6.5L8 11l4.5-4.5" />
              </svg>
            </button>
            {historyDropdownOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[320px] overflow-hidden rounded-lg border border-border bg-surface/95 shadow-2xl backdrop-blur"
              >
                <div className="flex border-b border-border">
                  <button
                    type="button"
                    onClick={() => setHistoryTab('saved')}
                    className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      historyTab === 'saved'
                        ? 'border-gold text-gold'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Saved ({bnetProfiles.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryTab('history')}
                    className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                      historyTab === 'history'
                        ? 'border-gold text-gold'
                        : 'border-transparent text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    History ({simcInputHistory.length})
                  </button>
                </div>
                <div className="max-h-[240px] overflow-y-auto">
                  {historyTab === 'saved' ? (
                    bnetProfiles.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[12px] text-zinc-500">
                        No saved character profiles
                      </div>
                    ) : (
                      bnetProfiles.map((profile) => (
                        <div
                          key={profile.id}
                          className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-2/70"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSavedId(profile.id);
                              setSelectedHistoryIdx(null);
                              setSimcInput(profile.simc_input);
                              addToHistory(profile.simc_input);
                              setHistoryDropdownOpen(false);
                            }}
                            className={`flex-1 text-left ${
                              selectedSavedId === profile.id ? 'text-gold' : ''
                            }`}
                          >
                            <div
                              className="text-[13px] font-semibold text-zinc-100"
                            >
                              {profile.name}
                            </div>
                            <div className="text-[11px] font-medium text-zinc-100">
                              {formatRealmName(profile.realm)} ({profile.region})
                            </div>
                          </button>
                          <span
                            className="text-[11px] font-medium"
                            style={{ color: resolveClassColor(profile.class) || '#71717a' }}
                          >
                            {[profile.spec ? specDisplayName(profile.spec) : null, profile.class]
                              .filter(Boolean)
                              .join(' ')}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteProfileId(profile.id);
                            }}
                            className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      ))
                    )
                  ) : simcInputHistory.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-zinc-500">
                      No history yet
                    </div>
                  ) : (
                    simcInputHistory.map((profile, idx) => {
                      const info = parseCharacterInfo(profile);
                      const name = info?.kind === 'character' ? info.name : `Profile ${idx + 1}`;
                      const charClass = info?.kind === 'character' ? info.className : null;
                      const charSpec = info?.kind === 'character' ? info.spec : null;
                      const realm = info?.kind === 'character' ? info.server : null;
                      const region = info?.kind === 'character' ? info.region : null;
                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between px-3 py-2 hover:bg-surface-2/70 ${
                            selectedHistoryIdx === idx ? 'bg-surface-2/70' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHistoryIdx(idx);
                              setSimcInput(simcInputHistory[idx]);
                              setHistoryDropdownOpen(false);
                            }}
                            className={`flex-1 text-left ${
                              selectedHistoryIdx === idx ? 'text-gold' : ''
                            }`}
                          >
                            <div
                              className="text-[13px] font-semibold text-zinc-100"
                            >
                              {name}
                            </div>
                            {info?.kind === 'character' && (realm || region) && (
                              <div className="text-[11px] font-medium text-zinc-100">
                                {formatRealmName(realm)}
                                {region ? ` (${region})` : ''}
                              </div>
                            )}
                          </button>
                          {charClass && (
                            <span
                              className="text-[11px] font-medium"
                              style={{ color: resolveClassColor(charClass) || '#71717a' }}
                            >
                              {[charSpec ? specDisplayName(charSpec) : null, charClass]
                                .filter(Boolean)
                                .join(' ')}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newHistory = simcInputHistory.filter((_, i) => i !== idx);
                              setSimcInputHistory(newHistory);
                              if (selectedHistoryIdx === idx) {
                                setSelectedHistoryIdx(null);
                              } else if (selectedHistoryIdx !== null && selectedHistoryIdx > idx) {
                                setSelectedHistoryIdx(selectedHistoryIdx - 1);
                              }
                            }}
                            className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                {historyTab === 'history' && simcInputHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSimcInputHistory([]);
                      setSelectedHistoryIdx(null);
                      setHistoryDropdownOpen(false);
                    }}
                    className="w-full border-t border-border px-3 py-2 text-left text-[12px] text-red-400 hover:bg-red-500/10"
                  >
                    ✕ Clear All
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <SimcInputEditor
          value={simcInput}
          onChange={handleSetSimcInput}
          placeholder="Paste your SimC addon export here..."
        />
        {checksumStatus === 'invalid' && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <svg
              className="h-4 w-4 shrink-0 text-amber-400"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M8 1L1 14h14L8 1zM8 6v4M8 12v.5" />
            </svg>
            <p className="text-[14px] text-amber-300">
              This input appears to have been manually edited. Results may not reflect your actual
              in-game character.
            </p>
          </div>
        )}
        {detectedCharacterInfo && <CharacterInfoBar info={detectedCharacterInfo} />}
        {detectedDungeonInfo && (
          <DungeonInfoBar
            info={detectedDungeonInfo}
            onSave={handleSaveRoute}
            onViewDetails={handleViewDungeonDetails}
            isSaving={isSavingRoute}
            isAlreadySaved={isRouteAlreadySaved}
          />
        )}

        {viewingDungeonRoute && (
          <RouteDetailsModal
            route={viewingDungeonRoute}
            onClose={() => setViewingDungeonRoute(null)}
          />
        )}

        <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-zinc-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            <span className="text-[13px] font-bold tracking-tight text-zinc-400">
              Dungeon Route
            </span>
          </div>
          <button
            onClick={() => setIsRouteModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-zinc-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <span>{savedRoutes.length} Saved Routes</span>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>

        <RouteSelectorModal
          isOpen={isRouteModalOpen}
          onClose={() => setIsRouteModalOpen(false)}
          routes={savedRoutes}
          onSelect={handleSelectRoute}
          onDelete={handleDeleteRoute}
        />
        <ConfirmModal
          isOpen={!!deleteProfileId}
          onClose={() => setDeleteProfileId(null)}
          onConfirm={handleDeleteProfile}
          title="Delete SimC Profile"
          message={`Are you sure you want to delete the saved SimC profile for ${deleteTargetProfile?.name || 'this character'}? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
        />
      </div>
      <TalentPicker />
      <FightSetupOptions />
      <ConsumablesAndRaidBuffsOptions />
      <AdvancedOptions />
    </div>
  );
}
