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
