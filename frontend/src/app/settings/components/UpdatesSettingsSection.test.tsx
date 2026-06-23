import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpdatesSettingsSection from './UpdatesSettingsSection';

const noop = vi.fn();

describe('UpdatesSettingsSection', () => {
  it('renders update status messages at the bottom of their related cards', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="nightly"
        setSelectedSimcChannel={noop}
        simcRuntimeInfo={{
          channel: 'nightly',
          version: 'nightly-202606230509',
          assetName: 'simc-win64.zip',
          assetSizeBytes: 15055959,
          metadataStatus: 'available',
        }}
        simcRuntimeInfoLoading={false}
        simcRuntimeDownloading={false}
        refreshSimcRuntimeInfo={noop}
        downloadSelectedSimcRuntime={noop}
        simcChannelMessage={{ type: 'success', text: 'SimC channel saved as nightly.' }}
        isDesktopRuntime={true}
        updateCheckState="idle"
        appReleases={[
          {
            version: '3.3.1',
            downloadUrl: 'https://example.test/app.exe',
            assetName: 'WhyLowDps_3.3.1_x64-setup.exe',
            assetSizeBytes: 194100000,
            publishedAt: '2026-06-22T00:00:00Z',
          },
        ]}
        appReleaseMetadataStatus="available"
        selectedAppVersion="3.3.1"
        setSelectedAppVersion={noop}
        loadAppReleases={noop}
        downloadAndInstallLatest={noop}
        updateMessage={{ type: 'success', text: 'You are on the latest version (3.3.1).' }}
      />
    );

    const appCard = screen.getByText('Stable Version').closest('[data-update-card]');
    const simcCard = screen.getByText('SimC Channel').closest('[data-update-card]');
    const appMessage = screen.getByText('You are on the latest version (3.3.1).');
    const simcMessage = screen.getByText('SimC channel saved as nightly.');

    expect(appCard).toContainElement(appMessage);
    expect(appCard).not.toContainElement(simcMessage);
    expect(simcCard).toContainElement(simcMessage);
    expect(simcCard).not.toContainElement(appMessage);
    expect(appMessage.closest('[data-update-status-message]')).toHaveAttribute(
      'data-update-status-message',
      'bottom'
    );
    expect(simcMessage.closest('[data-update-status-message]')).toHaveAttribute(
      'data-update-status-message',
      'bottom'
    );
  });
});
