'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteCharacterProfile,
  listCharacterProfiles,
  type SavedCharacterProfile,
} from '../lib/api';
import { parseCharacterInfo } from '@/lib/simc-parser';
import { useDismissOnOutside } from '../lib/useDismissOnOutside';
import { formatRealmName, resolveClassColor } from '../lib/profile-format';
import { specDisplayName } from '../lib/types';

function titleCaseWords(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export type HistoryTab = 'saved' | 'history';

export const SIMC_INPUT_HISTORY_STORAGE_KEY = 'whylowdps_simc_input_history';

export type SelectedProfileMeta = {
  name: string;
  classLabel: string | null;
  classColor: string | undefined;
  combinedLabel: string;
  realmLabel: string | null;
} | null;

type UseSimcProfileSelectorArgs = {
  simcInput: string;
  setSimcInput: (value: string) => void;
};

export function useSimcProfileSelector({ simcInput, setSimcInput }: UseSimcProfileSelectorArgs) {
  const [simcInputHistory, setSimcInputHistory] = useState<string[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number | null>(null);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [historyDropdownOpen, setHistoryDropdownOpen] = useState(false);
  const [historyTab, setHistoryTab] = useState<HistoryTab>('saved');
  const [bnetProfiles, setBnetProfiles] = useState<SavedCharacterProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);
  const lastAutoSelectedInputRef = useRef<string | null>(null);
  useDismissOnOutside(historyDropdownRef, historyDropdownOpen, () => setHistoryDropdownOpen(false));

  const deleteTargetProfile = useMemo(
    () => bnetProfiles.find((p) => p.id === deleteProfileId) || null,
    [bnetProfiles, deleteProfileId]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIMC_INPUT_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSimcInputHistory(
            parsed
              .filter((value): value is string => typeof value === 'string' && value.length >= 50)
              .slice(-20)
          );
        }
      }
    } catch {}
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      if (simcInputHistory.length === 0) {
        window.localStorage.removeItem(SIMC_INPUT_HISTORY_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          SIMC_INPUT_HISTORY_STORAGE_KEY,
          JSON.stringify(simcInputHistory)
        );
      }
    } catch {}
  }, [historyLoaded, simcInputHistory]);

  const addToHistory = useCallback((value: string) => {
    if (!value || value.length < 50) return;

    const info = parseCharacterInfo(value);
    const charName = info?.kind === 'character' ? info.name : null;

    setSimcInputHistory((prev) => {
      let existingIdx = -1;

      if (charName) {
        existingIdx = prev.findIndex((profile) => {
          const existingInfo = parseCharacterInfo(profile);
          return existingInfo?.kind === 'character' && existingInfo.name === charName;
        });
      }

      if (existingIdx !== -1) {
        const next = [...prev];
        next[existingIdx] = value;
        return next;
      }

      return [...prev, value].slice(-20);
    });
  }, []);

  const addToHistoryWithSelection = useCallback(
    (value: string): number | null => {
      if (!value || value.length < 50) return null;

      const info = parseCharacterInfo(value);
      const charName = info?.kind === 'character' ? info.name : null;

      let existingIdx = -1;
      if (charName) {
        existingIdx = simcInputHistory.findIndex((profile) => {
          const profileInfo = parseCharacterInfo(profile);
          return profileInfo?.kind === 'character' && profileInfo.name === charName;
        });
      }

      const newIdx = existingIdx >= 0 ? existingIdx : simcInputHistory.length;
      addToHistory(value);
      return newIdx;
    },
    [addToHistory, simcInputHistory]
  );

  const handleSetSimcInput = useCallback(
    (value: string) => {
      setSimcInput(value);
      if (!value || value.length < 50) {
        setSelectedHistoryIdx(null);
        setSelectedSavedId(null);
        return;
      }

      const newIdx = addToHistoryWithSelection(value);
      setSelectedSavedId(null);
      setSelectedHistoryIdx(newIdx);
    },
    [addToHistoryWithSelection, setSimcInput]
  );

  useEffect(() => {
    const normalizedInput = simcInput.trim();
    if (!normalizedInput || simcInput.length < 50) {
      lastAutoSelectedInputRef.current = normalizedInput;
      if (selectedHistoryIdx !== null) setSelectedHistoryIdx(null);
      if (selectedSavedId !== null) setSelectedSavedId(null);
      return;
    }

    const selectedSavedProfile = bnetProfiles.find((profile) => profile.id === selectedSavedId);
    if (selectedSavedProfile?.simc_input.trim() === normalizedInput) {
      if (selectedHistoryIdx !== null) setSelectedHistoryIdx(null);
      return;
    }

    const selectedHistoryProfile =
      selectedHistoryIdx !== null ? simcInputHistory[selectedHistoryIdx] : undefined;
    if (selectedHistoryProfile?.trim() === normalizedInput) {
      if (selectedSavedId !== null) setSelectedSavedId(null);
      return;
    }

    const matchingSavedProfile = bnetProfiles.find(
      (profile) => profile.simc_input.trim() === normalizedInput
    );
    if (matchingSavedProfile) {
      setSelectedSavedId(matchingSavedProfile.id);
      setSelectedHistoryIdx(null);
      lastAutoSelectedInputRef.current = normalizedInput;
      return;
    }

    const matchingHistoryIdx = simcInputHistory.findIndex(
      (profile) => profile.trim() === normalizedInput
    );
    if (matchingHistoryIdx >= 0) {
      setSelectedSavedId(null);
      setSelectedHistoryIdx(matchingHistoryIdx);
      lastAutoSelectedInputRef.current = normalizedInput;
      return;
    }

    // Inputs restored or supplied by another page bypass handleSetSimcInput. Treat them
    // like editor input once, so the profile still appears as the selected recent export.
    if (profilesLoaded && lastAutoSelectedInputRef.current !== normalizedInput) {
      const newIdx = addToHistoryWithSelection(simcInput);
      setSelectedSavedId(null);
      setSelectedHistoryIdx(newIdx);
      lastAutoSelectedInputRef.current = normalizedInput;
    }
  }, [
    addToHistoryWithSelection,
    bnetProfiles,
    profilesLoaded,
    selectedHistoryIdx,
    selectedSavedId,
    simcInput,
    simcInputHistory,
  ]);

  const loadProfiles = useCallback(() => {
    listCharacterProfiles()
      .then((profiles) => {
        setBnetProfiles(profiles);
        setProfilesLoaded(true);
      })
      .catch(() => {
        setBnetProfiles([]);
        setProfilesLoaded(true);
      });
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    loadProfiles();
  }, [historyDropdownOpen, historyTab, loadProfiles]);

  const refreshProfiles = useCallback(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    loadProfiles();
  }, [historyDropdownOpen, historyTab, loadProfiles]);

  useEffect(() => {
    if (!historyDropdownOpen || historyTab !== 'saved') return;
    const interval = setInterval(refreshProfiles, 5000);
    return () => clearInterval(interval);
  }, [historyDropdownOpen, historyTab, refreshProfiles]);

  const handleSelectSavedProfile = useCallback(
    (profile: SavedCharacterProfile) => {
      setSelectedSavedId(profile.id);
      setSelectedHistoryIdx(null);
      setSimcInput(profile.simc_input);
      addToHistory(profile.simc_input);
      setHistoryDropdownOpen(false);
    },
    [addToHistory, setSimcInput]
  );

  const handleSelectHistoryProfile = useCallback(
    (idx: number) => {
      setSelectedSavedId(null);
      setSelectedHistoryIdx(idx);
      setSimcInput(simcInputHistory[idx]);
      setHistoryDropdownOpen(false);
    },
    [setSimcInput, simcInputHistory]
  );

  const handleDeleteHistoryProfile = useCallback(
    (idx: number) => {
      const next = simcInputHistory.filter((_, i) => i !== idx);
      setSimcInputHistory(next);
      if (selectedHistoryIdx === idx) {
        setSelectedHistoryIdx(null);
      } else if (selectedHistoryIdx !== null && selectedHistoryIdx > idx) {
        setSelectedHistoryIdx(selectedHistoryIdx - 1);
      }
    },
    [selectedHistoryIdx, simcInputHistory]
  );

  const handleClearHistory = useCallback(() => {
    setSimcInputHistory([]);
    setSelectedHistoryIdx(null);
    setHistoryDropdownOpen(false);
  }, []);

  const handleDeleteProfile = useCallback(async () => {
    if (!deleteProfileId) return;
    try {
      await deleteCharacterProfile(deleteProfileId);
      setBnetProfiles((prev) => prev.filter((profile) => profile.id !== deleteProfileId));
      if (selectedSavedId === deleteProfileId) {
        setSelectedSavedId(null);
      }
    } catch (err) {
      console.error('Failed to delete profile:', err);
    }
  }, [deleteProfileId, selectedSavedId]);

  const selectedProfileMeta: SelectedProfileMeta = useMemo(() => {
    if (selectedSavedId !== null) {
      const saved = bnetProfiles.find((profile) => profile.id === selectedSavedId);
      if (!saved) return null;
      const classLabel = [
        saved.spec ? specDisplayName(saved.spec) : null,
        titleCaseWords(saved.class),
      ]
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
        const classLabel = [specDisplayName(info.spec), titleCaseWords(info.className)]
          .filter(Boolean)
          .join(' ');
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

    const info = simcInput.length >= 50 ? parseCharacterInfo(simcInput) : null;
    if (info?.kind === 'character') {
      const classLabel = [specDisplayName(info.spec), titleCaseWords(info.className)]
        .filter(Boolean)
        .join(' ');
      const realmLabel = [info.server, info.region ? `(${info.region})` : null]
        .filter(Boolean)
        .join(' ');
      return {
        name: info.name,
        classLabel,
        classColor: resolveClassColor(info.className),
        combinedLabel:
          info.name && classLabel ? `${info.name} - ${classLabel}` : info.name || classLabel,
        realmLabel: realmLabel || null,
      };
    }

    return null;
  }, [bnetProfiles, selectedHistoryIdx, selectedSavedId, simcInput, simcInputHistory]);

  return {
    simcInputHistory,
    selectedHistoryIdx,
    selectedSavedId,
    historyDropdownOpen,
    setHistoryDropdownOpen,
    historyTab,
    setHistoryTab,
    bnetProfiles,
    deleteProfileId,
    setDeleteProfileId,
    deleteTargetProfile,
    historyDropdownRef,
    selectedProfileMeta,
    addToHistory,
    addToHistoryWithSelection,
    setSelectedHistoryIdx,
    handleSetSimcInput,
    handleSelectSavedProfile,
    handleSelectHistoryProfile,
    handleDeleteHistoryProfile,
    handleClearHistory,
    handleDeleteProfile,
  };
}
