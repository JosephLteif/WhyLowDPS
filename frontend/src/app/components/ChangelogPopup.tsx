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
    category: 'feature',
    title: 'Optional Discord Rich Presence',
    body: [
      {
        type: 'paragraph',
        text: 'WhyLowDPS now shows a richer Discord activity card with a branded icon, your current workflow, and active character while Discord is running.',
      },
      {
        type: 'list',
        items: [
          'Discord can show Dashboard, Quick Sim, Top Gear, Drop Finder, History, or a simulation result with a session timer.',
          'Rich Presence is opt-in and can be enabled from Settings > Integrations without creating another application.',
          'Discord being closed never blocks simulations or other app workflows.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'A clearer first-run setup',
    body: [
      {
        type: 'paragraph',
        text: 'WhyLowDPS now shows the important setup steps together, so it is easier to see whether game data, Blizzard access, a character profile, and your first simulation are ready.',
      },
      {
        type: 'list',
        items: [
          'Refresh setup status directly from the dashboard.',
          'Jump straight to the settings or workflow that needs attention.',
        ],
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Rerun and compare results',
    body: [
      {
        type: 'paragraph',
        text: 'Simulation results now make it easier to rerun the exact imported input, while History can compare two selected records side by side.',
      },
    ],
  },
  {
    category: 'feature',
    title: 'Desktop simulation notifications',
    body: [
      {
        type: 'paragraph',
        text: 'When a desktop simulation finishes, the notification includes a one-click path back to its result.',
      },
    ],
  },
  {
    category: 'feature',
    title: 'Open SimC files from the desktop',
    body: [
      {
        type: 'paragraph',
        text: 'Open .simc or text files from Explorer, drag them onto the app, or launch a second copy to import the file into Quick Sim.',
      },
    ],
  },
  {
    category: 'feature',
    title: 'Local backup and restore',
    body: [
      {
        type: 'paragraph',
        text: 'Desktop users can export simulation history, saved profiles, routes, and safe UI preferences to a versioned ZIP archive, then validate and restore it later.',
      },
      {
        type: 'list',
        items: [
          'Credentials, tokens, cache files, and SimC binaries stay out of the archive.',
          'Restores preserve a recovery copy and apply on the next app restart.',
        ],
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Command palette and settings repairs',
    body: [
      {
        type: 'paragraph',
        text: 'Press Ctrl+K or Cmd+K to jump to common workflows, open What’s New, or go directly to a Settings area that needs attention.',
      },
      {
        type: 'list',
        items: [
          'Settings sections can be linked directly and include a quick-repair overview.',
          'Shared error feedback now announces failures more clearly to assistive technology.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Active character workspace',
    body: [
      {
        type: 'paragraph',
        text: 'Your selected character now follows you between the dashboard and simulation workspace, while existing tracked-character preferences continue to work.',
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Safer character context',
    body: [
      {
        type: 'paragraph',
        text: 'Importing a SimC profile can make that character the active workspace, helping defaults and follow-up actions stay attached to the right character.',
      },
    ],
  },
  {
    category: 'fix',
    title: 'Existing preferences are preserved',
    body: [
      {
        type: 'paragraph',
        text: 'Older main-character, tracked-character, and last-used profile choices are recognized automatically when the shared active-character state is first loaded.',
      },
    ],
  },
  {
    category: 'feature',
    title: 'More useful simulation context',
    body: [
      {
        type: 'paragraph',
        text: 'The simulation setup now shows the active character beside the imported profile, with a direct action to use the current import.',
      },
    ],
  },
  {
    category: 'fix',
    title: 'Status without guesswork',
    body: [
      {
        type: 'paragraph',
        text: 'The dashboard now gives you a concise view of what is ready and what to do next before starting a simulation.',
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
