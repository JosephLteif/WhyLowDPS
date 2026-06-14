'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION_WITH_PREFIX, APP_VERSION } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}`;

const releaseNotes = [
  {
    title: 'Light mode',
    body:
      'Use the app without Blizzard API credentials. You can still launch sims from pasted SimC, while Battle.net character, vault, wishlist, and live character features stay disabled.',
  },
  {
    title: 'Desktop auth fixes',
    body:
      'Battle.net login now uses the local desktop backend correctly in debug mode and returns to the app without needing a manual refresh.',
  },
  {
    title: 'Cleaner fallback flow',
    body:
      'Credential setup now offers a clear path to continue in Light mode when Blizzard API access is unavailable.',
  },
];

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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
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
              What's new
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

        <div className="mt-5 space-y-3">
          {releaseNotes.map((note) => (
            <article key={note.title} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <h3 className="text-sm font-semibold text-zinc-100">{note.title}</h3>
              <p className="mt-1 text-sm leading-6 text-zinc-300">{note.body}</p>
            </article>
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
