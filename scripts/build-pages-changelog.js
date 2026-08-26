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
  return output.join('\n');
}

function buildChangelogPage(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const title = titleIndex >= 0 ? lines[titleIndex].replace(/^#\s+/, '').trim() : 'What\'s New History';
  const body = renderMarkdown(titleIndex >= 0 ? lines.slice(titleIndex + 1).join('\n') : markdown);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta content="width=device-width, initial-scale=1" name="viewport" />
  <meta content="#09090b" name="theme-color" />
  <meta content="The WhyLowDPS versioned release history." name="description" />
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
      <p class="eyebrow">Release archive</p>
      <h1>${escapeHtml(title)}</h1>
      <p>The latest update appears in the app&apos;s What&apos;s New popup. This page preserves the full versioned history.</p>
    </header>
    <article class="history-content">
${body}
    </article>
    <p class="history-source">Source: <a href="https://github.com/JosephLteif/simcraft/blob/master/docs/whats-new-history.md" rel="noopener noreferrer" target="_blank">docs/whats-new-history.md</a></p>
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
