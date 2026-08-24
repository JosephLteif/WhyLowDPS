export type ChangelogCategory = 'feature' | 'improvement' | 'fix' | 'documentation';

export type ChangelogEntry = {
  category: ChangelogCategory;
  title: string;
  summary: string;
  items?: string[];
};

export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  entries: ChangelogEntry[];
};

export const CHANGELOG_HISTORY_URL = 'https://josephlteif.github.io/WhyLowDPS/changelog.html';

export const LATEST_CHANGELOG_RELEASE: ChangelogRelease = {
  version: 'Unreleased',
  date: '2026-08-24',
  title: 'A more connected, guided simulation workspace',
  entries: [
    {
      category: 'feature',
      title: 'Explore the app with guided tours',
      summary:
        'Page-specific tours now walk you through the dashboard, simulation, upgrade, analysis, and loot workflows when you need a quick orientation.',
      items: [
        'Start the current page tour from the help button in the header.',
        'Tours can follow interactive choices and continue when the next part of a workflow opens.',
        'Replay a completed tour whenever you want a refresher.',
      ],
    },
    {
      category: 'feature',
      title: 'Make System Health an optional dashboard widget',
      summary:
        'System Health no longer takes up a fixed block above your dashboard. Add it only when you want a live readiness summary alongside your other dashboard widgets.',
      items: [
        'Open Customize, choose Add Widget, and select System Health when you want the compact readiness summary on the board.',
        'Drag, resize, or remove the widget like the other dashboard sections; your choice is saved locally.',
        'Open Settings > Health for detailed diagnostics and repair actions when something needs attention.',
      ],
    },
    {
      category: 'feature',
      title: 'Use separate hosted accounts and admin controls',
      summary:
        'Hosted Battle.net users now have isolated app data, while administrators can control access and Blizzard application credentials without restarting the deployment.',
      items: [
        'Manage the BattleTag allowlist, member and administrator roles, disabled users, and active sessions.',
        'Rotate, select, or remove hosted Blizzard credentials at runtime.',
        'Use hosted Light mode for shared simulations, results, game data, and raid browsing without a Battle.net session.',
      ],
    },
    {
      category: 'feature',
      title: 'Host WhyLowDPS privately and share it on your trusted LAN',
      summary:
        'Run a private Docker instance and pair phones on the same trusted network with persistent device management and restart-safe sessions.',
      items: [
        'Use the prebuilt amd64 Compose deployment with persistent data, health checks, backups, and versioned images.',
        'Create one-time QR or link pairings from desktop Settings for phone access.',
        'Track, rename, revoke, and re-pair devices without leaving stale sessions active.',
      ],
    },
    {
      category: 'feature',
      title: 'Get Discord notifications for finished simulations',
      summary:
        'Send rich Discord webhook notifications when desktop or Docker-hosted simulations finish.',
      items: [
        'Configure notification categories under Settings > Integrations.',
        'Include DPS details, fight configuration, runtime information, and upgrade highlights.',
        'Test, rotate, or remove webhook URLs while keeping them stored securely.',
      ],
    },
    {
      category: 'improvement',
      title: 'Use WhyLowDPS comfortably on mobile and as an installable PWA',
      summary:
        'Navigation, action bars, dense results, settings, and dialogs now adapt to narrow touch screens, with install and update guidance for browsers and iOS.',
    },
    {
      category: 'improvement',
      title: 'Choose and monitor the managed SimC runtime',
      summary:
        'Hosted and desktop runtime controls now expose weekly and nightly channels, available versions, update status, and safer runtime validation.',
      items: [
        'Select a SimC channel or a specific available runtime version from Settings > Updates.',
        'See the active channel and version in the admin sidebar when hosted runtime controls are available.',
        'Runtime updates validate the downloaded binary and retry incomplete manifest or release metadata before use.',
      ],
    },
    {
      category: 'improvement',
      title: 'Browse more reliable dungeon and raid content',
      summary:
        'Active seasons stay visible while historical encounters, catalog data, and artwork fallbacks remain available during incomplete refreshes.',
      items: [
        'Use hosted Light mode to browse raid expansions and encounters without a Battle.net session.',
        'Keep known dungeon selectors and content while season data refreshes or rolls over.',
        'Use catalog and public artwork fallbacks when an image endpoint has no source.',
      ],
    },
    {
      category: 'improvement',
      title: 'Find workflows and setup help faster',
      summary:
        'The app search control is now visible beside character search, while setup, profile, account, and hosting flows provide clearer guidance and recovery paths.',
      items: [
        'Open app search from the header or with Ctrl K without confusing it with character search.',
        'Keep pasted SimC character profiles and receive an older-patch warning when an export needs review.',
        'Use the public changelog history link to browse the full versioned release archive.',
      ],
    },
    {
      category: 'fix',
      title: 'Keep simulation inputs and sessions reliable',
      summary:
        'Routing, account switching, LAN revocation, and related-scenario refreshes now avoid stale state and misclassification.',
      items: [
        'Dungeon and Mythic+ route inputs are no longer treated as character imports because of name-like lines.',
        'Switching Battle.net accounts forces a fresh login, and removing a paired device invalidates its session immediately.',
        'Related-scenario refreshes no longer loop while content is loading.',
      ],
    },
    {
      category: 'fix',
      title: 'Recover more safely from hosted data and update failures',
      summary:
        'Game data, Docker secrets, runtime updates, and release metadata now preserve the last-known-good state when a refresh or publication step is incomplete.',
    },
  ],
};

export const CHANGELOG_CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  feature: 'New features',
  improvement: 'Improvements',
  fix: 'Bug fixes',
  documentation: 'Documentation',
};

export const CHANGELOG_CATEGORY_ORDER: ChangelogCategory[] = [
  'feature',
  'improvement',
  'fix',
  'documentation',
];
