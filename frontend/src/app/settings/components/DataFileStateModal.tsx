import { useMemo, useRef, useState } from 'react';
import { formatBytesDecimal } from '../../lib/format';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';
import type { DataFileState, DataFileStatesResponse, SettingsStatusMessage } from '../types';

type DataFileStateModalProps = {
  isOpen: boolean;
  onClose: () => void;
  disableOutsideDismiss?: boolean;
  isDesktop: boolean;
  dataFileStates: DataFileStatesResponse | null;
  dataStateLoading: boolean;
  dataStateError: string;
  dataStateMessage: SettingsStatusMessage | null;
  dataActionBusyKey: string | null;
  groupedDataFiles?: Record<string, DataFileState[]>;
  refreshDataStates: () => Promise<void>;
  downloadAllMissingFiles: () => Promise<void>;
  openDataRootDirectory: () => Promise<void>;
  downloadFile: (key: string) => Promise<void>;
  showFileContent: (key: string) => Promise<void>;
  dataFilePreviewLoading: boolean;
};

export default function DataFileStateModal({
  isOpen,
  onClose,
  disableOutsideDismiss = false,
  isDesktop,
  dataFileStates,
  dataStateLoading,
  dataStateError,
  dataStateMessage,
  dataActionBusyKey,
  groupedDataFiles,
  refreshDataStates,
  downloadAllMissingFiles,
  openDataRootDirectory,
  downloadFile,
  showFileContent,
  dataFilePreviewLoading,
}: DataFileStateModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'missing' | 'available'>(
    'all'
  );
  const [requirementFilter, setRequirementFilter] = useState<'all' | 'required' | 'optional'>(
    'all'
  );
  useDismissOnOutside(modalRef, isOpen && !disableOutsideDismiss, onClose);

  const formatBytes = (n: number) =>
    formatBytesDecimal(n, { empty: '0 B', includeBytes: true, kbDigits: 1, mbDigits: 1 });
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredGroupedDataFiles = useMemo(() => {
    const source = groupedDataFiles || {};
    const out: Record<string, DataFileState[]> = {};
    for (const [section, files] of Object.entries(source)) {
      const filtered = files.filter((file) => {
        const matchesAvailability =
          availabilityFilter === 'all' ||
          (availabilityFilter === 'missing' ? !file.exists : file.exists);
        const matchesRequirement =
          requirementFilter === 'all' ||
          (requirementFilter === 'required' ? file.required : !file.required);
        const hay = `${section} ${file.label} ${file.key} ${file.relative_path}`.toLowerCase();
        return matchesAvailability && matchesRequirement && hay.includes(normalizedQuery);
      });
      if (filtered.length > 0) out[section] = filtered;
    }
    return out;
  }, [availabilityFilter, groupedDataFiles, normalizedQuery, requirementFilter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4">
      <div
        ref={modalRef}
        className="max-h-[80vh] w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-[#121212] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Game Data File States</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {dataFileStates?.base_path || 'Runtime data directory'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(80vh-72px)] overflow-y-auto p-5">
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void downloadAllMissingFiles()}
                disabled={dataStateLoading || dataActionBusyKey !== null}
                className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-50"
              >
                {dataActionBusyKey === 'download-missing'
                  ? 'Downloading Missing...'
                  : 'Download All Missing'}
              </button>
              <div className="inline-flex gap-2 border-l border-border/70 pl-2">
                <button
                  onClick={() => void refreshDataStates()}
                  disabled={dataStateLoading || dataActionBusyKey !== null}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  Refresh List
                </button>
                <button
                  onClick={() => void openDataRootDirectory()}
                  disabled={!isDesktop || !dataFileStates?.base_path}
                  className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  Open Data Dir
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Availability"
                className="flex items-center gap-1 rounded-md border border-border/70 bg-black/20 p-1"
              >
                {(['all', 'missing', 'available'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={availabilityFilter === filter}
                    onClick={() => setAvailabilityFilter(filter)}
                    className={`rounded px-2 py-1 text-[11px] font-semibold ${
                      availabilityFilter === filter
                        ? 'bg-gold/15 text-gold'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    {filter === 'all' ? 'All' : filter === 'missing' ? 'Missing' : 'Available'}
                  </button>
                ))}
              </div>
              <div
                role="group"
                aria-label="Requirement"
                className="flex items-center gap-1 rounded-md border border-border/70 bg-black/20 p-1"
              >
                {(['all', 'required', 'optional'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={requirementFilter === filter}
                    onClick={() => setRequirementFilter(filter)}
                    className={`rounded px-2 py-1 text-[11px] font-semibold ${
                      requirementFilter === filter
                        ? 'bg-gold/15 text-gold'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    {filter === 'all' ? 'All' : filter === 'required' ? 'Required' : 'Optional'}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="min-w-[220px] flex-1 rounded-md border border-zinc-700 bg-black/40 px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500"
              />
            </div>
          </div>

          {dataStateLoading && <p className="text-sm text-zinc-400">Loading data state...</p>}

          {!dataStateLoading && dataStateMessage && (
            <div
              className={`mb-3 rounded-lg border p-3 text-sm ${
                dataStateMessage.type === 'success'
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                  : 'border-red-500/20 bg-red-500/10 text-red-300'
              }`}
            >
              {dataStateMessage.text}
            </div>
          )}

          {!dataStateLoading && dataStateError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {dataStateError}
            </div>
          )}

          {!dataStateLoading && !dataStateError && dataFileStates && (
            <div className="space-y-4">
              {Object.entries(filteredGroupedDataFiles).map(([section, files]) => (
                <div key={section} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      {section}
                    </h4>
                    <div className="h-px flex-1 bg-border/70" />
                    <span className="text-[11px] text-zinc-500">
                      {files.filter((file) => file.exists).length}/{files.length} files ·{' '}
                      {formatBytes(
                        files.reduce(
                          (totalBytes, file) => totalBytes + (file.exists ? file.size_bytes : 0),
                          0
                        )
                      )}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {files.map((file) => (
                      <div
                        key={file.key}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-200">{file.label}</p>
                          <p className="truncate font-mono text-[11px] text-zinc-500">
                            {file.relative_path}
                          </p>
                          <p className="truncate font-mono text-[11px] text-zinc-600">
                            {file.resolved_path}
                          </p>
                          <p
                            className={`mt-1 w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              file.required
                                ? 'bg-amber-500/10 text-amber-300'
                                : 'bg-zinc-700/40 text-zinc-400'
                            }`}
                          >
                            {file.required ? 'Required' : 'Optional'}
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                            file.exists
                              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : file.required
                                ? 'border border-red-500/30 bg-red-500/10 text-red-300'
                                : 'border border-zinc-600/40 bg-zinc-700/20 text-zinc-400'
                          }`}
                        >
                          {file.exists ? 'Available' : file.required ? 'Missing' : 'Not downloaded'}
                        </span>
                        <span className="font-mono text-xs text-zinc-400">
                          {file.exists ? formatBytes(file.size_bytes) : '--'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void downloadFile(file.key)}
                            disabled={
                              !file.downloadable || dataStateLoading || dataActionBusyKey !== null
                            }
                            className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 text-[11px] font-semibold text-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {dataActionBusyKey === file.key
                              ? 'Working...'
                              : file.exists
                                ? 'Refresh'
                                : 'Download'}
                          </button>
                          <button
                            onClick={() => void showFileContent(file.key)}
                            disabled={!file.exists || dataFilePreviewLoading}
                            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Show Content
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(filteredGroupedDataFiles).length === 0 && (
                <div className="rounded-lg border border-border/70 bg-surface/40 p-3 text-sm text-zinc-400">
                  No files match the active filters or search.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
