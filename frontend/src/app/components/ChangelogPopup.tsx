'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';
export const CHANGELOG_CONTENT_REVISION = 3;

const seenKey = `whylowdps_changelog_seen_${APP_VERSION}_${CHANGELOG_CONTENT_REVISION}`;

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
    title: 'Get Discord notifications for finished sims',
    body: [
      {
        type: 'paragraph',
        text: 'WhyLowDPS can now send rich Discord webhook notifications when your simulations finish in both the desktop app and Docker-hosted mode.',
      },
      {
        type: 'list',
        items: [
          'Configure the webhook under Settings > Integrations, then enable or disable notification categories such as Quick Sims, Top Gear, Drop Finder, matrices, and heatmaps.',
          'Notifications include DPS details, fight configuration, runtime information, upgrade highlights, and colors matched to the simulation type.',
          'Webhook URLs are stored securely and can be tested, rotated, or removed at any time.',
        ],
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Simpler and safer account controls',
    body: [
      {
        type: 'paragraph',
        text: 'Your BattleTag and account actions are now grouped under one avatar menu in the header.',
      },
      {
        type: 'list',
        items: [
          'Open the avatar menu to reach My Characters, Switch account, and Manage Users without crowding the header.',
          'User Management protects your own account from being disabled, signed out, demoted, or otherwise modified by admin actions.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Use separate accounts by default',
    body: [
      {
        type: 'paragraph',
        text: 'WhyLowDPS now keeps each Battle.net user’s simulations, routes, profiles, history, and browser state separate in both the desktop app and hosted mode.',
      },
      {
        type: 'list',
        items: [
          'Switch account signs out the current user and starts a fresh Battle.net login while normal sessions remain signed in across restarts.',
          'Hosted administrators can allow users by BattleTag, assign administrators, disable access, and revoke active sessions.',
          'Desktop Light mode remains available as a persistent device-local guest account.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Use hosted Light mode without signing in',
    body: [
      {
        type: 'paragraph',
        text: 'Private hosted instances can now provide Light mode for shared simulations, results, game-data catalogs, and raid browsing without requiring a Battle.net session.',
      },
      {
        type: 'list',
        items: [
          'Account-specific features remain protected and still require authentication.',
          'Raid expansion filters and public artwork fallbacks continue to work when synchronized image data is unavailable.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Install WhyLowDPS as an app',
    body: [
      {
        type: 'paragraph',
        text: 'The hosted web app can now be installed as a PWA, with an offline shell, update notifications, and install guidance shown when you open the app.',
      },
      {
        type: 'list',
        items: [
          'Use the native Install button when your browser provides it. Otherwise, follow the browser-menu or iOS Share > Add to Home Screen instructions.',
          'The prompt stays out of the Windows desktop app and installed PWAs, and calls out when trusted HTTPS is required for native installation.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Run a private Docker-hosted instance',
    body: [
      {
        type: 'paragraph',
        text: 'WhyLowDPS now has a prebuilt amd64 Docker deployment for private, single-instance hosting, with the web app, backend, and SimulationCraft runtime packaged together.',
      },
      {
        type: 'list',
        items: [
          'Run it directly on a private LAN address and port with the release Compose files; no reverse proxy is required for local access.',
          'Pin a release image for reproducible updates and rollbacks while the persistent data volume keeps synchronized data and simulations across upgrades.',
          'Use the included health check and backup scripts to verify the app, data sync, and runtime, or create a timestamped archive with a SHA-256 hash.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Share the desktop app over your trusted LAN',
    body: [
      {
        type: 'paragraph',
        text: "Desktop Settings can now share WhyLowDPS with phones on the same trusted private network through one-time QR/link pairing, using the PC's current account session.",
      },
      {
        type: 'list',
        items: [
          'Review paired devices, rename them, or remove access from Settings. Device names and last-seen times persist.',
          'Removing a device immediately ends its session and sends that browser to a scanner for a new pairing QR code.',
          'Active phone sessions are cleared when the desktop app restarts, and no internet exposure or port forwarding is supported.',
        ],
      },
    ],
  },
  {
    category: 'feature',
    title: 'Browse current and historical dungeons',
    body: [
      {
        type: 'paragraph',
        text: 'The Dungeons page now keeps the active season first while retaining available historical seasons and encounter lists for older content.',
      },
      {
        type: 'list',
        items: [
          'Dungeon cards show artwork with catalog and public fallbacks when the API image is missing or unavailable.',
          'Expansion and season selection remains populated when runtime data is incomplete, so known content does not disappear during refreshes.',
        ],
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Safer season rollovers',
    body: [
      {
        type: 'paragraph',
        text: 'Game-data and SimulationCraft runtime refreshes now adapt to season changes with staged validation and last-known-good fallback when a refresh is incomplete or degraded.',
      },
    ],
  },
  {
    category: 'improvement',
    title: 'Clearer setup guidance',
    body: [
      {
        type: 'paragraph',
        text: 'The public site and hosting guides now make the desktop, hosted, PWA, and trusted-LAN paths easier to choose, with layouts that remain readable on phones.',
      },
    ],
  },
  {
    category: 'fix',
    title: 'Dungeon routes stay on the dungeon flow',
    body: [
      {
        type: 'paragraph',
        text: 'Saved dungeon and Mythic+ route inputs are no longer mistaken for character imports when they also contain name-like lines.',
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
