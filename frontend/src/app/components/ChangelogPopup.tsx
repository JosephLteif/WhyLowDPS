'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}`;

type ReleaseNoteCategory = 'feature' | 'fix' | 'improvement';

type ReleaseNote = {
  category: ReleaseNoteCategory;
  title: string;
  body: Array<
    | {
        type: 'paragraph';
        text: string;
      }
    | {
        type: 'list';
        items: string[];
      }
  >;
};

const releaseNotes: ReleaseNote[] = [
  {
    category: 'improvement',
    title: 'Warcraft Logs boss guides',
    body: [
      {
        type: 'paragraph',
        text: 'Current-season raid bosses now link directly to Warcraft Logs guides where one is available.',
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Simulation Activity time grouping',
    body: [
      {
        type: 'paragraph',
        text: 'The dashboard activity chart now switches between daily, weekly, monthly, and yearly views.',
      },
    ],
  },
  {
    category: 'improvement',
    title: 'SimC and app updates decoupling',
    body: [
      {
        type: 'paragraph',
        text: 'App updates and SimulationCraft updates are now managed separately.',
      },
      {
        type: 'paragraph',
        text: 'Previously, every new SimC nightly or weekly build required a matching app update/version, which created unnecessary releases and made the app update flow noisier than it needed to be.',
      },
      {
        type: 'paragraph',
        text: 'Now, the app can update SimC independently from the main application. You can choose a dedicated SimC update channel, while app updates are reserved for stable application releases only.',
      },
      {
        type: 'list',
        items: [
          'New SimC versions can be delivered faster without requiring a full app release.',
          'App updates should now be less frequent and more meaningful.',
          'Nightly and weekly SimC builds no longer force separate app versions.',
          'You have more control over which SimC channel the app uses.',
        ],
      },
    ],
  },
];

const releaseNoteCategoryLabels: Record<ReleaseNoteCategory, string> = {
  feature: 'Features',
  fix: 'Fixes',
  improvement: 'Improvements',
};

export default function ChangelogPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentNote = releaseNotes[currentIndex];
  const hasMultipleNotes = releaseNotes.length > 1;

  useEffect(() => {
    const seen = localStorage.getItem(seenKey) === '1';
    if (!seen) setIsOpen(true);

    const open = () => {
      setCurrentIndex(0);
      setIsOpen(true);
    };
    window.addEventListener(CHANGELOG_OPEN_EVENT, open);
    return () => window.removeEventListener(CHANGELOG_OPEN_EVENT, open);
  }, []);

  const dismiss = () => {
    localStorage.setItem(seenKey, '1');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-6"
      style={{ top: 'var(--app-header-height)' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className="flex max-h-[min(720px,calc(100vh-var(--app-header-height)-3rem))] w-full max-w-xl flex-col rounded-xl border border-white/10 bg-[#111218] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              {APP_VERSION_WITH_PREFIX}
            </p>
            <h2 id="changelog-title" className="mt-1 text-lg font-semibold text-zinc-100">
              What&apos;s new
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
            aria-label="Close changelog"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <article className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
            {releaseNoteCategoryLabels[currentNote.category]}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-100">{currentNote.title}</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
            {currentNote.body.map((block, blockIndex) =>
              block.type === 'paragraph' ? (
                <p key={`${currentNote.title}-${blockIndex}`}>{block.text}</p>
              ) : (
                <ul
                  key={`${currentNote.title}-${blockIndex}`}
                  className="list-disc space-y-2 pl-5 marker:text-gold"
                >
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            )}
          </div>
        </article>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-white/10 p-5">
          <button
            type="button"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={currentIndex === 0}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="Previous changelog item"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </button>

          {hasMultipleNotes ? (
            <div className="flex items-center justify-center gap-2" aria-label="Changelog pages">
              {releaseNotes.map((note, index) => {
                const isCurrent = index === currentIndex;
                return (
                  <button
                    key={note.title}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    aria-label={`Show changelog item ${index + 1}`}
                    aria-current={isCurrent}
                    className={`h-2.5 w-2.5 rounded-full border transition-colors ${
                      isCurrent
                        ? 'border-gold bg-gold'
                        : 'border-white/30 bg-transparent hover:border-zinc-200'
                    }`}
                  />
                );
              })}
            </div>
          ) : (
            <span />
          )}

          <div className="flex justify-end gap-2">
            {currentIndex < releaseNotes.length - 1 ? (
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((index) => Math.min(releaseNotes.length - 1, index + 1))
                }
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
                aria-label="Next changelog item"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md border border-gold/35 bg-gold/15 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/25"
            >
              Got it
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
