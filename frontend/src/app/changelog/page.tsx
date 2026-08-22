'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, CalendarDays, History, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CHANGELOG_CATEGORY_LABELS,
  CHANGELOG_CATEGORY_ORDER,
  CHANGELOG_RELEASES,
  type ChangelogCategory,
} from '../lib/changelog';

type ChangelogFilter = 'all' | ChangelogCategory;

const formatDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

const githubReleaseUrl = (version: string) =>
  `https://github.com/JosephLteif/WhyLowDPS/releases/tag/${version}`;

export default function ChangelogPage() {
  const [filter, setFilter] = useState<ChangelogFilter>('all');
  const [selectedVersion, setSelectedVersion] = useState('all');

  const filteredReleases = useMemo(() => {
    const versionReleases =
      selectedVersion === 'all'
        ? CHANGELOG_RELEASES
        : CHANGELOG_RELEASES.filter((release) => release.id === selectedVersion);

    if (filter === 'all') return versionReleases;

    return versionReleases.filter((release) =>
      release.entries.some((entry) => entry.category === filter)
    );
  }, [filter, selectedVersion]);

  const selectVersion = (releaseId: string) => {
    setSelectedVersion(releaseId);
    if (releaseId !== 'all') {
      window.setTimeout(
        () => document.getElementById(releaseId)?.scrollIntoView({ block: 'start' }),
        0
      );
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
        <span className="font-mono text-xs text-zinc-500">WhyLowDPS release archive</span>
      </div>

      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          What&apos;s new
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          WhyLowDPS changelog
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-400 sm:text-lg">
          A versioned record of features, improvements, fixes, and documentation updates. The in-app
          popup highlights the latest update; this page keeps the full history available.
        </p>
      </header>

      <section
        className="mt-8 rounded-xl border border-border/60 bg-surface/40 p-4 sm:p-5"
        aria-label="Changelog filters"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Filter
          </span>
          <button
            type="button"
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              filter === 'all'
                ? 'border-gold/50 bg-gold/15 text-gold'
                : 'border-border bg-surface-2 text-zinc-400 hover:text-white'
            }`}
          >
            All updates
          </button>
          {CHANGELOG_CATEGORY_ORDER.map((category) => (
            <button
              type="button"
              key={category}
              aria-pressed={filter === category}
              onClick={() => setFilter(category)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                filter === category
                  ? 'border-gold/50 bg-gold/15 text-gold'
                  : 'border-border bg-surface-2 text-zinc-400 hover:text-white'
              }`}
            >
              {CHANGELOG_CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="changelog-version" className="text-sm text-zinc-400">
            Browse version
          </label>
          <select
            id="changelog-version"
            value={selectedVersion}
            onChange={(event) => selectVersion(event.target.value)}
            className="min-w-0 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-gold/50"
          >
            <option value="all">All versions</option>
            {CHANGELOG_RELEASES.map((release) => (
              <option key={release.id} value={release.id}>
                {release.version} · {formatDate(release.date)}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            {filteredReleases.length} {filteredReleases.length === 1 ? 'release' : 'releases'} shown
          </span>
        </div>
      </section>

      <div className="mt-8 space-y-6">
        {filteredReleases.map((release) => {
          const entriesByCategory = CHANGELOG_CATEGORY_ORDER.map((category) => ({
            category,
            entries: release.entries.filter((entry) => entry.category === category),
          })).filter(({ entries }) => entries.length > 0);

          return (
            <article
              key={release.id}
              id={release.id}
              className="scroll-mt-6 rounded-2xl border border-border/70 bg-surface/30 p-5 sm:p-7"
            >
              <header className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-gold/35 bg-gold/10 px-2 py-1 font-mono text-sm font-semibold text-gold">
                      {release.version}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-sm text-zinc-500">
                      <CalendarDays className="h-4 w-4" />
                      {formatDate(release.date)}
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-white sm:text-2xl">
                    {release.title}
                  </h2>
                </div>
                {release.version !== 'Unreleased' && (
                  <a
                    href={githubReleaseUrl(release.version)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-gold hover:underline"
                  >
                    Release tag
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                )}
              </header>

              {entriesByCategory.length > 0 ? (
                <div className="mt-6 space-y-7">
                  {entriesByCategory.map(({ category, entries }) => (
                    <section key={category} aria-labelledby={`${release.id}-${category}`}>
                      <div className="mb-3 flex items-center gap-3">
                        <Tag className="h-4 w-4 text-gold" />
                        <h3
                          id={`${release.id}-${category}`}
                          className="text-xs font-bold uppercase tracking-[0.18em] text-gold"
                        >
                          {CHANGELOG_CATEGORY_LABELS[category]}
                        </h3>
                        <div className="h-px flex-1 bg-gradient-to-r from-gold/25 to-transparent" />
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {entries.map((entry) => (
                          <div
                            key={entry.title}
                            className="rounded-xl border border-border/60 bg-surface-2/45 p-4"
                          >
                            <h4 className="font-semibold text-zinc-100">{entry.title}</h4>
                            <p className="mt-2 text-sm leading-6 text-zinc-400">{entry.summary}</p>
                            {entry.items && (
                              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-zinc-400 marker:text-gold">
                                {entry.items.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-border/50 bg-surface-2/35 p-4 text-sm text-zinc-400">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  <p>
                    This version is preserved in the release index. Detailed notes for older tags
                    are being migrated into the archive; use the release tag above for the original
                    repository context.
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {filteredReleases.length === 0 && (
        <div className="mt-8 rounded-xl border border-border/60 bg-surface/30 p-8 text-center text-sm text-zinc-400">
          No releases contain updates in this category yet.
        </div>
      )}

      <footer className="mt-10 border-t border-border/60 pt-5 text-sm text-zinc-500">
        The human-readable archive is maintained in{' '}
        <a
          href="https://github.com/JosephLteif/WhyLowDPS/blob/main/docs/whats-new-history.md"
          target="_blank"
          rel="noreferrer"
          className="text-gold hover:underline"
        >
          docs/whats-new-history.md
        </a>
        .
      </footer>
    </main>
  );
}
