// src/data/wiki/markdown.js
//
// Hand-rolled Markdown → HTML for the in-game wiki.
//
// WHY NOT A LIBRARY: package.json carries exactly two runtime deps and one of
// them is a shader pack. Pulling marked/markdown-it in would triple the
// dependency surface to render 26 files we wrote ourselves. The subset below
// is everything docs/infra-wiki and docs/physics-wiki actually use — GFM pipe
// tables and fenced code above all, because "The Math" sections are nothing
// but tables and equation blocks.
//
// Output is escaped at the source: every character of author text goes through
// escapeHtml before any tag is emitted, and inline code spans are split out
// before emphasis runs so `**` inside a code span stays literal. Nothing here
// touches the DOM — the UI receives a string.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Stable heading anchor: lowercase, non-alphanumerics collapsed to dashes. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

/**
 * Resolve a link target. Relative `*.md` links become wiki navigation the UI
 * can intercept (`data-article` carries the article id); everything else is
 * passed through with a scheme check so a doc can never smuggle in
 * `javascript:`.
 */
function renderLink(text, href, resolveArticleId) {
  const inner = inlineFragment(text, resolveArticleId);
  const md = href.match(/^([\w-]+)\.md(#.*)?$/);
  if (md && resolveArticleId) {
    const id = resolveArticleId(md[1]);
    if (id) {
      return `<a class="wiki-link" data-article="${escapeHtml(id)}" `
        + `href="#wiki/${escapeHtml(id)}">${inner}</a>`;
    }
  }
  if (/^#/.test(href)) return `<a href="${escapeHtml(href)}">${inner}</a>`;
  if (/^https?:\/\//i.test(href)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  // Unknown scheme or a relative path we can't resolve — render the label only.
  return inner;
}

/** Emphasis/link pass over an ALREADY-ESCAPED, code-span-free fragment. */
function inlineFragment(escaped, resolveArticleId) {
  let out = escaped;
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, label, href) => renderLink(label, href, resolveArticleId));
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:)!?])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/**
 * Full inline pipeline: escape, then split on code spans so emphasis and link
 * syntax never run inside `code` (the docs are full of `a * b` and `x_0`).
 */
export function renderInline(text, resolveArticleId = null) {
  const escaped = escapeHtml(text);
  return escaped.split(/(`[^`]+`)/).map((part) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      return `<code>${part.slice(1, -1)}</code>`;
    }
    return inlineFragment(part, resolveArticleId);
  }).join('');
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

function isTableDelimiter(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

function alignments(delimiter) {
  return splitRow(delimiter).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/**
 * Render markdown to HTML.
 *
 * `resolveArticleId(slug)` maps a doc filename stem to a wiki article id, so
 * cross-links between docs survive as in-app navigation. Pass nothing and
 * `*.md` links degrade to plain text.
 *
 * Returns `{ html, headings }` — headings feed a table of contents.
 */
export function renderMarkdown(md, resolveArticleId = null) {
  const lines = String(md).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  const headings = [];
  let para = [];
  const listStack = []; // { tag, indent }

  const inline = (t) => renderInline(t, resolveArticleId);

  function flushPara() {
    if (para.length === 0) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  }
  function closeLists(toIndent = -1) {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      out.push(`</${listStack.pop().tag}>`);
    }
  }
  function flushBlock() {
    flushPara();
    closeLists();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code — consume to the closing fence (or EOF).
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushBlock();
      const lang = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.trim() === '') { flushBlock(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushBlock();
      const level = heading[1].length;
      const text = heading[2];
      const anchor = slugify(text);
      headings.push({ level, text, anchor });
      out.push(`<h${level} id="${escapeHtml(anchor)}">${inline(text)}</h${level}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushBlock();
      out.push('<hr>');
      continue;
    }

    // Pipe table: header row followed by an alignment row.
    if (line.includes('|') && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushBlock();
      const header = splitRow(line);
      const align = alignments(lines[i + 1]);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        body.push(splitRow(lines[i]));
        i++;
      }
      i--;
      const cell = (tag, text, n) => {
        const a = align[n] ? ` style="text-align:${align[n]}"` : '';
        return `<${tag}${a}>${inline(text)}</${tag}>`;
      };
      const head = header.map((c, n) => cell('th', c, n)).join('');
      const rows = body
        .map(r => `<tr>${r.map((c, n) => cell('td', c, n)).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushBlock();
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      i--;
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const bullet = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (bullet) {
      flushPara();
      const indent = bullet[1].length;
      const tag = /^\d/.test(bullet[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        listStack.push({ tag, indent });
        out.push(`<${tag}>`);
      } else if (top.tag !== tag) {
        out.push(`</${listStack.pop().tag}>`);
        listStack.push({ tag, indent });
        out.push(`<${tag}>`);
      }
      out.push(`<li>${inline(bullet[3])}</li>`);
      continue;
    }

    // An indented plain line while a list is open continues the last item.
    if (listStack.length && /^\s{2,}\S/.test(line)) {
      const last = out.length - 1;
      if (out[last].startsWith('<li>')) {
        out[last] = out[last].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
        continue;
      }
    }

    closeLists();
    para.push(line.trim());
  }

  flushBlock();
  return { html: out.join('\n'), headings };
}

/**
 * Plain-text projection of a markdown document, for search indexing and
 * snippets. Code fences, tables and markup all collapse to readable prose.
 */
export function markdownToPlain(md) {
  return String(md)
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?\s*:?-{2,}:?.*$/gm, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
