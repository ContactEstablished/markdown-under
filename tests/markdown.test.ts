import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createMarkdown, renderMarkdown, slugify, fenceLanguages } from "../src/render/markdown";
import { ensureLanguages } from "../src/render/highlight";

const md = createMarkdown();
const render = (src: string) => renderMarkdown(md, src);

describe("slugify", () => {
  it("matches GitHub style", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Tables & Math ")).toBe("tables--math");
    expect(slugify("Ünïcode héading")).toBe("ünïcode-héading");
  });
});

describe("renderMarkdown", () => {
  it("collects a table of contents with unique ids", () => {
    const r = render("# Title\n\n## Intro\n\n## Intro\n\n### Deep");
    expect(r.toc.map((t) => t.id)).toEqual(["title", "intro", "intro-1", "deep"]);
    expect(r.toc.map((t) => t.line)).toEqual([0, 2, 4, 6]);
    expect(r.html).toContain('<h2 data-line="4" id="intro-1">');
    expect(r.title).toBe("Title");
  });

  it("adds data-line attributes to blocks", () => {
    const r = render("para\n\n- a\n- b\n\n> quote");
    expect(r.html).toContain('<p data-line="0">');
    expect(r.html).toContain('<ul data-line="2">');
    expect(r.html).toContain('<blockquote data-line="5">');
  });

  it("renders front matter as a table and uses its title", () => {
    const r = render("---\ntitle: FM Title\ntags: [a, b]\n---\n\n# Heading");
    expect(r.frontMatter).toContain("title: FM Title");
    expect(r.title).toBe("FM Title");
    expect(r.html).toContain('<details class="front-matter"');
    expect(r.html).toContain("<th>tags</th><td>a, b</td>");
  });

  it("renders inline and block math, but leaves prices alone", () => {
    const r = render("Euler $e^{i\\pi}$ costs $5 and $10.\n\n$$\nx^2\n$$");
    expect(r.html).toContain('class="katex"');
    expect(r.html).toContain("costs $5 and $10");
    expect(r.html).toContain('<div class="math-block" data-line="2">');
    expect(r.html).toContain("katex-display");
  });

  it("renders single-line display math", () => {
    expect(render("$$ a+b $$").html).toContain("katex-display");
  });

  it("emits mermaid blocks for client-side rendering", () => {
    const r = render("```mermaid\ngraph TD; A-->B\n```");
    expect(r.html).toContain('<div class="mermaid-block" data-line="0"><pre class="mermaid-source">graph TD; A--&gt;B');
  });

  it("supports GitHub alerts, task lists, footnotes and extras", () => {
    const r = render("> [!WARNING]\n> careful\n\n- [x] done\n- [ ] todo\n\nnote[^1] ==mark== H~2~O x^2^ :rocket:\n\n[^1]: foot");
    expect(r.html).toContain("markdown-alert-warning");
    expect(r.html).toContain('class="task-list-item-checkbox" checked=""');
    expect(r.html).toContain("footnote-ref");
    expect(r.html).toContain("<mark>mark</mark>");
    expect(r.html).toContain("<sub>2</sub>");
    expect(r.html).toContain("<sup>2</sup>");
    expect(r.html).toContain("🚀");
  });

  it("replaces a [[_TOC_]] marker with a nested list", () => {
    const r = render("# A\n\n[[_TOC_]]\n\n## B\n\n### C");
    expect(r.html).toContain('<nav class="toc-inline" data-line="2"><ul><li><a href="#a">A</a><ul><li><a href="#b">B</a><ul><li><a href="#c">C</a>');
  });

  it("closes nested TOC levels correctly when climbing back up", () => {
    const r = render("[TOC]\n\n## A\n\n### A1\n\n## B");
    expect(r.html).toContain('<ul><li><a href="#a">A</a><ul><li><a href="#a1">A1</a></li></ul></li><li><a href="#b">B</a></li></ul>');
  });

  it("falls back to escaped plain code for unknown languages", () => {
    const r = render("```nosuchlang\n<b>\n```");
    expect(r.html).toContain('<div class="code-block" data-line="0" data-lang="nosuchlang"><pre><code class="language-nosuchlang">&lt;b&gt;');
  });
});

describe("syntax highlighting", () => {
  beforeAll(async () => {
    await ensureLanguages(["ts", "rust", "py"]);
  });

  it("highlights loaded languages, including aliases, with dual themes", () => {
    const r = render("```ts\nconst x = 1;\n```\n\n```py\nx = 1\n```");
    expect(r.html).toContain('class="shiki shiki-themes github-light github-dark"');
    expect(r.html).toContain("--shiki-dark");
    expect((r.html.match(/class="shiki/g) ?? []).length).toBe(2);
  });

  it("lists fence languages", () => {
    expect(fenceLanguages(md, "```ts\n```\n\n```mermaid\n```\n\n```\n```")).toEqual(["ts", "mermaid"]);
  });
});

describe("showcase sample", () => {
  it("renders without throwing and covers every feature", async () => {
    const src = readFileSync(new URL("../samples/showcase.md", import.meta.url), "utf8");
    await ensureLanguages(fenceLanguages(md, src));
    const r = render(src);
    for (const needle of ["front-matter", "toc-inline", "katex", "mermaid-block", "shiki", "markdown-alert-note", "footnotes", "<table", "<dl", "<abbr", "<kbd>"]) {
      expect(r.html, needle).toContain(needle);
    }
  });
});
