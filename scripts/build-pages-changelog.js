const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const INTERNAL_RELEASE_NOTE_TITLES = new Set([
  'Keep stable release notes synchronized',
  'Rework the release pipeline',
  'Keep source-mode release notes current',
]);

function parseStableReleaseHeading(line) {
  const match = line.match(/^##\s+(v\d+\.\d+\.\d+)(?:\s+—\s+(.+))?$/);
  return match ? { version: match[1], suffix: match[2]?.trim() || '' } : null;
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

function filterPublicReleaseSection(section) {
  const categories = [];
  let category = null;

  const finishCategory = () => {
    if (category) categories.push(category);
    category = null;
  };

  for (const line of section.lines.slice(1)) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      finishCategory();
      category = { heading: line, lines: [] };
      continue;
    }
    if (category) category.lines.push(line);
  }
  finishCategory();

  const publicCategories = categories
    .map((currentCategory) => {
      const entries = [];
      let entry = null;

      const finishEntry = () => {
        if (entry && !INTERNAL_RELEASE_NOTE_TITLES.has(entry.title)) entries.push(entry);
        entry = null;
      };

      for (const line of currentCategory.lines) {
        const heading = line.match(/^####\s+(.+)$/);
        if (heading) {
          finishEntry();
          entry = { title: heading[1].trim(), lines: [] };
          continue;
        }
        if (entry) entry.lines.push(line);
      }
      finishEntry();

      return entries.length > 0 ? { heading: currentCategory.heading, entries } : null;
    })
    .filter(Boolean);

  if (publicCategories.length === 0) return null;

  const lines = [section.lines[0]];
  for (const currentCategory of publicCategories) {
    lines.push('', currentCategory.heading);
    for (const entry of currentCategory.entries) {
      lines.push('', `#### ${entry.title}`, ...trimBlankLines(entry.lines));
    }
  }
  return lines.join('\n');
}

function getPublicReleaseSections(markdown) {
  const sections = [];
  let section = null;

  const finishSection = () => {
    if (!section) return;
    const publicMarkdown = filterPublicReleaseSection(section);
    if (publicMarkdown) sections.push({ ...section.release, markdown: publicMarkdown });
    section = null;
  };

  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const release = parseStableReleaseHeading(line);
    if (release) {
      finishSection();
      section = { release, lines: [line] };
      continue;
    }

    if (/^##\s+/.test(line)) {
      finishSection();
      continue;
    }

    if (section) section.lines.push(line);
  }
  finishSection();
  return sections;
}

function renderInline(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>'
    );
}

function renderTable(rows) {
  if (rows.length < 2) return '';

  const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const renderCell = (cell) =>
    /^v\d+\.\d+\.\d+$/.test(cell)
      ? `<a href="https://github.com/JosephLteif/simcraft/releases/tag/${cell}" rel="noopener noreferrer" target="_blank">${cell}</a>`
      : renderInline(cell);
  const header = cells(rows[0]);
  const body = rows.slice(2).map(cells);

  return [
    '<div class="history-table-wrap"><table>',
    '<thead><tr>',
    ...header.map((cell) => `<th scope="col">${renderCell(cell)}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...body.map(
      (row) => `<tr>${row.map((cell) => `<td>${renderCell(cell)}</td>`).join('')}</tr>`
    ),
    '</tbody></table></div>',
  ].join('');
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let list = [];
  let table = [];
  let releaseSectionOpen = false;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list.length > 0) {
      output.push(`<ul>${list.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  const flushTable = () => {
    if (table.length > 0) {
      output.push(renderTable(table));
      table = [];
    }
  };

  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flushBlocks();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      const content = heading[2].trim();
      const release = level === 2 ? parseStableReleaseHeading(`## ${content}`) : null;
      if (release) {
        if (releaseSectionOpen) output.push('</section>');
        const releaseId = `release-${release.version.replaceAll('.', '-')}`;
        output.push(
          `<section class="history-release" data-release-version="${escapeHtml(release.version)}">`
        );
        output.push(
          `<h2 id="${releaseId}"><a class="history-release-link" href="https://github.com/JosephLteif/simcraft/releases/tag/${release.version}" rel="noopener noreferrer" target="_blank">${escapeHtml(release.version)}</a>${release.suffix ? ` — ${renderInline(release.suffix)}` : ''}</h2>`
        );
        releaseSectionOpen = true;
        continue;
      }
      if (level === 2 && releaseSectionOpen) {
        output.push('</section>');
        releaseSectionOpen = false;
      }
      const id = level === 2 ? ` id="${escapeHtml(content.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}"` : '';
      output.push(`<h${level}${id}>${renderInline(content)}</h${level}>`);
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    const item = line.match(/^\s*-\s+(.+)$/);
    if (item) {
      flushParagraph();
      flushTable();
      list.push(item[1].trim());
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line.trim());
  }

  flushBlocks();
  if (releaseSectionOpen) output.push('</section>');
  return output.join('\n');
}

function buildChangelogPage(markdown) {
  const title = "What's New";
  const publicReleases = getPublicReleaseSections(markdown);
  const body = renderMarkdown(
    publicReleases.map((release) => release.markdown).join('\n\n') || 'No release notes are available yet.'
  );
  const releaseOptions = publicReleases
    .map((release) => `<option value="${escapeHtml(release.version)}">${escapeHtml(release.version)}</option>`)
    .join('\n');
  const releaseCount = publicReleases.length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta content="width=device-width, initial-scale=1" name="viewport" />
  <meta content="#09090b" name="theme-color" />
  <meta content="Browse WhyLowDPS release notes by version." name="description" />
  <title>${escapeHtml(title)} | WhyLowDPS</title>
  <link href="https://josephlteif.github.io/WhyLowDPS/changelog.html" rel="canonical" />
  <link href="./favicon.ico" rel="icon" sizes="any" />
  <link href="./styles.css" rel="stylesheet" />
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>

<header class="site-header">
  <a aria-label="WhyLowDPS home" class="brand" href="./">
    <img alt="" src="./assets/icon.png" />
    <span>WhyLowDPS</span>
  </a>
  <nav aria-label="Main navigation" class="nav">
    <a href="./">Home</a>
    <a href="./#ways-to-run">Ways to run</a>
    <a href="./changelog.html" aria-current="page">Changelog</a>
    <a href="https://github.com/JosephLteif/simcraft" rel="noopener noreferrer" target="_blank">GitHub</a>
  </nav>
  <a class="button button-primary header-download"
     href="https://github.com/JosephLteif/simcraft/releases/latest"
     rel="noopener noreferrer"
     target="_blank">Download</a>
</header>

<main id="main-content" class="history-page">
  <div class="container narrow-container">
    <header class="history-hero">
      <p class="eyebrow">Release notes</p>
      <h1>${escapeHtml(title)}</h1>
      <p>See what changed in each WhyLowDPS release. Choose a version below to jump directly to its notes.</p>
    </header>
    <div class="history-filter">
      <div class="history-filter-control">
        <label for="release-version">Browse a version</label>
        <select id="release-version" aria-describedby="release-filter-status">
          <option value="all">All releases</option>
${releaseOptions}
        </select>
      </div>
      <p id="release-filter-status" class="history-filter-status" aria-live="polite">Showing all ${releaseCount} releases.</p>
    </div>
    <article class="history-content">
${body}
    </article>
    <p class="history-source">Release tags and downloads are available on <a href="https://github.com/JosephLteif/simcraft/releases" rel="noopener noreferrer" target="_blank">GitHub Releases</a>.</p>
  </div>
</main>

<footer class="site-footer">
  <div class="container footer-layout">
    <div class="footer-brand">
      <a class="brand" href="./">
        <img alt="" src="./assets/icon.png" />
        <span>WhyLowDPS</span>
      </a>
      <p>World of Warcraft simulation and character optimization with context.</p>
    </div>
    <nav aria-label="Footer navigation" class="footer-links">
      <a href="./">Home</a>
      <a href="./changelog.html" aria-current="page">Changelog</a>
      <a href="https://github.com/JosephLteif/simcraft/releases" rel="noopener noreferrer" target="_blank">Releases</a>
      <a href="https://discord.com/invite/ZjxQv5kFxe" rel="noopener noreferrer" target="_blank">Discord</a>
    </nav>
  </div>
  <p class="container legal">Not affiliated with Blizzard Entertainment, SimulationCraft, or Raidbots.</p>
</footer>
<script>
(() => {
  const selector = document.getElementById('release-version');
  const status = document.getElementById('release-filter-status');
  const releases = Array.from(document.querySelectorAll('.history-release'));
  if (!selector || !status || releases.length === 0) return;

  const availableVersions = new Set(releases.map((release) => release.dataset.releaseVersion));
  const update = (requestedVersion, updateUrl) => {
    const version = requestedVersion && availableVersions.has(requestedVersion) ? requestedVersion : 'all';
    selector.value = version;
    releases.forEach((release) => {
      release.hidden = version !== 'all' && release.dataset.releaseVersion !== version;
    });
    status.textContent = version === 'all'
      ? 'Showing all ' + releases.length + ' releases.'
      : 'Showing ' + version + '.';

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (version === 'all') url.searchParams.delete('version');
      else url.searchParams.set('version', version);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  };

  selector.addEventListener('change', () => {
    update(selector.value, true);
    if (selector.value !== 'all') {
      const release = releases.find((candidate) => candidate.dataset.releaseVersion === selector.value);
      release?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  update(new URLSearchParams(window.location.search).get('version'), false);
})();
</script>
</body>
</html>
`;
}

function cli() {
  const repositoryRoot = path.resolve(__dirname, '..');
  const inputPath = process.argv[2] || path.join(repositoryRoot, 'docs', 'whats-new-history.md');
  const outputPath = process.argv[3] || path.join(repositoryRoot, 'docs', 'changelog.html');
  const markdown = fs.readFileSync(inputPath, 'utf8');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buildChangelogPage(markdown));
}

if (require.main === module) {
  cli();
}

module.exports = { buildChangelogPage, renderMarkdown };
