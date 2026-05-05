import { useRef } from 'react';
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
  sectionSummaries: Record<string, { totalBytes: number; downloaded: number; total: number }>;
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
  sectionSummaries,
  refreshDataStates,
  downloadAllMissingFiles,
  openDataRootDirectory,
  downloadFile,
  showFileContent,
  dataFilePreviewLoading,
}: DataFileStateModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(modalRef, isOpen && !disableOutsideDismiss, onClose);

  if (!isOpen) return null;

  const formatBytes = (n: number) =>
    formatBytesDecimal(n, { empty: '0 B', includeBytes: true, kbDigits: 1, mbDigits: 1 });

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
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void refreshDataStates()}
              disabled={dataStateLoading || dataActionBusyKey !== null}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              Refresh List
            </button>
            <button
              onClick={() => void downloadAllMissingFiles()}
              disabled={dataStateLoading || dataActionBusyKey !== null}
              className="rounded-md border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-50"
            >
              {dataActionBusyKey === 'download-missing'
                ? 'Downloading Missing...'
                : 'Download All Missing'}
            </button>
            <button
              onClick={() => void openDataRootDirectory()}
              disabled={!isDesktop || !dataFileStates?.base_path}
              className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              Open Data Dir
            </button>
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
              {Object.entries(groupedDataFiles || {}).map(([section, files]) => (
                <div key={section} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-400">
                      {section}
                    </h4>
                    <div className="h-px flex-1 bg-border/70" />
                    <span className="text-[11px] text-zinc-500">
                      {sectionSummaries[section]?.downloaded ?? 0}/{files.length} files ·{' '}
                      {formatBytes(sectionSummaries[section]?.totalBytes ?? 0)}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
