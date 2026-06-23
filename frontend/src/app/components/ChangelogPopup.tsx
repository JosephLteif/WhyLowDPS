'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}`;

type ReleaseNoteCategory = 'feature' | 'fix' | 'improvement';

type ReleaseNote = {
  category: ReleaseNoteCategory;
  title: string;
  body: string;
};

const releaseNotes: ReleaseNote[] = [
  {
    category: 'improvement',
    title: 'Warcraft Logs boss guides',
    body: 'Current-season raid bosses now link directly to Warcraft Logs guides where one is available.',
  },
  {
    category: 'improvement',
    title: 'Simulation Activity time grouping',
    body: 'The dashboard activity chart now switches between daily, weekly, monthly, and yearly views.',
  },
  {
    category: 'improvement',
    title: 'Update and SimC download controls',
    body: 'App updates now let you choose a stable GitHub release, and SimC channel changes show version details before you start the download.',
  },
];

const releaseNoteCategoryOrder: ReleaseNoteCategory[] = ['feature', 'fix', 'improvement'];

const releaseNoteCategoryLabels: Record<ReleaseNoteCategory, string> = {
  feature: 'Features',
  fix: 'Fixes',
  improvement: 'Improvements',
};

const groupedReleaseNotes = releaseNoteCategoryOrder
  .map((category) => ({
    category,
    label: releaseNoteCategoryLabels[category],
    notes: releaseNotes.filter((note) => note.category === category),
  }))
  .filter((section) => section.notes.length > 0);

export default function ChangelogPopup() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(seenKey) === '1';
    if (!seen) setIsOpen(true);

    const open = () => setIsOpen(true);
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
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#111218] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
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

        <div className="mt-5 space-y-4">
          {groupedReleaseNotes.map((section) => (
            <div key={section.category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                {section.label}
              </h3>
              {section.notes.map((note) => (
                <article
                  key={note.title}
                  className="rounded-lg border border-white/10 bg-black/20 p-3"
                >
                  <h4 className="text-sm font-semibold text-zinc-100">{note.title}</h4>
                  <p className="mt-1 text-sm leading-6 text-zinc-300">{note.body}</p>
                </article>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border border-gold/35 bg-gold/15 px-4 py-2 text-sm font-semibold text-gold transition-colors hover:bg-gold/25"
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}
