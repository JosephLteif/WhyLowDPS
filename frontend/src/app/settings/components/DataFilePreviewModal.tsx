import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  useDismissOnOutside(modalRef, isOpen, onClose);

  const content = dataFilePreview?.content || '';
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchPositions = useMemo(() => {
    if (!normalizedQuery || !content) return [] as number[];
    const haystack = content.toLowerCase();
    const out: number[] = [];
    let idx = 0;
    while (idx >= 0) {
      idx = haystack.indexOf(normalizedQuery, idx);
      if (idx < 0) break;
      out.push(idx);
      idx += Math.max(1, normalizedQuery.length);
    }
    return out;
  }, [content, normalizedQuery]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [normalizedQuery, dataFilePreview?.relative_path]);

  const jumpToMatch = useCallback(
    (nextIndex: number) => {
      if (!contentRef.current || matchPositions.length === 0 || !normalizedQuery) return;
      const bounded = ((nextIndex % matchPositions.length) + matchPositions.length) % matchPositions.length;
      setActiveMatchIndex(bounded);
      const start = matchPositions[bounded];
      const end = start + normalizedQuery.length;
      contentRef.current.focus();
      contentRef.current.setSelectionRange(start, end);
      contentRef.current.scrollTop = 0;
      const before = content.slice(0, start);
      const lineCount = before.split('\n').length;
      const lineHeight = 20;
      contentRef.current.scrollTop = Math.max(0, (lineCount - 3) * lineHeight);
    },
    [content, matchPositions, normalizedQuery]
  );

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
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in file..."
                  className="min-w-[240px] flex-1 rounded-md border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                />
                <span className="text-xs text-zinc-400">
                  {normalizedQuery ? `${matchPositions.length} matches` : 'No search'}
                </span>
                <button
                  type="button"
                  onClick={() => jumpToMatch(activeMatchIndex - 1)}
                  disabled={!normalizedQuery || matchPositions.length === 0}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => jumpToMatch(activeMatchIndex + 1)}
                  disabled={!normalizedQuery || matchPositions.length === 0}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
              {dataFilePreview.truncated && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                  Preview truncated for large file.
                </div>
              )}
              <textarea
                ref={contentRef}
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
