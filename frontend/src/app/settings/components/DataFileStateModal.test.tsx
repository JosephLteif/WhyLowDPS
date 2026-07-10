import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DataFileStateModal from './DataFileStateModal';

const props = {
  isOpen: true,
  onClose: vi.fn(),
  isDesktop: true,
  dataFileStates: { base_path: 'C:/data', available: true, files: [] },
  dataStateLoading: false,
  dataStateError: '',
  dataStateMessage: null,
  dataActionBusyKey: null,
  groupedDataFiles: {
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
  },
  refreshDataStates: vi.fn(),
  downloadAllMissingFiles: vi.fn(),
  openDataRootDirectory: vi.fn(),
  downloadFile: vi.fn(),
  showFileContent: vi.fn(),
  dataFilePreviewLoading: false,
};

describe('DataFileStateModal', () => {
  it('shows whether each data file is required', () => {
    render(<DataFileStateModal {...props} />);

    expect(screen.getAllByText('Required')).toHaveLength(2);
    expect(screen.getAllByText('Optional')).toHaveLength(2);
  });

  it('filters optional missing files by status and requirement', async () => {
    const user = userEvent.setup();
    render(<DataFileStateModal {...props} />);

    await user.click(screen.getByRole('button', { name: 'Missing' }));
    await user.click(screen.getByRole('button', { name: 'Optional' }));

    expect(screen.getByText('Temp Enchants')).toBeInTheDocument();
    expect(screen.queryByText('Potions')).not.toBeInTheDocument();
  });

  it('shows a filtered empty state when search and filters have no overlap', async () => {
    const user = userEvent.setup();
    render(<DataFileStateModal {...props} />);

    await user.click(screen.getByRole('button', { name: 'Missing' }));
    await user.type(screen.getByPlaceholderText('Search files...'), 'potions');

    expect(screen.getByText('No files match the active filters or search.')).toBeInTheDocument();
  });
});
