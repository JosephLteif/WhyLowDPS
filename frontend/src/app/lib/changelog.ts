import generatedChangelogData from './changelog.generated.json';

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

const changelogData = generatedChangelogData as unknown as {
  contentRevision: string;
  releases: ChangelogRelease[];
};

export const CHANGELOG_CONTENT_REVISION = changelogData.contentRevision;
export const CHANGELOG_RELEASES = changelogData.releases;
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
