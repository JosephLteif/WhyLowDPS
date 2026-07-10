import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataFileStateModal from './DataFileStateModal';

describe('DataFileStateModal', () => {
  it('shows whether each data file is required', () => {
    render(
      <DataFileStateModal
        isOpen
        onClose={vi.fn()}
        isDesktop
        dataFileStates={{ base_path: 'C:/data', available: true, files: [] }}
        dataStateLoading={false}
        dataStateError=""
        dataStateMessage={null}
        dataActionBusyKey={null}
        groupedDataFiles={{
          Consumables: [
            {
              key: 'potions',
              label: 'Potions',
              section: 'Consumables',
              relative_path: 'potions.json',
              resolved_path: 'C:/data/potions.json',
              required: true,
              downloadable: true,
              exists: true,
              size_bytes: 128,
            },
            {
              key: 'temp-enchants',
              label: 'Temp Enchants',
              section: 'Consumables',
              relative_path: 'temp-enchants.json',
              resolved_path: 'C:/data/temp-enchants.json',
              required: false,
              downloadable: true,
              exists: false,
              size_bytes: 0,
            },
          ],
        }}
        sectionSummaries={{ Consumables: { totalBytes: 128, downloaded: 1, total: 2 } }}
        refreshDataStates={vi.fn()}
        downloadAllMissingFiles={vi.fn()}
        openDataRootDirectory={vi.fn()}
        downloadFile={vi.fn()}
        showFileContent={vi.fn()}
        dataFilePreviewLoading={false}
      />,
    );

    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();
  });
});
