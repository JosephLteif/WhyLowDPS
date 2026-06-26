import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdatesSettingsSection from './UpdatesSettingsSection';

const noop = vi.fn();

afterEach(() => {
  cleanup();
});

describe('UpdatesSettingsSection', () => {
  it('renders update status messages at the bottom of their related cards', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="nightly"
        setSelectedSimcChannel={noop}
        selectedSimcRuntimeVersion={null}
        setSelectedSimcRuntimeVersion={noop}
        simcRuntimeVersions={[
          {
            channel: 'weekly',
            version: 'weekly-202606220100',
            publishedAt: '2026-06-22T01:00:00Z',
          },
          {
            channel: 'nightly',
            version: 'nightly-202606240100',
            publishedAt: '2026-06-24T01:00:00Z',
          },
        ]}
        simcRuntimeVersionsLoading={false}
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
    const simcCard = screen.getByText('SimC Version').closest('[data-update-card]');
    const appMessage = screen.getByText('You are on the latest version (3.3.1).');
    const simcMessage = screen.getByText('SimC channel saved as nightly.');

    expect(appCard?.contains(appMessage)).toBe(true);
    expect(appCard?.contains(simcMessage)).toBe(false);
    expect(simcCard?.contains(simcMessage)).toBe(true);
    expect(simcCard?.contains(appMessage)).toBe(false);
    expect(
      appMessage.closest('[data-update-status-message]')?.getAttribute('data-update-status-message')
    ).toBe('bottom');
    expect(
      simcMessage
        .closest('[data-update-status-message]')
        ?.getAttribute('data-update-status-message')
    ).toBe('bottom');
  });

  it('groups SimC runtime choices by weekly and nightly releases', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="weekly"
        setSelectedSimcChannel={noop}
        selectedSimcRuntimeVersion={null}
        setSelectedSimcRuntimeVersion={noop}
        simcRuntimeVersions={[
          {
            channel: 'weekly',
            version: 'weekly-202606220100',
            publishedAt: '2026-06-22T01:00:00Z',
          },
          {
            channel: 'nightly',
            version: 'nightly-202606240100',
            publishedAt: '2026-06-24T01:00:00Z',
          },
        ]}
        simcRuntimeVersionsLoading={false}
        simcRuntimeInfo={null}
        simcRuntimeInfoLoading={false}
        simcRuntimeDownloading={false}
        refreshSimcRuntimeInfo={noop}
        downloadSelectedSimcRuntime={noop}
        simcChannelMessage={null}
        isDesktopRuntime={true}
        updateCheckState="idle"
        appReleases={[]}
        appReleaseMetadataStatus="available"
        selectedAppVersion=""
        setSelectedAppVersion={noop}
        loadAppReleases={noop}
        downloadAndInstallLatest={noop}
        updateMessage={null}
      />
    );

    expect(screen.getByRole('button', { name: 'Latest weekly' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Latest weekly' }));

    expect(screen.getByRole('group', { name: 'Weekly' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Nightly' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Latest weekly' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'weekly-202606220100' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'nightly-202606240100' })).toBeTruthy();
  });

  it('explains when GitHub has not published older SimC versions yet', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="nightly"
        setSelectedSimcChannel={noop}
        selectedSimcRuntimeVersion={null}
        setSelectedSimcRuntimeVersion={noop}
        simcRuntimeVersions={[]}
        simcRuntimeVersionsLoading={false}
        simcRuntimeInfo={null}
        simcRuntimeInfoLoading={false}
        simcRuntimeDownloading={false}
        refreshSimcRuntimeInfo={noop}
        downloadSelectedSimcRuntime={noop}
        simcChannelMessage={null}
        isDesktopRuntime={true}
        updateCheckState="idle"
        appReleases={[]}
        appReleaseMetadataStatus="available"
        selectedAppVersion=""
        setSelectedAppVersion={noop}
        loadAppReleases={noop}
        downloadAndInstallLatest={noop}
        updateMessage={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Latest nightly' }));

    expect(screen.getByText('No older weekly versions found yet.')).toBeTruthy();
    expect(screen.getByText('No older nightly versions found yet.')).toBeTruthy();
  });
});
