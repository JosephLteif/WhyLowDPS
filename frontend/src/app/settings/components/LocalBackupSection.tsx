'use client';

import { useState } from 'react';
import { ArchiveRestore, Download, RotateCcw } from 'lucide-react';

const isSensitivePreferenceKey = (key: string) => {
  const normalized = key.toLowerCase();
  return (
    normalized.startsWith('api_cache_') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('credential')
  );
};

function collectPreferences(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || isSensitivePreferenceKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

type RestoreResult = {
  recovery_path?: string | null;
  frontend_preferences?: { local_storage?: Record<string, string> };
};

export default function LocalBackupSection() {
  const [path, setPath] = useState('');
  const [lastBackupPath, setLastBackupPath] = useState('');
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const exportBackup = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const output = await invoke<string>('export_local_backup', {
        frontendPreferences: { localStorage: collectPreferences() },
        path: path.trim() || null,
      });
      setLastBackupPath(output);
      setPath(output);
      setMessage({ type: 'success', text: 'Backup exported. It includes simulation data and safe local preferences, but no credentials or cache.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Backup export failed.' });
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    if (!path.trim()) {
      setMessage({ type: 'error', text: 'Enter the full path to a .zip backup first.' });
      return;
    }
    if (!window.confirm('Restore this backup and restart WhyLowDps? A recovery copy of the current database will be preserved.')) return;
    setBusy('import');
    setMessage(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<RestoreResult>('import_local_backup', { path: path.trim() });
      const restored = result.frontend_preferences?.local_storage || {};
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key && !isSensitivePreferenceKey(key)) localStorage.removeItem(key);
      }
      Object.entries(restored).forEach(([key, value]) => {
        if (!isSensitivePreferenceKey(key)) localStorage.setItem(key, value);
      });
      setMessage({
        type: 'success',
        text: result.recovery_path
          ? `Backup validated. Recovery copy: ${result.recovery_path}. Restarting...`
          : 'Backup validated. Restarting...',
      });
      await invoke('restart_app');
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Backup restore failed. No data was changed.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <ArchiveRestore className="mt-0.5 h-5 w-5 text-gold" />
        <div>
          <h2 className="text-xl font-semibold text-white">Local backup and restore</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Export SQLite history, saved profiles, routes, desktop preferences, and safe UI preferences to a versioned ZIP archive.
          </p>
          <p className="mt-1 text-xs text-zinc-500">Credentials, tokens, cache files, and SimC binaries are never included.</p>
        </div>
      </div>
      <div className="mt-5 max-w-3xl space-y-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="backup-path">
          Backup path
        </label>
        <input
          id="backup-path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="Leave blank to create one in the app backups folder"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-gold/50 focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportBackup()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-gold/15 px-3 py-2 text-sm font-semibold text-gold hover:bg-gold/25 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {busy === 'export' ? 'Exporting...' : 'Export backup'}
          </button>
          <button
            type="button"
            onClick={() => void importBackup()}
            disabled={busy !== null || !path.trim()}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-surface-2 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {busy === 'import' ? 'Validating...' : 'Restore backup'}
          </button>
        </div>
        {lastBackupPath && <p className="break-all text-xs text-zinc-500">Created: {lastBackupPath}</p>}
        {message && (
          <p className={`text-xs ${message.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`} role="status">
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
