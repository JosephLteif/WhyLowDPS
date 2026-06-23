import type { SettingsStatusMessage } from '../types';
import { formatBytesDecimal } from '../../lib/format';
import type { AppReleaseInfo } from '../../lib/updater-release';
import type { SimcRuntimeInfo } from '../../lib/simc-runtime-release';

type UpdatesSettingsSectionProps = {
  selectedSimcChannel: 'weekly' | 'nightly';
  setSelectedSimcChannel: (channel: 'weekly' | 'nightly') => void;
  simcRuntimeInfo: SimcRuntimeInfo | null;
  simcRuntimeInfoLoading: boolean;
  simcRuntimeDownloading: boolean;
  refreshSimcRuntimeInfo: () => void;
  downloadSelectedSimcRuntime: () => void;
  simcChannelMessage: SettingsStatusMessage | null;
  isDesktopRuntime: boolean;
  updateCheckState: 'idle' | 'checking' | 'installing';
  appReleases: AppReleaseInfo[];
  appReleaseMetadataStatus: 'available' | 'rate_limited' | 'unavailable';
  selectedAppVersion: string;
  setSelectedAppVersion: (version: string) => void;
  loadAppReleases: (options?: { forceRefresh?: boolean }) => void;
  downloadAndInstallLatest: () => void;
  updateMessage: SettingsStatusMessage | null;
};

export default function UpdatesSettingsSection({
  selectedSimcChannel,
  setSelectedSimcChannel,
  simcRuntimeInfo,
  simcRuntimeInfoLoading,
  simcRuntimeDownloading,
  refreshSimcRuntimeInfo,
  downloadSelectedSimcRuntime,
  simcChannelMessage,
  isDesktopRuntime,
  updateCheckState,
  appReleases,
  appReleaseMetadataStatus,
  selectedAppVersion,
  setSelectedAppVersion,
  loadAppReleases,
  downloadAndInstallLatest,
  updateMessage,
}: UpdatesSettingsSectionProps) {
  const selectedAppRelease =
    appReleases.find((release) => release.version === selectedAppVersion) || appReleases[0] || null;
  const appMetadataRateLimited = appReleaseMetadataStatus === 'rate_limited';
  const simcMetadataRateLimited = simcRuntimeInfo?.metadataStatus === 'rate_limited';

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <h2 className="mb-3 text-xl font-semibold text-white">App Updates</h2>
      <div className="max-w-5xl space-y-3">
        <div
          data-update-card
          className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]"
        >
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-300">Stable Version</span>
              <select
                value={selectedAppVersion}
                onChange={(e) => setSelectedAppVersion(e.target.value)}
                className="min-w-[180px] rounded border border-border bg-surface px-3 py-2 text-sm text-zinc-100"
              >
                {appReleases.length === 0 ? (
                  <option value="">No releases loaded</option>
                ) : (
                  appReleases.map((release) => (
                    <option key={release.version} value={release.version}>
                      {release.version}
                    </option>
                  ))
                )}
              </select>
              <button
                onClick={() => loadAppReleases({ forceRefresh: true })}
                disabled={updateCheckState !== 'idle'}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                onClick={downloadAndInstallLatest}
                disabled={updateCheckState !== 'idle' || !selectedAppRelease?.downloadUrl}
                className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {updateCheckState === 'installing' ? 'Starting...' : 'Download & Install'}
              </button>
            </div>
            {selectedAppRelease && (
              <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                <span>Version: {selectedAppRelease.version}</span>
                <span>Size: {formatBytesDecimal(selectedAppRelease.assetSizeBytes)}</span>
                <span className="truncate" title={selectedAppRelease.assetName || undefined}>
                  Asset: {selectedAppRelease.assetName || 'Windows installer'}
                </span>
              </div>
            )}
            {appMetadataRateLimited && (
              <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                GitHub rate limited this request, so app versions and installer sizes cannot be
                shown. Check back later.
              </p>
            )}
          </div>

          {updateMessage && <StatusMessage message={updateMessage} className="lg:self-center" />}
        </div>

        {isDesktopRuntime && (
          <div
            data-update-card
            className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]"
          >
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-300">SimC Channel</span>
                <select
                  value={selectedSimcChannel}
                  onChange={(e) => setSelectedSimcChannel(e.target.value as 'weekly' | 'nightly')}
                  className="min-w-[180px] rounded border border-border bg-surface px-3 py-2 text-sm text-zinc-100"
                >
                  <option value="weekly">Weekly</option>
                  <option value="nightly">Nightly</option>
                </select>
                <button
                  onClick={refreshSimcRuntimeInfo}
                  disabled={simcRuntimeInfoLoading}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  {simcRuntimeInfoLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <button
                  onClick={downloadSelectedSimcRuntime}
                  disabled={simcRuntimeDownloading}
                  className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
                >
                  {simcRuntimeDownloading ? 'Downloading...' : 'Download'}
                </button>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
                <span>
                  Version:{' '}
                  {simcRuntimeInfoLoading
                    ? 'Loading...'
                    : simcMetadataRateLimited
                      ? 'Rate limited'
                      : simcRuntimeInfo?.version || 'Unavailable'}
                </span>
                <span>
                  Size:{' '}
                  {simcMetadataRateLimited
                    ? 'Rate limited'
                    : formatBytesDecimal(simcRuntimeInfo?.assetSizeBytes)}
                </span>
                <span className="truncate" title={simcRuntimeInfo?.assetName || undefined}>
                  Asset: {simcRuntimeInfo?.assetName || 'Current platform archive'}
                </span>
              </div>
              {simcMetadataRateLimited && (
                <p className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  GitHub rate limited this request, so the SimC version and size cannot be shown.
                  Check back later.
                </p>
              )}
            </div>

            {simcChannelMessage && (
              <StatusMessage message={simcChannelMessage} className="lg:self-center" />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StatusMessage({
  message,
  className = '',
}: {
  message: SettingsStatusMessage;
  className?: string;
}) {
  return (
    <div
      className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
        message.type === 'success'
          ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
          : 'border border-red-500/20 bg-red-500/10 text-red-400'
      } ${className}`}
    >
      {message.text}
    </div>
  );
}
