/**
 * Public privacy policy — GET /privacy.
 *
 * Shopify's app listing requires a publicly reachable privacy policy URL, and
 * the Protected Customer Data questionnaire asks whether merchants are told what
 * data is processed. Both are answered by this page.
 *
 * THREE properties of this module are load-bearing; none is incidental.
 *
 * 1. UNAUTHENTICATED. Like `healthz.tsx`, this module must never import
 *    `app/shopify.server` — directly or transitively. The audience is an
 *    anonymous visitor and a Shopify reviewer, neither of whom has a session
 *    token, so any authentication turns the listing URL into a 4xx. Guarded by
 *    `tests/privacy-route.test.ts`, which walks the transitive import graph.
 *
 * 2. RESOURCE ROUTE — no default export. A route module WITH a default export
 *    renders through `app/root.tsx`, which injects a stylesheet `<link>` to
 *    cdn.shopify.com. This page must stand alone with no external network
 *    request, so it returns a complete HTML document straight from the loader
 *    and never enters the React render path. It also renders OUTSIDE the admin
 *    iframe, where App Bridge — and therefore every Polaris web component — does
 *    not exist. Do not add a default export.
 *
 * 3. SINGLE SOURCE OF TRUTH. The policy text lives in `PRIVACY.md` at the repo
 *    root and is inlined here at BUILD time via Vite's `?raw`, then rendered by
 *    the small Markdown subset renderer below. Hand-authoring the HTML would
 *    create a second copy of a legal document that drifts silently; reading the
 *    file at runtime would add a cwd assumption and turn a missing file into a
 *    500 on the very URL Shopify reviews. Build-time inlining has neither
 *    failure mode. Editing the policy means editing `PRIVACY.md` — nothing here.
 */
import privacyMarkdown from "../../PRIVACY.md?raw";

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Inline Markdown, applied AFTER a block's wrapped lines are joined — PRIVACY.md
 * contains bold spans that straddle a line break (section 1), which a per-line
 * pass would render as literal asterisks.
 *
 * Escaping runs first so policy text can never inject markup; the tags added
 * afterwards are the only markup in the output.
 */
const renderInline = (text: string): string =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isTableRow = (line: string) => line.trimStart().startsWith("|");
const isRule = (line: string) => /^-{3,}\s*$/.test(line.trim());
const isBullet = (line: string) => /^-\s+/.test(line.trimStart());
const isHeading = (line: string) => /^#{1,6}\s+/.test(line);

/**
 * Renders the Markdown subset PRIVACY.md actually uses: ATX headings, thematic
 * breaks, pipe tables, `- ` bullet lists, paragraphs, and inline bold/code.
 * Anything outside that subset degrades to a paragraph rather than failing, so a
 * future policy edit can never produce a blank page — but it also will not
 * render exotic syntax, so keep the policy to these constructs.
 */
function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Thematic break — checked before bullets so `---` is never read as a list.
    if (isRule(line)) {
      html.push("<hr />");
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      // Row 1 is the header, row 2 the `|---|` delimiter, the rest is the body.
      const [header, , ...body] = rows;
      const head = header
        .map((cell) => `<th scope="col">${renderInline(cell)}</th>`)
        .join("");
      const bodyHtml = body
        .map(
          (cells) =>
            `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
        )
        .join("");
      html.push(
        `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
      );
      continue;
    }

    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim() !== "") {
        const current = lines[i];
        if (isBullet(current)) {
          items.push(current.trimStart().replace(/^-\s+/, ""));
        } else if (/^\s+/.test(current) && items.length > 0) {
          // Continuation of a hard-wrapped list item.
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      html.push(
        `<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    // Paragraph: consume hard-wrapped lines until a blank line or a new block.
    //
    // PRIVACY.md is hard-wrapped at ~78 columns, so a line break inside a
    // paragraph is almost always the wrapper's, not the author's — joining with
    // a space is what CommonMark does and what a reader expects. The two
    // exceptions are the metadata header (Last updated / Application / Provider
    // / Contact) and the closing signature, where a run-on line would be plainly
    // wrong. Both are recognisable structurally: the author's deliberate breaks
    // land exactly where a line starts with `**` mid-paragraph, or where the
    // preceding line ends with `**`. Every wrapper break falls mid-sentence and
    // matches neither. `\n` is used as the hard-break marker because it survives
    // escaping, then becomes `<br />` once inline rendering is done.
    let paragraph = "";
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isRule(lines[i]) &&
      !isHeading(lines[i]) &&
      !isTableRow(lines[i]) &&
      !isBullet(lines[i])
    ) {
      const text = lines[i].trim();
      if (paragraph === "") {
        paragraph = text;
      } else {
        const deliberateBreak = text.startsWith("**") || /\*\*$/.test(paragraph);
        paragraph += (deliberateBreak ? "\n" : " ") + text;
      }
      i += 1;
    }
    html.push(`<p>${renderInline(paragraph).replace(/\n/g, "<br />")}</p>`);
  }

  return html.join("\n");
}

/**
 * Self-contained styling. Every font is a system font and every rule is inline:
 * this page must render correctly with zero external requests, because it is
 * served outside the admin and read by people who are, by definition, checking
 * what we load. `.table-scroll` keeps the four-column scope table usable on a
 * phone without a media query.
 */
const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem 4rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    font-size: 17px;
    line-height: 1.65;
    color: #1a1a1a;
    background: #ffffff;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.85rem; line-height: 1.25; margin: 0 0 1.5rem; }
  h2 { font-size: 1.3rem; line-height: 1.3; margin: 2.5rem 0 0.75rem; }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  p { margin: 0 0 1rem; }
  ul { margin: 0 0 1rem; padding-left: 1.25rem; }
  li { margin-bottom: 0.4rem; }
  hr { border: 0; border-top: 1px solid #e0e0e0; margin: 2.5rem 0; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: #f2f2f2;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    overflow-wrap: anywhere;
  }
  .table-scroll { overflow-x: auto; margin: 0 0 1.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
  th, td {
    border: 1px solid #d9d9d9;
    padding: 0.55rem 0.7rem;
    text-align: left;
    vertical-align: top;
  }
  th { background: #f7f7f7; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #16181a; }
    hr { border-top-color: #33383d; }
    code { background: #262a2e; }
    th, td { border-color: #33383d; }
    th { background: #202427; }
  }
`;

/** First ATX H1 in the policy — keeps the tab title single-sourced too. */
const documentTitle =
  /^#\s+(.*)$/m.exec(privacyMarkdown)?.[1].trim() ?? "Privacy Policy";

/**
 * Rendered once at module load. The Markdown is a build-time constant, so there
 * is nothing per-request to recompute.
 */
const PRIVACY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(documentTitle)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${renderMarkdown(privacyMarkdown)}
</main>
</body>
</html>
`;

export const loader = () =>
  new Response(PRIVACY_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The policy only changes on deploy, and this URL sits on an app listing
      // where it may be fetched by reviewers and crawlers. An hour of caching
      // costs nothing and still lets a corrected policy propagate the same day.
      "Cache-Control": "public, max-age=3600",
    },
  });
