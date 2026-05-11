'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import TalentTree from '../components/TalentTree';
import { API_URL, fetchJsonCached } from '../lib/api';
import { decodeHeader } from '../lib/talentDecode';
import { encodeTalentString } from '../lib/talentEncode';
import {
  CLASS_SPECS,
  SPEC_ID_TO_NAME,
  SPEC_NAME_TO_ID,
  parseTalentLoadouts,
  specDisplayName,
} from '../lib/types';
import type { TalentLoadoutParsed } from '../lib/types';
import { useTalentTree } from '../lib/useTalentTree';
import { listCharacterProfiles } from '../lib/api';

type SavedBuild = {
  id: string;
  name: string;
  talentString: string;
  createdAt: number;
};

type CharacterOption = {
  key: string;
  label: string;
  classKey: string;
};

type BuildsByScope = Record<string, SavedBuild[]>;
type StarterBuild = { label: string; talentString: string };

const STORAGE_KEY = 'whylowdps_talent_playground_builds_by_scope_v1';

function extractTalentString(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const wowheadMatch = value.match(/[?&]loadout=([A-Za-z0-9+/]+)/);
  if (wowheadMatch) return wowheadMatch[1];
  const calcMatch = value.match(/talent-calc\/[^/]+\/[^/]+\/([A-Za-z0-9+/]+)/);
  if (calcMatch) return calcMatch[1];
  return value;
}

function normalizeClassKey(value: string): string {
  const normalized = (value || '').toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'deathknight') return 'death_knight';
  if (normalized === 'demonhunter') return 'demon_hunter';
  return normalized;
}

function prettyLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isValidTalentString(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]+$/.test(trimmed)) return false;
  try {
    const decoded = decodeHeader(trimmed);
    return !!decoded?.specId;
  } catch {
    return false;
  }
}

function findTalentStringDeep(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const seen = new Set<unknown>();
  const stack: unknown[] = [input];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === 'string') {
      if (isValidTalentString(current)) return current.trim();
      continue;
    }
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    const obj = current as Record<string, unknown>;
    for (const value of Object.values(obj)) {
      if (typeof value === 'string') {
        if (isValidTalentString(value)) return value.trim();
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return null;
}

function safeParseBuildsByScope(raw: string | null): BuildsByScope {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: BuildsByScope = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      out[key] = value.filter(
        (v) =>
          v &&
          typeof v.id === 'string' &&
          typeof v.name === 'string' &&
          typeof v.talentString === 'string' &&
          typeof v.createdAt === 'number'
      ) as SavedBuild[];
    }
    return out;
  } catch {
    return {};
  }
}

export default function TalentPlaygroundPage() {
  const searchParams = useSearchParams();
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [selectedCharacterKey, setSelectedCharacterKey] = useState('');
  const [selectedClassKey, setSelectedClassKey] = useState('warrior');
  const [buildsByScope, setBuildsByScope] = useState<BuildsByScope>({});
  const [activeBuildId, setActiveBuildId] = useState('');
  const [editorTalentString, setEditorTalentString] = useState('');
  const [importText, setImportText] = useState('');
  const [newName, setNewName] = useState('');
  const [blankSpecName, setBlankSpecName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
  const [hasAppliedQueryBuild, setHasAppliedQueryBuild] = useState(false);
  const [starterBuilds, setStarterBuilds] = useState<StarterBuild[]>([]);
  const [selectedStarterTalent, setSelectedStarterTalent] = useState('');

  const blankSpecId = useMemo(() => SPEC_NAME_TO_ID[blankSpecName] || null, [blankSpecName]);
  const blankTree = useTalentTree(blankSpecId);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    setBuildsByScope(safeParseBuildsByScope(raw));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildsByScope));
  }, [buildsByScope]);

  useEffect(() => {
    fetchJsonCached<{ characters?: any[] }>(`${API_URL}/api/bnet/user/characters`, { ttl: 600000 })
      .then((data) => {
        const source = Array.isArray(data?.characters) ? data.characters : [];
        const mapped = source
          .map((char) => {
            const region = String(char.region || 'us').toLowerCase();
            const realm = String(char.realm || '').toLowerCase();
            const name = String(char.name || '').toLowerCase();
            const classKey = normalizeClassKey(String(char.class || ''));
            const key = `${region}|${realm}|${name}`;
            const label = `${char.name} - ${char.realm} (${region.toUpperCase()})`;
            return { key, label, classKey };
          })
          .filter((char) => char.key && char.classKey);
        setCharacters(mapped);
      })
      .catch(() => {
        setCharacters([]);
      });
  }, []);

  useEffect(() => {
    const queryChar = searchParams.get('char');
    if (queryChar) {
      setSelectedCharacterKey(queryChar);
      return;
    }
  }, [searchParams]);

  const classOptions = useMemo(() => {
    const keys = Object.keys(CLASS_SPECS).filter((key) => !['deathknight', 'demonhunter'].includes(key));
    return keys.sort((a, b) => prettyLabel(a).localeCompare(prettyLabel(b)));
  }, []);

  useEffect(() => {
    const selectedCharacter = characters.find((char) => char.key === selectedCharacterKey) || null;
    if (selectedCharacter?.classKey) {
      setSelectedClassKey(selectedCharacter.classKey);
      return;
    }
    if (!classOptions.includes(selectedClassKey)) {
      setSelectedClassKey(classOptions[0] || 'warrior');
    }
  }, [characters, classOptions, selectedCharacterKey, selectedClassKey]);

  useEffect(() => {
    setStarterBuilds([]);
    setSelectedStarterTalent('');
    const selectedCharacter = characters.find((char) => char.key === selectedCharacterKey);
    if (!selectedCharacter) return;
    const [region, realm, name] = selectedCharacter.key.split('|');
    if (!region || !realm || !name) return;

    let cancelled = false;
    (async () => {
      try {
        const profiles = await listCharacterProfiles({ region, realm, name });
        const latestSimc = profiles[0]?.simc_input || '';
        if (latestSimc) {
          const loadouts = parseTalentLoadouts(latestSimc);
          const seen = new Set<string>();
          const parsed: StarterBuild[] = [];
          for (const loadout of loadouts) {
            const talentString = String(loadout.talentString || '').trim();
            if (!isValidTalentString(talentString) || seen.has(talentString)) continue;
            seen.add(talentString);
            parsed.push({ label: loadout.name || `Loadout ${parsed.length + 1}`, talentString });
          }
          if (parsed.length > 0) {
            if (!cancelled) {
              setStarterBuilds(parsed);
              setSelectedStarterTalent(parsed.find((s) => /active/i.test(s.label))?.talentString || parsed[0].talentString);
            }
            return;
          }
        }

        const specs = await fetchJsonCached<any>(
          `${API_URL}/api/blizzard/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/specializations?region=${encodeURIComponent(region)}`,
          { ttl: 120000 }
        );
        const activeId = specs?.active_specialization?.id;
        const specializations = Array.isArray(specs?.specializations) ? specs.specializations : [];
        const activeSpec =
          specializations.find((spec: any) => spec?.specialization?.id === activeId) ||
          specializations.find((spec: any) => (spec?.loadouts || []).some((l: any) => l?.is_active)) ||
          specializations[0] ||
          null;
        const loadouts = Array.isArray(activeSpec?.loadouts) ? activeSpec.loadouts : [];
        const activeLoadout = loadouts.find((l: any) => l?.is_active) || loadouts[0] || null;
        const directCandidates = [
          activeLoadout?.talent_loadout_code,
          activeLoadout?.talentLoadoutCode,
          activeLoadout?.loadout_code,
          activeLoadout?.code,
          activeSpec?.talent_loadout_code,
          activeSpec?.talentLoadoutCode,
        ]
          .map((v: unknown) => String(v || '').trim())
          .filter((v: string) => isValidTalentString(v));
        const equipped =
          directCandidates[0] || findTalentStringDeep(activeLoadout) || findTalentStringDeep(activeSpec);
        if (!cancelled && equipped) {
          setStarterBuilds([{ label: 'Currently Equipped', talentString: equipped }]);
          setSelectedStarterTalent(equipped);
        }
      } catch {
        if (!cancelled) {
          setStarterBuilds([]);
          setSelectedStarterTalent('');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [characters, selectedCharacterKey]);

  const scopeKey = useMemo(() => {
    if (selectedCharacterKey) return `character:${selectedCharacterKey}`;
    return `class:${selectedClassKey}`;
  }, [selectedCharacterKey, selectedClassKey]);

  const savedBuilds = useMemo(() => buildsByScope[scopeKey] || [], [buildsByScope, scopeKey]);
  const activeBuild = useMemo(
    () => savedBuilds.find((build) => build.id === activeBuildId) || null,
    [activeBuildId, savedBuilds]
  );
  const lastLoadedBuildIdRef = useRef<string>('');

  useEffect(() => {
    const firstId = savedBuilds[0]?.id || '';
    if (!savedBuilds.some((build) => build.id === activeBuildId)) {
      setActiveBuildId(firstId);
    }
  }, [activeBuildId, savedBuilds]);

  useEffect(() => {
    if (!activeBuild) {
      if (editorTalentString !== '') setEditorTalentString('');
      lastLoadedBuildIdRef.current = '';
      return;
    }
    if (lastLoadedBuildIdRef.current !== activeBuild.id) {
      if (editorTalentString !== activeBuild.talentString) {
        setEditorTalentString(activeBuild.talentString);
      }
      lastLoadedBuildIdRef.current = activeBuild.id;
    }
  }, [activeBuild?.id, activeBuild?.talentString, editorTalentString]);

  const activeSpec = useMemo(() => {
    if (!editorTalentString) return null;
    try {
      const specId = decodeHeader(editorTalentString).specId;
      const specName = SPEC_ID_TO_NAME[specId];
      return specName ? specDisplayName(specName) : `Spec ${specId}`;
    } catch {
      return null;
    }
  }, [editorTalentString]);

  const updateScopeBuilds = useCallback((updater: (prev: SavedBuild[]) => SavedBuild[]) => {
    setBuildsByScope((prev) => ({ ...prev, [scopeKey]: updater(prev[scopeKey] || []) }));
  }, [scopeKey]);

  const addBuild = useCallback(
    (name: string, talentString: string) => {
      const build: SavedBuild = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim() || `Build ${(savedBuilds.length || 0) + 1}`,
        talentString,
        createdAt: Date.now(),
      };
      updateScopeBuilds((prev) => [build, ...prev]);
      setActiveBuildId(build.id);
      setEditorTalentString(build.talentString);
    },
    [savedBuilds.length, updateScopeBuilds]
  );

  useEffect(() => {
    if (!activeBuild || !editorTalentString) return;
    if (activeBuild.talentString === editorTalentString) return;
    updateScopeBuilds((prev) =>
      prev.map((build) =>
        build.id === activeBuild.id ? { ...build, talentString: editorTalentString } : build
      )
    );
  }, [activeBuild, editorTalentString, updateScopeBuilds]);

  useEffect(() => {
    if (hasAppliedQueryBuild) return;
    const talentParam = searchParams.get('talent');
    if (!talentParam) {
      setHasAppliedQueryBuild(true);
      return;
    }
    const extracted = extractTalentString(talentParam);
    if (!extracted) {
      setHasAppliedQueryBuild(true);
      return;
    }
    try {
      decodeHeader(extracted);
      const nameParam = searchParams.get('name') || 'Linked Build';
      addBuild(nameParam, extracted);
    } catch {
      // ignore invalid deep-link value
    } finally {
      setHasAppliedQueryBuild(true);
    }
  }, [addBuild, hasAppliedQueryBuild, searchParams]);

  const onImport = useCallback(() => {
    setError('');
    const talentString = extractTalentString(importText);
    if (!talentString) return;
    try {
      decodeHeader(talentString);
    } catch {
      setError('Invalid talent string. Paste a valid export string or Wowhead URL.');
      return;
    }
    addBuild(newName || `Import ${savedBuilds.length + 1}`, talentString);
    setImportText('');
    setNewName('');
  }, [addBuild, importText, newName, savedBuilds.length]);

  const onCreateBlank = useCallback(() => {
    setError('');
    if (!blankSpecId || !blankTree) {
      setError('Talent tree data is still loading for this spec.');
      return;
    }
    const blank = encodeTalentString(new Map(), blankTree, blankSpecId);
    addBuild(newName || `${specDisplayName(blankSpecName)} Blank`, blank);
  }, [addBuild, blankSpecId, blankSpecName, blankTree, newName]);

  const onUseStarter = useCallback(() => {
    if (!selectedStarterTalent) return;
    const selectedStarter = starterBuilds.find((s) => s.talentString === selectedStarterTalent);
    addBuild(newName || selectedStarter?.label || `Starter ${savedBuilds.length + 1}`, selectedStarterTalent);
  }, [addBuild, newName, savedBuilds.length, selectedStarterTalent, starterBuilds]);

  const onDelete = useCallback(
    (id: string) => {
      updateScopeBuilds((prev) => prev.filter((build) => build.id !== id));
      if (activeBuildId === id) setActiveBuildId('');
    },
    [activeBuildId, updateScopeBuilds]
  );

  const onExport = useCallback(async () => {
    if (!editorTalentString) return;
    try {
      await navigator.clipboard.writeText(editorTalentString);
      setNotice('Talent string copied to clipboard.');
      setTimeout(() => setNotice(''), 1800);
    } catch {
      setError('Could not copy to clipboard.');
    }
  }, [editorTalentString]);

  const simcLoadouts = useMemo(() => {
    if (!importText.trim()) return [] as TalentLoadoutParsed[];
    return parseTalentLoadouts(importText);
  }, [importText]);

  const selectedCharacter = useMemo(
    () => characters.find((char) => char.key === selectedCharacterKey) || null,
    [characters, selectedCharacterKey]
  );

  const specChoices = useMemo(() => {
    const specs = CLASS_SPECS[selectedClassKey] || [];
    return specs.map((spec) => ({ key: spec, label: specDisplayName(spec) }));
  }, [selectedClassKey]);

  useEffect(() => {
    if (!specChoices.some((spec) => spec.key === blankSpecName)) {
      setBlankSpecName(specChoices[0]?.key || '');
    }
  }, [blankSpecName, specChoices]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Talent Playground</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Build talents per character, import new trees, and export final strings.
            </p>
          </div>
          <Link
            href="/characters"
            className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/[0.1]"
          >
            Back to My Characters
          </Link>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Target Character</h2>
        <div className={`mt-3 grid gap-2 ${selectedCharacterKey ? 'lg:grid-cols-1' : 'lg:grid-cols-2'}`}>
          <select
            value={selectedCharacterKey}
            onChange={(e) => setSelectedCharacterKey(e.target.value)}
            className="input-field"
            style={{ colorScheme: 'dark' }}
          >
            <option value="">No Character (class-only)</option>
            {characters.map((char) => (
              <option key={char.key} value={char.key}>
                {char.label}
              </option>
            ))}
          </select>
          {!selectedCharacterKey && (
            <select
              value={selectedClassKey}
              onChange={(e) => setSelectedClassKey(e.target.value)}
              className="input-field"
              style={{ colorScheme: 'dark' }}
            >
              {classOptions.map((classKey) => (
                <option key={classKey} value={classKey}>
                  {prettyLabel(classKey)}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {selectedCharacter
            ? `Builds are saved directly under ${selectedCharacter.label}.`
            : 'No character selected: builds are saved by class.'}
        </p>
      </div>

      <div className="card p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Import or Start Blank</h2>
        {selectedCharacterKey && (
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
            <select
              value={selectedStarterTalent}
              onChange={(e) => setSelectedStarterTalent(e.target.value)}
              className="input-field"
              style={{ colorScheme: 'dark' }}
            >
              {starterBuilds.length > 0 ? (
                starterBuilds.map((starter) => (
                  <option key={`${starter.label}-${starter.talentString}`} value={starter.talentString}>
                    {starter.label}
                  </option>
                ))
              ) : (
                <option value="">No saved/equipped talents found</option>
              )}
            </select>
            <button
              type="button"
              onClick={onUseStarter}
              disabled={!selectedStarterTalent}
              className="rounded-md border border-gold/45 bg-gold/[0.12] px-3 py-2 text-sm font-semibold text-gold hover:bg-gold/[0.2] disabled:opacity-50"
            >
              Use Starter
            </button>
          </div>
        )}
        <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_220px_auto]">
          <input
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste talent string, Wowhead URL, or SimC talent blocks"
            className="input-field"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Build name (optional)"
            className="input-field"
          />
          <button
            type="button"
            onClick={onImport}
            className="rounded-md border border-gold/45 bg-gold/[0.12] px-3 py-2 text-sm font-semibold text-gold hover:bg-gold/[0.2]"
          >
            Import
          </button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[220px_220px_auto]">
          {!selectedCharacterKey && (
            <select
              value={selectedClassKey}
              onChange={(e) => setSelectedClassKey(e.target.value)}
              className="input-field"
              style={{ colorScheme: 'dark' }}
            >
              {classOptions.map((classKey) => (
                <option key={classKey} value={classKey}>
                  {prettyLabel(classKey)}
                </option>
              ))}
            </select>
          )}
          <select
            value={blankSpecName}
            onChange={(e) => setBlankSpecName(e.target.value)}
            className="input-field"
            style={{ colorScheme: 'dark' }}
          >
            {specChoices.map((spec) => (
              <option key={spec.key} value={spec.key}>
                {spec.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onCreateBlank}
            className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-white/[0.1]"
          >
            Start Blank
          </button>
        </div>
        {simcLoadouts.length > 0 && (
          <div className="mt-2 text-xs text-zinc-400">
            Detected {simcLoadouts.length} loadout{simcLoadouts.length > 1 ? 's' : ''} in SimC input.
          </div>
        )}
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="card p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-500">Saved Builds</div>
          {savedBuilds.length === 0 ? (
            <div className="text-sm text-zinc-500">No builds saved for this scope yet.</div>
          ) : (
            <div className="space-y-2">
              {savedBuilds.map((build) => {
                const active = build.id === activeBuildId;
                return (
                  <div
                    key={build.id}
                    className={`rounded-md border px-3 py-2 ${active ? 'border-gold/50 bg-gold/10' : 'border-white/10 bg-black/20'}`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveBuildId(build.id)}
                      className="w-full text-left"
                    >
                      <div className="truncate text-sm font-semibold text-zinc-100">{build.name}</div>
                      <div className="text-xs text-zinc-500">
                        {new Date(build.createdAt).toLocaleString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(build.id)}
                      className="mt-2 text-xs text-red-300 hover:text-red-200"
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="border-b border-white/5 bg-white/[0.01] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                {activeBuild ? (
                  <>
                    Editing: <span className="text-gold">{activeBuild.name}</span>
                    {activeSpec ? <span className="ml-2 text-zinc-400">({activeSpec})</span> : null}
                  </>
                ) : (
                  'Talent Editor'
                )}
              </h3>
              {activeBuild && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditorFullscreen(true)}
                    className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-white/[0.1]"
                  >
                    Fullscreen
                  </button>
                  <button
                    type="button"
                    onClick={onExport}
                    className="rounded-md border border-gold/45 bg-gold/[0.12] px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/[0.2]"
                  >
                    Export
                  </button>
                </div>
              )}
            </div>
            {notice && <div className="mt-2 text-xs text-emerald-300">{notice}</div>}
          </div>
          <div className="bg-black/20 p-3">
            {activeBuild ? (
              <TalentTree
                talentString={editorTalentString}
                editable
                bare
                onTalentStringChange={setEditorTalentString}
              />
            ) : (
              <div className="p-6 text-sm text-zinc-500">
                Import a build or start a blank one to begin editing.
              </div>
            )}
          </div>
        </div>
      </div>
      {isEditorFullscreen && activeBuild && (
        <div className="fixed inset-0 z-[120] bg-black/90 p-4">
          <div className="flex h-full flex-col rounded-xl border border-white/10 bg-[#0d0f15]">
            <div className="flex items-center justify-between border-b border-white/10 p-3">
              <div className="text-sm font-semibold text-zinc-100">
                {activeBuild.name}
                {activeSpec ? <span className="ml-2 text-zinc-400">({activeSpec})</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onExport}
                  className="rounded-md border border-gold/45 bg-gold/[0.12] px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/[0.2]"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditorFullscreen(false)}
                  className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-white/[0.1]"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <TalentTree
                talentString={editorTalentString}
                editable
                bare
                onTalentStringChange={setEditorTalentString}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
