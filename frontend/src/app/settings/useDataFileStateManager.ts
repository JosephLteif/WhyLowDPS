import { useCallback, useMemo, useState } from 'react';
import { API_URL, fetchJson, isDesktop } from '../lib/api';
import type {
  DataFilePreviewResponse,
  DataFileState,
  DataFileStatesResponse,
  SettingsStatusMessage,
} from './types';

type SectionSummary = {
  totalBytes: number;
  downloaded: number;
  total: number;
};

export function useDataFileStateManager() {
  const [dataStateLoading, setDataStateLoading] = useState(false);
  const [dataStateError, setDataStateError] = useState('');
  const [dataStateMessage, setDataStateMessage] = useState<SettingsStatusMessage | null>(null);
  const [dataStateOpen, setDataStateOpen] = useState(false);
  const [dataFileStates, setDataFileStates] = useState<DataFileStatesResponse | null>(null);
  const [dataActionBusyKey, setDataActionBusyKey] = useState<string | null>(null);
  const [dataFilePreview, setDataFilePreview] = useState<DataFilePreviewResponse | null>(null);
  const [dataFilePreviewOpen, setDataFilePreviewOpen] = useState(false);
  const [dataFilePreviewLoading, setDataFilePreviewLoading] = useState(false);
  const [dataFilePreviewError, setDataFilePreviewError] = useState('');

  const refreshDataStates = useCallback(async () => {
    setDataStateLoading(true);
    setDataStateError('');
    try {
      const data = await fetchJson<DataFileStatesResponse>(`${API_URL}/api/data/files`);
      setDataFileStates(data);
    } catch (err: any) {
      setDataStateError(err?.message || 'Failed to refresh data file states.');
    } finally {
      setDataStateLoading(false);
    }
  }, []);

  const viewDataStates = useCallback(async () => {
    setDataStateOpen(true);
    setDataStateLoading(true);
    setDataStateError('');
    setDataStateMessage(null);
    try {
      const data = await fetchJson<DataFileStatesResponse>(`${API_URL}/api/data/files`);
      setDataFileStates(data);
    } catch (err: any) {
      setDataStateError(err?.message || 'Failed to load data file states.');
    } finally {
      setDataStateLoading(false);
    }
  }, []);

  const downloadFile = useCallback(
    async (key: string) => {
      setDataActionBusyKey(key);
      setDataStateMessage(null);
      try {
        await fetchJson(`${API_URL}/api/data/files/${encodeURIComponent(key)}/download`, {
          method: 'POST',
        });
        await refreshDataStates();
        setDataStateMessage({ type: 'success', text: 'File downloaded successfully.' });
      } catch (err: any) {
        setDataStateMessage({ type: 'error', text: err?.message || 'Failed to download file.' });
      } finally {
        setDataActionBusyKey(null);
      }
    },
    [refreshDataStates]
  );

  const downloadAllMissingFiles = useCallback(async () => {
    setDataActionBusyKey('download-missing');
    setDataStateMessage(null);
    try {
      const data = await fetchJson<{ downloaded_keys?: string[]; failed?: unknown[] }>(
        `${API_URL}/api/data/files/missing/download`,
        { method: 'POST' }
      );
      await refreshDataStates();
      const count = data.downloaded_keys?.length ?? 0;
      const failures = data.failed?.length ?? 0;
      if (failures > 0) {
        setDataStateMessage({
          type: 'error',
          text: `Downloaded ${count} files, ${failures} failed. Check backend logs for details.`,
        });
      } else {
        setDataStateMessage({ type: 'success', text: `Downloaded ${count} missing files.` });
      }
    } catch (err: any) {
      setDataStateMessage({
        type: 'error',
        text: err?.message || 'Failed to download missing files.',
      });
    } finally {
      setDataActionBusyKey(null);
    }
  }, [refreshDataStates]);

  const openDataRootDirectory = useCallback(async () => {
    if (!dataFileStates?.base_path || !isDesktop) return;
    setDataStateMessage(null);
    try {
      await fetchJson(`${API_URL}/api/data/files/open-directory`, { method: 'POST' });
    } catch (err: any) {
      setDataStateMessage({
        type: 'error',
        text: err?.message || 'Failed to open directory.',
      });
    }
  }, [dataFileStates?.base_path]);

  const showFileContent = useCallback(async (key: string) => {
    setDataFilePreviewOpen(true);
    setDataFilePreviewLoading(true);
    setDataFilePreviewError('');
    setDataFilePreview(null);
    try {
      const data = await fetchJson<DataFilePreviewResponse>(
        `${API_URL}/api/data/files/${encodeURIComponent(key)}/content`
      );
      setDataFilePreview(data);
    } catch (err: any) {
      setDataFilePreviewError(err?.message || 'Failed to load file content.');
    } finally {
      setDataFilePreviewLoading(false);
    }
  }, []);

  const groupedDataFiles = useMemo(
    () =>
      dataFileStates?.files.reduce<Record<string, DataFileState[]>>((acc, file) => {
        (acc[file.section] ||= []).push(file);
        return acc;
      }, {}),
    [dataFileStates]
  );

  const sectionSummaries = useMemo(
    () =>
      Object.entries(groupedDataFiles || {}).reduce<Record<string, SectionSummary>>(
        (acc, [section, files]) => {
          acc[section] = {
            totalBytes: files.reduce((sum, file) => sum + (file.exists ? file.size_bytes : 0), 0),
            downloaded: files.filter((file) => file.exists).length,
            total: files.length,
          };
          return acc;
        },
        {}
      ),
    [groupedDataFiles]
  );

  return {
    dataStateLoading,
    dataStateError,
    dataStateMessage,
    dataStateOpen,
    setDataStateOpen,
    dataFileStates,
    dataActionBusyKey,
    dataFilePreview,
    dataFilePreviewOpen,
    setDataFilePreviewOpen,
    dataFilePreviewLoading,
    dataFilePreviewError,
    viewDataStates,
    refreshDataStates,
    downloadFile,
    downloadAllMissingFiles,
    openDataRootDirectory,
    showFileContent,
    groupedDataFiles,
    sectionSummaries,
  };
}
