import {
  UPDATE_CHANNEL_OPTIONS,
  type UpdateChannel,
} from '../../lib/update-channel';
import type { SettingsStatusMessage } from '../types';

type UpdatesSettingsSectionProps = {
  selectedUpdateChannel: UpdateChannel;
  setSelectedUpdateChannel: (channel: UpdateChannel) => void;
  updateCheckState: 'idle' | 'checking' | 'installing';
  checkForUpdatesNow: () => void;
  downloadAndInstallLatest: () => void;
  updateMessage: SettingsStatusMessage | null;
};

export default function UpdatesSettingsSection({
  selectedUpdateChannel,
  setSelectedUpdateChannel,
  updateCheckState,
  checkForUpdatesNow,
  downloadAndInstallLatest,
  updateMessage,
}: UpdatesSettingsSectionProps) {
  return (
    <section className="rounded-xl border border-border/50 bg-surface/30 p-6 backdrop-blur-sm">
      <h2 className="mb-3 text-xl font-semibold text-white">App Updates</h2>
      <div className="max-w-2xl space-y-3">
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-300">Channel</span>
            <select
              value={selectedUpdateChannel}
              onChange={(e) => setSelectedUpdateChannel(e.target.value as UpdateChannel)}
              className="min-w-[180px] rounded border border-border bg-surface px-3 py-2 text-sm text-zinc-100"
            >
              {UPDATE_CHANNEL_OPTIONS.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
            <button
              onClick={checkForUpdatesNow}
              disabled={updateCheckState !== 'idle'}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              {updateCheckState === 'checking' ? 'Checking...' : 'Check'}
            </button>
            <button
              onClick={downloadAndInstallLatest}
              disabled={updateCheckState !== 'idle'}
              className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
            >
              {updateCheckState === 'installing' ? 'Starting...' : 'Download & Install'}
            </button>
          </div>
        </div>

        {updateMessage && (
          <div
            className={`animate-in fade-in zoom-in rounded-lg p-4 text-sm duration-300 ${
              updateMessage.type === 'success'
                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border border-red-500/20 bg-red-500/10 text-red-400'
            }`}
          >
            {updateMessage.text}
          </div>
        )}
      </div>
    </section>
  );
}
