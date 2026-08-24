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
  title: 'A clearer, more reliable simulation workspace',
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
      title: 'Browse the permanent changelog history',
      summary:
        'The full versioned release archive now lives on the generated GitHub Pages changelog, while the in-app popup stays focused on the latest update.',
      items: [
        'Open the archive from View changelog history in the What’s New popup.',
        'Stable releases remain linked to their original GitHub release tags.',
      ],
    },
    {
      category: 'improvement',
      title: 'Keep readiness and runtime updates reliable',
      summary:
        'Readiness checks, staged data refreshes, managed runtime updates, and release metadata now preserve useful status and the last-known-good state when an update is incomplete.',
      items: [
        'See the current SimC channel and version in the admin sidebar when runtime controls are available.',
        'Retry incomplete manifest or release metadata before activating a managed runtime update.',
        'Validate runtime binaries before they are used for simulations.',
      ],
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
