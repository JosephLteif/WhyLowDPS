'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_VERSION, APP_VERSION_WITH_PREFIX } from '../lib/version';

export const CHANGELOG_OPEN_EVENT = 'whylowdps:open-changelog';
export const CHANGELOG_CONTENT_REVISION = 7;

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
    category: 'improvement',
    title: 'Use WhyLowDPS comfortably on mobile',
    body: [
      {
        type: 'paragraph',
        text: 'The app now adapts its navigation, controls, results, and dialogs to smaller touch screens so you can use WhyLowDPS comfortably from your phone.',
      },
      {
        type: 'list',
        items: [
          'A compact mobile header and slide-out navigation keep the most important actions within reach without taking over the screen.',
          'Quick Sim, Top Gear, Drop Finder, and Upgrade Compare keep their actions visible above the phone safe area, while dense results and settings reflow for narrow screens.',
          'Loot browsing, route selection, item optimization, and simulation results now use touch-friendly controls and full-height mobile dialogs where helpful.',
        ],
      },
    ],
  },
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
    title: 'Small improvements and fixes',
    body: [
      {
        type: 'paragraph',
        text: 'A round of smaller usability, reliability, and maintenance updates makes everyday workflows clearer across the app, desktop builds, and hosted deployments.',
      },
      {
        type: 'list',
        items: [
          'App search is now visible in the header with a Search icon, an App search label, and a Ctrl K hint, while remaining separate from Character search.',
          'Pasting SimC exports can save character profiles and warns when an export targets an older WoW patch; hosted Settings also expose SimC channel switching and clearer runtime/image update status.',
          'Account controls, account switching, dungeon browsing, route imports, season rollovers, and setup guidance are clearer and more resilient.',
          'PWA install dismissal, related-scenario refreshes, LAN QR/session handoff, and hosted Docker secret/image persistence are more reliable.',
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
          'Enable hosted Light mode for shared simulations, results, game-data catalogs, and raid browsing without a Battle.net session; account-specific features remain protected.',
          'Install the hosted web app as a PWA with an offline shell, update notifications, and browser or iOS installation guidance.',
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
];

const releaseNoteCategoryLabels: Record<ReleaseNoteCategory, string> = {
  feature: 'New features',
  fix: 'Bug fixes',
  improvement: 'Improvements',
};

const releaseNoteCategoryOrder: ReleaseNoteCategory[] = ['feature', 'improvement', 'fix'];

export default function ChangelogPopup() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(seenKey) === '1';
    if (!seen) setIsOpen(true);

    const open = () => {
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
        className="flex max-h-[min(800px,calc(100vh-var(--app-header-height)-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111218] shadow-2xl"
      >
        <header className="relative isolate z-10 shrink-0 overflow-hidden border-b border-white/10 bg-[#111218] px-6 py-8 shadow-[0_8px_20px_-18px_rgba(0,0,0,0.9)] sm:px-8 sm:py-9">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(212,168,67,0.18),transparent_58%)]"
          />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-gold/40 bg-gold/10 font-mono text-lg font-black tracking-tight text-gold shadow-[0_0_24px_rgba(212,168,67,0.14)]">
                v
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold/75">
                  What&apos;s new · WhyLowDPS release
                </p>
                <p className="mt-0.5 font-mono text-2xl font-black tracking-tight text-gold">
                  {APP_VERSION_WITH_PREFIX}
                </p>
                <p className="mt-2 text-sm text-zinc-400">
                  The latest improvements, features, and fixes.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.1] hover:text-white"
              aria-label="Close changelog"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <h2 id="changelog-title" className="sr-only">
            What&apos;s new
          </h2>
        </header>

        <article className="relative z-0 min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
          <div className="space-y-8">
            {releaseNoteCategoryOrder.map((category) => {
              const notes = releaseNotes.filter((note) => note.category === category);
              if (notes.length === 0) return null;

              return (
                <section key={category} aria-labelledby={`changelog-${category}`}>
                  <div className="mb-3 flex items-center gap-3">
                    <h3
                      id={`changelog-${category}`}
                      className="text-xs font-bold uppercase tracking-[0.18em] text-gold"
                    >
                      {releaseNoteCategoryLabels[category]}
                    </h3>
                    <div className="h-px flex-1 bg-gradient-to-r from-gold/25 to-transparent" />
                  </div>
                  <div className="space-y-3">
                    {notes.map((note) => (
                      <div
                        key={note.title}
                        className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 transition-colors hover:border-gold/25"
                      >
                        <h4 className="text-base font-semibold text-zinc-100">{note.title}</h4>
                        <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">
                          {note.body.map((block, blockIndex) =>
                            block.type === 'paragraph' ? (
                              <p key={`${note.title}-${blockIndex}`}>{block.text}</p>
                            ) : (
                              <ul
                                key={`${note.title}-${blockIndex}`}
                                className="list-disc space-y-2 pl-5 marker:text-gold"
                              >
                                {block.items.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </article>

        <div className="flex justify-end border-t border-white/10 p-5 sm:px-6">
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
