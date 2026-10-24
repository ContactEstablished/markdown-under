import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import abbr from "markdown-it-abbr";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import frontMatter from "markdown-it-front-matter";
import githubAlerts from "markdown-it-github-alerts";
import yaml from "js-yaml";
import { mathPlugin } from "./math";
import { highlightCode, normalizeLanguage } from "./highlight";

export interface TocEntry {
  level: number;
  text: string;
  id: string;
  /** 0-based source line of the heading. */
  line: number;
}

export interface RenderResult {
  html: string;
  toc: TocEntry[];
  /** Raw YAML front matter, if the document starts with a `---` block. */
  frontMatter: string | null;
  title: string | null;
}

interface RenderEnv {
  toc: TocEntry[];
  frontMatter: string | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub-style heading slugs: lowercase, punctuation removed, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function inlineText(token: Token | undefined): string {
  if (!token?.children) return token?.content ?? "";
  return token.children
    .filter((t) => t.type === "text" || t.type === "code_inline" || t.type === "emoji" || t.type === "math_inline")
    .map((t) => t.content)
    .join("");
}

/** Adds `data-line` to block tokens so the editor and preview can scroll in sync. */
function sourceLinePlugin(md: MarkdownIt): void {
  md.core.ruler.push("source_lines", (state: StateCore) => {
    for (const token of state.tokens) {
      if (token.map && token.nesting !== -1 && token.type !== "html_block") {
        token.attrSet("data-line", String(token.map[0]));
      }
    }
  });
}

/** Assigns unique ids to headings and records the table of contents. */
function headingPlugin(md: MarkdownIt): void {
  md.core.ruler.push("heading_ids", (state: StateCore) => {
    const env = state.env as RenderEnv;
    const seen = new Map<string, number>();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== "heading_open") continue;
      const text = inlineText(tokens[i + 1]);
      const base = slugify(text) || "section";
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      token.attrSet("id", id);
      env.toc?.push({ level: Number(token.tag.slice(1)), text, id, line: token.map?.[0] ?? 0 });
    }
  });
}

const TOC_MARKER = /^\s*(\[\[_TOC_\]\]|\[TOC\])\s*$/i;

/** Replaces a paragraph containing only `[[_TOC_]]` or `[TOC]` with an inline table of contents. */
function tocMarkerPlugin(md: MarkdownIt): void {
  md.core.ruler.push("toc_marker", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type === "paragraph_open" && tokens[i + 1].type === "inline" && TOC_MARKER.test(tokens[i + 1].content)) {
        const placeholder = new state.Token("toc_marker", "nav", 0);
        placeholder.block = true;
        placeholder.map = tokens[i].map;
        tokens.splice(i, 3, placeholder);
      }
    }
  });
  md.renderer.rules.toc_marker = (tokens, idx, _opts, env: RenderEnv) => {
    const entries = env.toc ?? [];
    if (entries.length === 0) return "";
    const min = Math.min(...entries.map((e) => e.level));
    let html = "";
    let depth = 0;
    for (const e of entries) {
      const target = e.level - min + 1;
      if (target > depth) {
        for (; depth < target; depth++) html += "<ul>";
      } else {
        for (; depth > target; depth--) html += "</li></ul>";
        html += "</li>";
      }
      html += `<li><a href="#${escapeHtml(e.id)}">${escapeHtml(e.text)}</a>`;
    }
    while (depth-- > 0) html += "</li></ul>";
    const line = tokens[idx].map?.[0];
    return `<nav class="toc-inline"${line === undefined ? "" : ` data-line="${line}"`}>${html}</nav>\n`;
  };
}

function renderFrontMatter(raw: string, line: number): string {
  let rows = "";
  try {
    const data = yaml.load(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const shown =
          value instanceof Date
            ? value.toISOString().slice(0, 10)
            : typeof value === "object" && value !== null
              ? Array.isArray(value) && value.every((v) => typeof v !== "object")
                ? value.join(", ")
                : JSON.stringify(value)
              : String(value);
        rows += `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(shown)}</td></tr>`;
      }
    }
  } catch {
    // Fall through to the raw view.
  }
  const body = rows ? `<table>${rows}</table>` : `<pre>${escapeHtml(raw)}</pre>`;
  return `<details class="front-matter" data-line="${line}"><summary>Front matter</summary>${body}</details>\n`;
}

function fenceRenderer(tokens: Token[], idx: number): string {
  const token = tokens[idx];
  const info = token.info ? md_unescape(token.info).trim() : "";
  const lang = normalizeLanguage(info);
  const line = token.map?.[0];
  const lineAttr = line === undefined ? "" : ` data-line="${line}"`;

  if (lang === "mermaid") {
    return `<div class="mermaid-block"${lineAttr}><pre class="mermaid-source">${escapeHtml(token.content)}</pre></div>\n`;
  }
  const highlighted = lang ? highlightCode(token.content, lang) : null;
  const pre = highlighted ?? `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(token.content)}</code></pre>`;
  const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
  return `<div class="code-block"${lineAttr}${langAttr}>${pre}</div>\n`;
}

function md_unescape(s: string): string {
  return s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

export function createMarkdown(): MarkdownIt {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false });
  md.use(frontMatter, () => {})
    .use(footnote)
    .use(taskLists, { enabled: true })
    .use(sub)
    .use(sup)
    .use(abbr)
    .use(mark)
    .use(ins)
    .use(deflist)
    .use(emoji)
    .use(githubAlerts)
    .use(mathPlugin)
    .use(sourceLinePlugin)
    .use(headingPlugin)
    .use(tocMarkerPlugin);

  md.renderer.rules.fence = fenceRenderer;
  md.renderer.rules.front_matter = (tokens, idx, _opts, env: RenderEnv) => {
    const token = tokens[idx];
    env.frontMatter = token.meta as string;
    return renderFrontMatter(token.meta as string, token.map?.[0] ?? 0);
  };
  return md;
}

/** Collects the distinct fence languages in a document (for preloading highlighters). */
export function fenceLanguages(md: MarkdownIt, src: string): string[] {
  const langs = new Set<string>();
  for (const token of md.parse(src, { toc: [], frontMatter: null })) {
    if (token.type === "fence" && token.info) langs.add(normalizeLanguage(token.info));
  }
  return [...langs].filter(Boolean);
}

export function renderMarkdown(md: MarkdownIt, src: string): RenderResult {
  const env: RenderEnv = { toc: [], frontMatter: null };
  const html = md.render(src, env);
  return { html, toc: env.toc, frontMatter: env.frontMatter, title: documentTitle(env) };
}

function documentTitle(env: RenderEnv): string | null {
  if (env.frontMatter) {
    try {
      const data = yaml.load(env.frontMatter) as Record<string, unknown> | null;
      if (data && typeof data.title === "string") return data.title;
    } catch {
      // Ignore malformed front matter.
    }
  }
  return env.toc.find((t) => t.level === 1)?.text ?? null;
}
