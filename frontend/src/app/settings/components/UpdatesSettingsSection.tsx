import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DeploymentInfo, SettingsStatusMessage } from '../types';
import { formatBytesDecimal } from '../../lib/format';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';
import type { AppReleaseInfo, DockerImageReleaseInfo } from '../../lib/updater-release';
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
  dockerReleases?: DockerImageReleaseInfo[];
  dockerReleaseMetadataStatus?: 'available' | 'rate_limited' | 'unavailable';
  selectedAppVersion: string;
  setSelectedAppVersion: (version: string) => void;
  loadAppReleases: (options?: { forceRefresh?: boolean }) => void;
  downloadAndInstallLatest: () => void;
  updateMessage: SettingsStatusMessage | null;
  isHostedPrivateRuntime?: boolean;
  deploymentInfo?: DeploymentInfo | null;
  loadDockerReleases?: (options?: { forceRefresh?: boolean }) => void;
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
  isHostedPrivateRuntime = false,
  deploymentInfo = null,
  dockerReleases = [],
  dockerReleaseMetadataStatus = 'unavailable',
  loadDockerReleases = () => {},
}: UpdatesSettingsSectionProps) {
  const selectedAppRelease =
    appReleases.find((release) => release.version === selectedAppVersion) || appReleases[0] || null;
  const appMetadataRateLimited = appReleaseMetadataStatus === 'rate_limited';
  const simcMetadataRateLimited = simcRuntimeInfo?.metadataStatus === 'rate_limited';
  const selectedSimcVersionValue = selectedSimcRuntimeVersion
    ? `version:${selectedSimcRuntimeVersion}`
    : `latest:${selectedSimcChannel}`;
  const displayedSimcVersion = formatSimcVersionName(
    selectedSimcRuntimeVersion || simcRuntimeInfo?.version
  );
  const weeklySimcVersions = simcRuntimeVersions.filter((version) => version.channel === 'weekly');
  const nightlySimcVersions = simcRuntimeVersions.filter(
    (version) => version.channel === 'nightly'
  );

  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <h2 className="mb-3 text-xl font-semibold text-white">
        {isHostedPrivateRuntime ? 'Docker Updates' : 'App Updates'}
      </h2>
      <div className="max-w-5xl space-y-3">
        {isHostedPrivateRuntime ? (
          <DockerUpdatesCard
            dockerReleases={dockerReleases}
            dockerReleaseMetadataStatus={dockerReleaseMetadataStatus}
            deploymentInfo={deploymentInfo}
            loadDockerReleases={loadDockerReleases}
          />
        ) : (
          <div data-update-card className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-300">App Version</span>
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
            {updateMessage && <StatusMessage message={updateMessage} />}
          </div>
        )}

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

const DOCKER_IMAGE_REPOSITORY = 'ghcr.io/josephlteif/whylowdps';

type DockerReleaseOption = {
  tag: string;
  version?: string;
};

function DockerUpdatesCard({
  dockerReleases,
  dockerReleaseMetadataStatus,
  deploymentInfo,
  loadDockerReleases,
}: {
  dockerReleases: DockerImageReleaseInfo[];
  dockerReleaseMetadataStatus: 'available' | 'rate_limited' | 'unavailable';
  deploymentInfo: DeploymentInfo | null;
  loadDockerReleases: (options?: { forceRefresh?: boolean }) => void;
}) {
  const [selectedTag, setSelectedTag] = useState('latest');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const latestRelease = dockerReleases[0] || null;
  const imageOptions: DockerReleaseOption[] = latestRelease
    ? [
        { tag: 'latest', version: latestRelease.version },
        ...dockerReleases.map((release) => ({
          tag: release.version,
          version: release.version,
        })),
      ]
    : [];
  const selectedRelease =
    imageOptions.find((release) => release.tag === selectedTag) || imageOptions[0] || null;
  const selectedImage = selectedRelease
    ? `${DOCKER_IMAGE_REPOSITORY}:${selectedRelease.tag}`
    : null;
  const currentVersion = deploymentInfo?.version || null;
  const updateCommand =
    selectedRelease?.tag === 'latest'
      ? [
          'docker compose --env-file .env.docker pull',
          'docker compose --env-file .env.docker up -d',
        ].join('\n')
      : selectedImage
        ? [
            `# Set image in compose.yaml to ${selectedImage}`,
            'docker compose --env-file .env.docker pull',
            'docker compose --env-file .env.docker up -d',
          ].join('\n')
        : '';

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
      window.setTimeout(() => setCopyMessage(null), 1800);
    } catch {
      setCopyMessage('Clipboard access is unavailable; select the text manually.');
    }
  };

  return (
    <div data-update-card className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">Docker image</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-500">
            Docker updates run on the host that runs Compose. This browser can show available image
            tags and copy the update commands, but it cannot restart the container itself.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          {imageOptions.length > 0 ? (
            <label className="block text-xs font-medium text-zinc-400">
              Available image
              <select
                value={selectedRelease?.tag || ''}
                onChange={(event) => setSelectedTag(event.target.value)}
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-zinc-100"
              >
                {imageOptions.map((release) => (
                  <option key={release.tag} value={release.tag}>
                    {release.tag === 'latest'
                      ? `latest${release.version ? ` (${release.version})` : ''}`
                      : release.tag}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-md border border-border/60 bg-surface/50 px-3 py-2 text-sm text-zinc-400">
              No published Docker image tags were found.
            </div>
          )}
          <button
            type="button"
            onClick={() => loadDockerReleases({ forceRefresh: true })}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Refresh
          </button>
        </div>

        <div className="grid gap-2 rounded-md border border-border/60 bg-surface/50 p-3 text-xs text-zinc-400 sm:grid-cols-2">
          <span className="min-w-0 truncate" title={currentVersion || 'Version unavailable'}>
            Running version:{' '}
            <code className="text-zinc-200">{currentVersion || 'Unavailable'}</code>
          </span>
          {selectedImage && (
            <span className="min-w-0 truncate" title={selectedImage}>
              Selected image: <code className="text-zinc-200">{selectedImage}</code>
            </span>
          )}
          <span>
            Latest version:{' '}
            <span className="text-zinc-200">{latestRelease?.version || 'Unavailable'}</span>
          </span>
          <span>
            Revision:{' '}
            <span className="text-zinc-200">{deploymentInfo?.revision || 'Unavailable'}</span>
          </span>
        </div>

        {selectedRelease && selectedImage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText('Image reference', selectedImage)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Copy image reference
            </button>
            <button
              type="button"
              onClick={() => void copyText('Update commands', updateCommand)}
              className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20"
            >
              Copy update commands
            </button>
            <a
              href={`https://github.com/JosephLteif/simcraft/releases/tag/v${selectedRelease.version}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10"
            >
              Release notes
            </a>
          </div>
        )}

        {copyMessage && <p className="text-xs text-emerald-300">{copyMessage}</p>}
        {dockerReleaseMetadataStatus === 'rate_limited' && (
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            GitHub rate limited this request, so Docker image versions cannot be refreshed right
            now.
          </p>
        )}
        {dockerReleaseMetadataStatus === 'available' && imageOptions.length === 0 && (
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            No Docker image has been published for the available application releases yet.
          </p>
        )}
        {dockerReleaseMetadataStatus === 'unavailable' && (
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Docker image release metadata is unavailable. The running image information is still
            read from this container.
          </p>
        )}
        <p className="text-xs text-zinc-500">
          Keep <code>.env.docker</code> and the <code>whylowdps-data</code> volume when recreating
          the service.
        </p>
      </div>
    </div>
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
  const [activeChannel, setActiveChannel] = useState<'weekly' | 'nightly'>(selectedChannel);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(rootRef, open, () => setOpen(false));
  const selectedVersionChannel = selectedVersion
    ? weeklyVersions.some((version) => version.version === selectedVersion)
      ? 'weekly'
      : nightlyVersions.some((version) => version.version === selectedVersion)
        ? 'nightly'
        : selectedChannel
    : selectedChannel;
  const activeVersions = activeChannel === 'weekly' ? weeklyVersions : nightlyVersions;
  const label = selectedVersion
    ? formatSimcVersionName(selectedVersion)
    : `Latest ${selectedChannel}`;

  useEffect(() => {
    setActiveChannel(selectedVersionChannel);
  }, [selectedVersionChannel]);

  const selectLatest = (channel: 'weekly' | 'nightly') => {
    onSelectLatest(channel);
    setActiveChannel(channel);
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
          className="absolute left-0 top-full z-50 mt-1 min-w-[320px] overflow-hidden rounded-lg border border-border bg-surface/95 shadow-2xl backdrop-blur"
        >
          <div className="flex border-b border-border">
            <button
              type="button"
              onClick={() => setActiveChannel('weekly')}
              className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                activeChannel === 'weekly'
                  ? 'border-gold text-gold'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Weekly ({weeklyVersions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveChannel('nightly')}
              className={`flex-1 border-b-2 px-3 py-2 text-[12px] font-semibold transition-colors ${
                activeChannel === 'nightly'
                  ? 'border-gold text-gold'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Nightly ({nightlyVersions.length})
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto py-2">
            <SimcVersionGroup
              title={activeChannel === 'weekly' ? 'Weekly' : 'Nightly'}
              latestLabel={`Latest ${activeChannel}`}
              latestSelected={value === `latest:${activeChannel}`}
              versions={activeVersions}
              selectedVersion={selectedVersion}
              onSelectLatest={() => selectLatest(activeChannel)}
              onSelectVersion={selectVersion}
            />
          </div>
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
            {formatSimcVersionName(version.version)}
          </button>
        ))
      )}
    </div>
  );
}

function formatSimcVersionName(version: string | null | undefined): string {
  if (!version) return 'Unavailable';

  const match = version.match(/^(?:[^-]+-)?(\d{8})(\d{4})?$/);
  if (!match) return version;

  const [, datePart, timePart] = match;
  const year = datePart.slice(0, 4);
  const month = datePart.slice(4, 6);
  const day = datePart.slice(6, 8);

  if (!timePart) {
    return `${year}-${month}-${day}`;
  }

  const hours = timePart.slice(0, 2);
  const minutes = timePart.slice(2, 4);
  return `${year}-${month}-${day} ${hours}:${minutes}`;
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
