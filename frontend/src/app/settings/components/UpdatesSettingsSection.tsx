import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SettingsStatusMessage } from '../types';
import { formatBytesDecimal } from '../../lib/format';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';
import type { AppReleaseInfo } from '../../lib/updater-release';
import type { SimcRuntimeInfo, SimcRuntimeVersionOption } from '../../lib/simc-runtime-release';

type UpdatesSettingsSectionProps = {
  selectedSimcChannel: 'weekly' | 'nightly';
  setSelectedSimcChannel: (channel: 'weekly' | 'nightly') => void;
  selectedSimcRuntimeVersion: string | null;
  setSelectedSimcRuntimeVersion: (value: string) => void;
  simcRuntimeVersions: SimcRuntimeVersionOption[];
  simcRuntimeVersionsLoading: boolean;
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
  selectedSimcRuntimeVersion,
  setSelectedSimcRuntimeVersion,
  simcRuntimeVersions,
  simcRuntimeVersionsLoading,
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
  const selectedSimcVersionValue = selectedSimcRuntimeVersion
    ? `version:${selectedSimcRuntimeVersion}`
    : `latest:${selectedSimcChannel}`;
  const displayedSimcVersion = selectedSimcRuntimeVersion || simcRuntimeInfo?.version;
  const weeklySimcVersions = simcRuntimeVersions.filter((version) => version.channel === 'weekly');
  const nightlySimcVersions = simcRuntimeVersions.filter(
    (version) => version.channel === 'nightly'
  );

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <h2 className="mb-3 text-xl font-semibold text-white">App Updates</h2>
      <div className="max-w-5xl space-y-3">
        <div data-update-card className="rounded-lg border border-border bg-surface-2 p-3">
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
              GitHub rate limited this request, so app versions and installer sizes cannot be shown.
              Check back later.
            </p>
          )}
          {updateMessage && <StatusMessage message={updateMessage} />}
        </div>

        {isDesktopRuntime && (
          <div data-update-card className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-300">SimC Version</span>
              <SimcVersionDropdown
                value={selectedSimcVersionValue}
                selectedChannel={selectedSimcChannel}
                selectedVersion={selectedSimcRuntimeVersion}
                weeklyVersions={weeklySimcVersions}
                nightlyVersions={nightlySimcVersions}
                onSelectLatest={setSelectedSimcChannel}
                onSelectVersion={setSelectedSimcRuntimeVersion}
              />
              {simcRuntimeVersionsLoading && (
                <span className="text-xs text-zinc-500">Loading versions...</span>
              )}
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
                    : displayedSimcVersion || 'Unavailable'}
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
            {simcChannelMessage && <StatusMessage message={simcChannelMessage} />}
          </div>
        )}
      </div>
    </section>
  );
}

function SimcVersionDropdown({
  value,
  selectedChannel,
  selectedVersion,
  weeklyVersions,
  nightlyVersions,
  onSelectLatest,
  onSelectVersion,
}: {
  value: string;
  selectedChannel: 'weekly' | 'nightly';
  selectedVersion: string | null;
  weeklyVersions: SimcRuntimeVersionOption[];
  nightlyVersions: SimcRuntimeVersionOption[];
  onSelectLatest: (channel: 'weekly' | 'nightly') => void;
  onSelectVersion: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(rootRef, open, () => setOpen(false));
  const label = selectedVersion || `Latest ${selectedChannel}`;

  const selectLatest = (channel: 'weekly' | 'nightly') => {
    onSelectLatest(channel);
    setOpen(false);
  };

  const selectVersion = (version: string) => {
    onSelectVersion(`version:${version}`);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-[220px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-md border border-gold/35 bg-surface-2/95 px-3 py-2 text-left text-sm font-semibold text-zinc-100 shadow-sm shadow-black/30 transition-colors hover:border-gold/60 hover:bg-surface"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="SimC Version"
          className="absolute left-0 top-full z-50 mt-1 min-w-full overflow-hidden rounded-lg border border-border bg-surface/95 py-2 shadow-2xl backdrop-blur"
        >
          <SimcVersionGroup
            title="Weekly"
            latestLabel="Latest weekly"
            latestSelected={value === 'latest:weekly'}
            versions={weeklyVersions}
            selectedVersion={selectedVersion}
            onSelectLatest={() => selectLatest('weekly')}
            onSelectVersion={selectVersion}
          />
          <SimcVersionGroup
            title="Nightly"
            latestLabel="Latest nightly"
            latestSelected={value === 'latest:nightly'}
            versions={nightlyVersions}
            selectedVersion={selectedVersion}
            onSelectLatest={() => selectLatest('nightly')}
            onSelectVersion={selectVersion}
          />
        </div>
      )}
    </div>
  );
}

function SimcVersionGroup({
  title,
  latestLabel,
  latestSelected,
  versions,
  selectedVersion,
  onSelectLatest,
  onSelectVersion,
}: {
  title: string;
  latestLabel: string;
  latestSelected: boolean;
  versions: SimcRuntimeVersionOption[];
  selectedVersion: string | null;
  onSelectLatest: () => void;
  onSelectVersion: (version: string) => void;
}) {
  return (
    <div className="py-1" role="group" aria-label={title}>
      <div className="px-4 pb-1 text-[13px] font-bold text-white">{title}</div>
      <button
        type="button"
        role="option"
        aria-selected={latestSelected}
        onClick={onSelectLatest}
        className={`w-full px-8 py-1.5 text-left text-[13px] font-semibold transition-colors ${
          latestSelected ? 'bg-white/15 text-white' : 'text-zinc-100 hover:bg-white/10'
        }`}
      >
        {latestLabel}
      </button>
      {versions.length === 0 ? (
        <div className="px-8 py-1.5 text-[12px] italic text-zinc-500">
          No older {title.toLowerCase()} versions found yet.
        </div>
      ) : (
        versions.map((version) => (
          <button
            key={version.version}
            type="button"
            role="option"
            aria-selected={selectedVersion === version.version}
            onClick={() => onSelectVersion(version.version)}
            className={`w-full px-8 py-1.5 text-left text-[13px] font-semibold transition-colors ${
              selectedVersion === version.version
                ? 'bg-white/15 text-white'
                : 'text-zinc-100 hover:bg-white/10'
            }`}
          >
            {version.version}
          </button>
        ))
      )}
    </div>
  );
}

function StatusMessage({ message }: { message: SettingsStatusMessage }) {
  return (
    <div
      data-update-status-message="bottom"
      className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
        message.type === 'success'
          ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
          : 'border border-red-500/20 bg-red-500/10 text-red-400'
      } mt-3`}
    >
      {message.text}
    </div>
  );
}
