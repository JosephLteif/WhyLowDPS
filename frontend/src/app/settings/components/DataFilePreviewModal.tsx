import { useRef } from 'react';
import { useDismissOnOutside } from '../../lib/useDismissOnOutside';
import type { DataFilePreviewResponse } from '../types';

type DataFilePreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  dataFilePreview: DataFilePreviewResponse | null;
  dataFilePreviewLoading: boolean;
  dataFilePreviewError: string;
};

export default function DataFilePreviewModal({
  isOpen,
  onClose,
  dataFilePreview,
  dataFilePreviewLoading,
  dataFilePreviewError,
}: DataFilePreviewModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutside(modalRef, isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4">
      <div
        ref={modalRef}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-[#101010] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              {dataFilePreview?.label || 'File Content'}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              {dataFilePreview?.relative_path || 'Loading...'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {dataFilePreviewLoading && <p className="text-sm text-zinc-400">Loading file content...</p>}
          {!dataFilePreviewLoading && dataFilePreviewError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {dataFilePreviewError}
            </div>
          )}
          {!dataFilePreviewLoading && dataFilePreview && (
            <div className="space-y-3">
              {dataFilePreview.truncated && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                  Preview truncated for large file.
                </div>
              )}
              <textarea
                readOnly
                value={dataFilePreview.content}
                className="h-[60vh] w-full rounded-lg border border-border bg-black/50 p-4 font-mono text-[12px] leading-5 text-zinc-200 outline-none"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
