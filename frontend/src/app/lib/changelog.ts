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

type ParsedChangelogVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseChangelogVersion(value: string | null | undefined): ParsedChangelogVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareChangelogVersions(a: ParsedChangelogVersion, b: ParsedChangelogVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function isMajorChangelogRelease(version: string): boolean {
  const parsed = parseChangelogVersion(version);
  return parsed?.minor === 0 && parsed.patch === 0;
}

export function getChangelogReleasesToShow(
  releases: ChangelogRelease[],
  currentVersion: string
): ChangelogRelease[] {
  const stableReleases = releases.filter((release) => parseChangelogVersion(release.version));
  const current = parseChangelogVersion(currentVersion);
  const availableReleases = current
    ? stableReleases.filter((release) => {
        const parsed = parseChangelogVersion(release.version);
        return parsed && parsed.major === current.major
          ? compareChangelogVersions(parsed, current) <= 0
          : false;
      })
    : stableReleases;
  const stableToShow = current ? availableReleases : availableReleases.slice(0, 1);

  const unreleased = releases.filter(
    (release) => release.version.trim().toLowerCase() === 'unreleased' && release.entries.length > 0
  );
  const seenVersions = new Set<string>();
  return [...unreleased, ...stableToShow].filter((release) => {
    const key = release.version.trim().toLowerCase();
    if (seenVersions.has(key)) return false;
    seenVersions.add(key);
    return true;
  });
}

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
