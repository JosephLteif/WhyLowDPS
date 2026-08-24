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

    const appCard = screen.getByText('App Version').closest('[data-update-card]');
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

  it('shows channel tabs first, then the versions for the selected channel', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Latest weekly' }));

    expect(screen.getByRole('button', { name: 'Weekly (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nightly (1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Latest weekly' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '2026-06-22 01:00' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '2026-06-24 01:00' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Nightly (1)' }));

    expect(screen.getByRole('option', { name: 'Latest nightly' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '2026-06-24 01:00' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '2026-06-22 01:00' })).toBeNull();
  });

  it('formats SimC version names into readable dates while tolerating non-timestamp names', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="nightly"
        setSelectedSimcChannel={noop}
        selectedSimcRuntimeVersion="nightly-202606290558"
        setSelectedSimcRuntimeVersion={noop}
        simcRuntimeVersions={[
          {
            channel: 'weekly',
            version: 'weekly-20260629',
            publishedAt: '2026-06-29T00:00:00Z',
          },
          {
            channel: 'nightly',
            version: 'nightly-202606290558',
            publishedAt: '2026-06-29T05:58:00Z',
          },
          {
            channel: 'nightly',
            version: 'nightly-release-candidate',
            publishedAt: '2026-06-29T06:00:00Z',
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

    expect(screen.getByRole('button', { name: '2026-06-29 05:58' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2026-06-29 05:58' }));

    fireEvent.click(screen.getByRole('button', { name: 'Weekly (1)' }));
    expect(screen.getByRole('option', { name: '2026-06-29' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Nightly (2)' }));
    expect(screen.getByRole('option', { name: '2026-06-29 05:58' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'nightly-release-candidate' })).toBeTruthy();
  });

  it('explains when GitHub has not published older SimC versions yet for the selected channel', () => {
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

    expect(screen.getByText('No older nightly versions found yet.')).toBeTruthy();
    expect(screen.queryByText('No older weekly versions found yet.')).toBeNull();
  });

  it('shows Docker image tags and host-side update actions in hosted mode', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="weekly"
        setSelectedSimcChannel={noop}
        selectedSimcRuntimeVersion={null}
        setSelectedSimcRuntimeVersion={noop}
        simcRuntimeVersions={[]}
        simcRuntimeVersionsLoading={false}
        simcRuntimeInfo={{
          channel: 'weekly',
          version: 'weekly-202606240831',
          assetName: 'simc-linux-x64.zip',
          assetSizeBytes: 15055959,
          metadataStatus: 'available',
        }}
        simcRuntimeInfoLoading={false}
        simcRuntimeDownloading={false}
        refreshSimcRuntimeInfo={noop}
        downloadSelectedSimcRuntime={noop}
        simcChannelMessage={null}
        isDesktopRuntime={true}
        isHostedPrivateRuntime={true}
        updateCheckState="idle"
        appReleases={[]}
        dockerReleases={[
          {
            version: '3.3.1',
            publishedAt: '2026-06-22T00:00:00Z',
          },
          {
            version: '3.3.0',
            publishedAt: '2026-06-20T00:00:00Z',
          },
        ]}
        appReleaseMetadataStatus="available"
        dockerReleaseMetadataStatus="available"
        selectedAppVersion="3.3.1"
        setSelectedAppVersion={noop}
        loadAppReleases={noop}
        downloadAndInstallLatest={noop}
        updateMessage={null}
        deploymentInfo={{ mode: 'hosted', version: '3.3.0', revision: 'abc123' }}
      />
    );

    expect(screen.getByRole('heading', { name: 'Docker Updates' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'latest (3.3.1)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '3.3.0' })).toBeTruthy();
    expect(screen.getByText('3.3.0', { selector: 'code' })).toBeTruthy();
    const dockerCard = screen.getByText('Docker image').closest('[data-update-card]');
    const simcCard = screen
      .getByRole('combobox', { name: 'SimC channel' })
      .closest('[data-update-card]');
    const simcVersion = screen.getByText(/2026-06-24 08:31/);
    const simcAsset = screen.getByText(/simc-linux-x64\.zip/);
    expect(simcCard?.contains(simcVersion)).toBe(true);
    expect(simcCard?.contains(simcAsset)).toBe(true);
    expect(dockerCard?.contains(simcVersion)).toBe(false);
    expect(dockerCard?.contains(simcAsset)).toBe(false);
    expect(screen.getByRole('button', { name: 'Copy update commands' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'SimC channel' })).toBeTruthy();
    expect(screen.queryByText('Stable Version')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download & Install' })).toBeNull();
  });

  it('does not show Docker image controls when no image was published', () => {
    render(
      <UpdatesSettingsSection
        selectedSimcChannel="weekly"
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
        isDesktopRuntime={false}
        isHostedPrivateRuntime={true}
        updateCheckState="idle"
        appReleases={[]}
        appReleaseMetadataStatus="available"
        selectedAppVersion=""
        setSelectedAppVersion={noop}
        loadAppReleases={noop}
        downloadAndInstallLatest={noop}
        updateMessage={null}
        dockerReleases={[]}
        dockerReleaseMetadataStatus="available"
        deploymentInfo={{ mode: 'hosted', version: '3.8.0', revision: 'working-tree' }}
      />
    );

    expect(screen.getByText('No published Docker image tags were found.')).toBeTruthy();
    expect(screen.getByText(/No Docker image has been published/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy image reference' })).toBeNull();
  });
});
