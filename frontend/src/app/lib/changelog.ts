export type ChangelogCategory = 'feature' | 'improvement' | 'fix' | 'documentation';

export type ChangelogEntry = {
  category: ChangelogCategory;
  title: string;
  summary: string;
  items?: string[];
};

export type ChangelogRelease = {
  id: string;
  version: string;
  date: string;
  title: string;
  entries: ChangelogEntry[];
  detailsAvailable?: boolean;
};

type ReleaseMetadata = Pick<ChangelogRelease, 'id' | 'version' | 'date'>;

const stableReleaseMetadataValues: Array<[version: string, date: string]> = [
  ['3.8.0', '2026-08-16'],
  ['3.7.0', '2026-08-14'],
  ['3.6.0', '2026-08-13'],
  ['3.5.2', '2026-07-17'],
  ['3.5.1', '2026-07-17'],
  ['3.5.0', '2026-07-10'],
  ['3.4.2', '2026-07-07'],
  ['3.4.1', '2026-06-29'],
  ['3.4.0', '2026-06-23'],
  ['3.3.1', '2026-06-18'],
  ['3.3.0', '2026-06-16'],
  ['3.2.0', '2026-06-14'],
  ['3.1.2', '2026-05-25'],
  ['3.1.1', '2026-05-24'],
  ['3.1.0', '2026-05-19'],
  ['3.0.1', '2026-05-18'],
  ['3.0.0', '2026-05-18'],
  ['2.6.0', '2026-05-13'],
  ['2.5.4', '2026-05-12'],
  ['2.5.3', '2026-05-12'],
  ['2.5.2', '2026-05-11'],
  ['2.5.1', '2026-05-11'],
  ['2.5.0', '2026-05-11'],
  ['2.4.0', '2026-05-09'],
  ['2.3.1', '2026-05-08'],
  ['2.3.0', '2026-05-07'],
  ['2.2.0', '2026-05-06'],
  ['2.1.0', '2026-05-06'],
  ['2.0.0', '2026-05-05'],
  ['1.8.0', '2026-05-04'],
  ['1.7.0', '2026-05-03'],
  ['1.6.0', '2026-05-01'],
  ['1.5.1', '2026-04-29'],
  ['1.5.0', '2026-04-29'],
  ['1.4.2', '2026-04-28'],
  ['1.4.1', '2026-04-28'],
  ['1.4.0', '2026-04-28'],
  ['1.3.1', '2026-04-23'],
  ['1.3.0', '2026-04-23'],
  ['1.2.4', '2026-04-22'],
  ['1.2.3', '2026-04-21'],
  ['1.2.2', '2026-04-21'],
  ['1.2.1', '2026-04-21'],
  ['1.2.0', '2026-04-21'],
  ['1.1.0', '2026-04-20'],
  ['1.0.2', '2026-04-20'],
  ['1.0.1', '2026-04-20'],
  ['1.0.0', '2026-04-20'],
  ['0.9.5', '2026-04-19'],
  ['0.9.4', '2026-04-19'],
  ['0.9.3', '2026-04-19'],
  ['0.9.2', '2026-04-19'],
  ['0.9.1', '2026-04-18'],
  ['0.9.0', '2026-04-18'],
  ['0.8.0', '2026-04-14'],
  ['0.7.1', '2026-04-14'],
  ['0.7.0', '2026-04-14'],
  ['0.6.1', '2026-04-12'],
  ['0.6.0', '2026-04-12'],
  ['0.5.0', '2026-04-11'],
  ['0.4.4', '2026-04-11'],
  ['0.4.3', '2026-04-11'],
  ['0.4.2', '2026-04-11'],
  ['0.4.1', '2026-04-11'],
  ['0.4.0', '2026-04-11'],
  ['0.3.0', '2026-04-11'],
  ['0.2.4', '2026-04-09'],
  ['0.2.3', '2026-04-09'],
  ['0.2.2', '2026-04-09'],
  ['0.2.1', '2026-04-09'],
  ['0.2.0', '2026-04-09'],
  ['0.1.0', '2026-04-09'],
];

const stableReleaseMetadata: ReleaseMetadata[] = stableReleaseMetadataValues.map(
  ([version, date]) => ({ id: `release-${version}`, version: `v${version}`, date })
);

const detailedReleases: ChangelogRelease[] = [
  {
    id: 'unreleased-2026-08-22',
    version: 'Unreleased',
    date: '2026-08-22',
    title: 'System Health becomes an optional dashboard widget',
    entries: [
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
    ],
  },
  {
    id: 'release-3.8.0',
    version: 'v3.8.0',
    date: '2026-08-16',
    title: 'A faster, more connected simulation workspace',
    entries: [
      {
        category: 'feature',
        title: 'Recent character search history',
        summary:
          'Find recently used characters from the header with filtering and one-click navigation.',
      },
      {
        category: 'feature',
        title: 'Pause, resume, and rerun simulations',
        summary:
          'Control active simulations from the result screen and rerun saved inputs in one click.',
      },
      {
        category: 'feature',
        title: 'Shared notification center',
        summary:
          'Review simulation results and app updates from persistent local notification history.',
      },
      {
        category: 'feature',
        title: 'Get Discord notifications for finished sims',
        summary:
          'Send rich Discord webhook notifications for completed simulations in desktop and Docker-hosted mode.',
        items: [
          'Configure the webhook under Settings > Integrations and choose notification categories.',
          'Notifications include DPS details, fight configuration, runtime information, and upgrade highlights.',
          'Webhook URLs are stored securely and can be tested, rotated, or removed.',
        ],
      },
      {
        category: 'feature',
        title: 'Use separate accounts by default',
        summary:
          'Battle.net users now have separate simulations, routes, profiles, history, and browser state in desktop and hosted mode.',
      },
      {
        category: 'improvement',
        title: 'Use WhyLowDPS comfortably on mobile',
        summary:
          'Navigation, action bars, dense results, settings, and dialogs now adapt to smaller touch screens, including phone safe-area support.',
      },
      {
        category: 'improvement',
        title: 'Run a private Docker-hosted instance',
        summary:
          'Use a prebuilt amd64 Docker deployment for private, single-instance hosting with persistent data, release pinning, health checks, and backups.',
      },
      {
        category: 'improvement',
        title: 'Share the desktop app over your trusted LAN',
        summary:
          'Pair phones on the same trusted private network through one-time QR/link pairing and manage paired devices from Settings.',
      },
      {
        category: 'improvement',
        title: 'Clearer running simulation status',
        summary:
          'Progress, profilesets, and statistics now use the available page width more effectively.',
      },
      {
        category: 'fix',
        title: 'More reliable desktop notifications',
        summary:
          'Completed simulation notifications are deduplicated and keep their in-app result action.',
      },
    ],
  },
  {
    id: 'release-3.7.0',
    version: 'v3.7.0',
    date: '2026-08-14',
    title: 'A clearer setup and recovery flow',
    entries: [
      {
        category: 'feature',
        title: 'Setup checklist and command palette',
        summary:
          'Get a guided setup status and direct access to common workflows and repair areas.',
      },
      {
        category: 'feature',
        title: 'Shared active-character context',
        summary:
          'Keep the active character consistent between the dashboard and simulation workspace.',
      },
      {
        category: 'improvement',
        title: 'Backup and restore safeguards',
        summary:
          'Export and restore versioned local simulation data while excluding credentials, tokens, caches, and runtime binaries.',
      },
      {
        category: 'fix',
        title: 'Reliable desktop file handoff',
        summary:
          'Desktop launches now accept SimC and text files through associations, drag-and-drop, and second-instance handoff.',
      },
      {
        category: 'fix',
        title: 'Clearer setup recovery',
        summary:
          'Setup status, repair areas, URL-addressable Settings sections, feedback semantics, and keyboard focus states are easier to find and understand.',
      },
    ],
  },
  {
    id: 'release-3.6.0',
    version: 'v3.6.0',
    date: '2026-08-13',
    title: 'Season-aware loot browsing',
    entries: [
      {
        category: 'feature',
        title: 'Season-aware Loot Browser',
        summary: 'Group loot by expansion, season, and the active dungeon rotation.',
      },
      {
        category: 'feature',
        title: 'Resizable Loot Browser instance panel',
        summary: 'Resize the instance panel with mouse or keyboard controls.',
      },
      {
        category: 'fix',
        title: 'More stable historical dungeon views',
        summary:
          'Active dungeons stay in the active group, source-expansion links remain available, and incomplete metadata uses trusted fallbacks.',
      },
    ],
  },
  {
    id: 'release-3.5.2',
    version: 'v3.5.2',
    date: '2026-07-17',
    title: 'Polish, governance, and a smoother desktop popup',
    entries: [
      {
        category: 'documentation',
        title: 'Repository governance documentation',
        summary:
          'Added the project license, contribution guide, security policy, code of conduct, and roadmap.',
      },
      {
        category: 'fix',
        title: 'A less disruptive What’s New popup',
        summary:
          'The in-app changelog no longer blocks Windows title-bar controls or window dragging.',
      },
      {
        category: 'improvement',
        title: 'Clearer raid-buff source badges',
        summary: 'Hover explanations now clarify Override, Manual, and Default sources.',
      },
    ],
  },
  {
    id: 'release-3.0.1',
    version: 'v3.0.1',
    date: '2026-05-18',
    title: 'Release packaging and community access',
    entries: [
      {
        category: 'improvement',
        title: 'Structured release notes and downloads',
        summary:
          'Release artifacts include a recommended download, SHA256 checksums, and explicit Windows, SmartScreen, and Battle.net credential notes.',
      },
      {
        category: 'feature',
        title: 'Discord invite and quick links',
        summary: 'A first-launch Discord invite and sidebar links make community access easier.',
      },
    ],
  },
];

const detailedByVersion = new Map(detailedReleases.map((release) => [release.version, release]));

export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  ...detailedReleases,
  ...stableReleaseMetadata
    .filter(({ version }) => !detailedByVersion.has(version))
    .map(({ id, version, date }) => ({
      id,
      version,
      date,
      title: `${version} release archive`,
      entries: [],
      detailsAvailable: false,
    })),
];

export const LATEST_CHANGELOG_RELEASE = CHANGELOG_RELEASES[0];

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
