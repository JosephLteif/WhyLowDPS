'use client';

import { parseCharacterInfo } from '@/lib/simc-parser';
import { specDisplayName } from '../lib/types';
import { formatRealmName, resolveClassColor } from '../lib/profile-format';
import type { SavedCharacterProfile } from '../lib/api';
import type { HistoryTab, SelectedProfileMeta } from './useSimcProfileSelector';

type SimcProfileDropdownProps = {
  historyDropdownRef: React.RefObject<HTMLDivElement>;
  historyDropdownOpen: boolean;
  setHistoryDropdownOpen: (value: boolean) => void;
  selectedProfileMeta: SelectedProfileMeta;
  historyTab: HistoryTab;
  setHistoryTab: (tab: HistoryTab) => void;
  bnetProfiles: SavedCharacterProfile[];
  simcInputHistory: string[];
  selectedSavedId: string | null;
  selectedHistoryIdx: number | null;
  onSelectSavedProfile: (profile: SavedCharacterProfile) => void;
  onRequestDeleteSavedProfile: (id: string) => void;
  onSelectHistoryProfile: (idx: number) => void;
  onDeleteHistoryProfile: (idx: number) => void;
  onClearHistory: () => void;
};

export default function SimcProfileDropdown({
  historyDropdownRef,
  historyDropdownOpen,
  setHistoryDropdownOpen,
  selectedProfileMeta,
  historyTab,
  setHistoryTab,
  bnetProfiles,
  simcInputHistory,
  selectedSavedId,
  selectedHistoryIdx,
  onSelectSavedProfile,
  onRequestDeleteSavedProfile,
  onSelectHistoryProfile,
  onDeleteHistoryProfile,
  onClearHistory,
}: SimcProfileDropdownProps) {
  return (
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
          className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
            historyDropdownOpen ? 'rotate-180 text-zinc-300' : ''
          }`}
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
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[320px] overflow-hidden rounded-lg border border-border bg-surface/95 shadow-2xl backdrop-blur">
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
                      onClick={() => onSelectSavedProfile(profile)}
                      className={`flex-1 text-left ${
                        selectedSavedId === profile.id ? 'text-gold' : ''
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-zinc-100">{profile.name}</div>
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
                        onRequestDeleteSavedProfile(profile.id);
                      }}
                      className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )
            ) : simcInputHistory.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-zinc-500">No history yet</div>
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
                      onClick={() => onSelectHistoryProfile(idx)}
                      className={`flex-1 text-left ${
                        selectedHistoryIdx === idx ? 'text-gold' : ''
                      }`}
                    >
                      <div className="text-[13px] font-semibold text-zinc-100">{name}</div>
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
                        onDeleteHistoryProfile(idx);
                      }}
                      className="ml-2 text-[10px] text-zinc-500 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {historyTab === 'history' && simcInputHistory.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="w-full border-t border-border px-3 py-2 text-left text-[12px] text-red-400 hover:bg-red-500/10"
            >
              Clear All
            </button>
          )}
        </div>
      )}
    </div>
  );
}
