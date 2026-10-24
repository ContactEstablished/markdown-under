import type MarkdownIt from "markdown-it";
import { createMarkdown, fenceLanguages, renderMarkdown, type RenderResult } from "../render/markdown";
import { ensureLanguages } from "../render/highlight";
import { sanitizeHtml } from "../render/sanitize";
import { renderMermaid } from "../render/mermaid";
import { hasUrlScheme, resolvePath } from "../lib/paths";
import { h, icon } from "./dom";

export interface PreviewCallbacks {
  onLinkClick(href: string, event: MouseEvent): void;
  onTaskToggle(line: number, checked: boolean): void;
  onActiveHeading(id: string | null): void;
  onScroll(): void;
}

interface Block extends Element {
  __key?: string;
}

/** Key for comparing blocks across renders, ignoring line numbers that shift on edits. */
const blockKey = (html: string) => html.replace(/ data-line="\d+"/g, "");

/**
 * The rendered document. Re-renders patch only the top-level blocks that changed, so
 * live editing keeps images, diagrams and scroll position stable.
 */
export class Preview {
  readonly scroller: HTMLElement;
  readonly article: HTMLElement;
  private md: MarkdownIt = createMarkdown();
  private baseDir = "";
  private theme: "light" | "dark" = "light";
  private headings: HTMLElement[] = [];
  private activeHeading: string | null = null;
  private renderSeq = 0;
  private toAsset: (path: string) => string = (p) => p;

  constructor(
    container: HTMLElement,
    private callbacks: PreviewCallbacks,
  ) {
    this.article = h("article", { class: "markdown-body", tabindex: "-1" });
    this.scroller = h("div", { class: "preview-scroll" }, this.article);
    container.append(this.scroller);
    this.scroller.addEventListener("scroll", () => {
      this.updateActiveHeading();
      this.callbacks.onScroll();
    }, { passive: true });
    this.article.addEventListener("click", (e) => this.handleClick(e));
  }

  setAssetResolver(fn: (path: string) => string): void {
    this.toAsset = fn;
  }

  /** Switches diagram theme; resolves once every diagram has been redrawn. */
  async setTheme(theme: "light" | "dark"): Promise<void> {
    if (this.theme === theme) return;
    this.theme = theme;
    const blocks = Array.from(this.article.querySelectorAll<HTMLElement>(".mermaid-block"));
    await Promise.all(blocks.map((b) => this.renderDiagram(b)));
  }

  /** Renders `src`; `force` replaces every block (use when switching documents). */
  async render(src: string, baseDir: string, force = false): Promise<RenderResult | null> {
    const seq = ++this.renderSeq;
    await ensureLanguages(fenceLanguages(this.md, src));
    if (seq !== this.renderSeq) return null; // A newer render superseded this one.

    const replaceAll = force || baseDir !== this.baseDir;
    this.baseDir = baseDir;
    const result = renderMarkdown(this.md, src);
    const template = document.createElement("template");
    template.innerHTML = sanitizeHtml(result.html);
    this.patch(Array.from(template.content.children), replaceAll);
    this.headings = Array.from(this.article.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]"));
    this.updateActiveHeading();
    return result;
  }

  clear(): void {
    this.renderSeq++;
    this.article.replaceChildren();
    this.headings = [];
  }

  private patch(next: Element[], force: boolean): void {
    const current = Array.from(this.article.children) as Block[];
    const nextKeys = next.map((el) => blockKey(el.outerHTML));
    if (force) {
      this.article.replaceChildren(...next);
      next.forEach((el, i) => this.enhance(el as Block, nextKeys[i]));
      return;
    }

    let start = 0;
    while (start < current.length && start < next.length && current[start].__key === nextKeys[start]) start++;
    let endCur = current.length - 1;
    let endNext = next.length - 1;
    while (endCur >= start && endNext >= start && current[endCur].__key === nextKeys[endNext]) {
      endCur--;
      endNext--;
    }

    // Unchanged blocks stay, but their line numbers may have shifted.
    for (let i = 0; i < start; i++) syncLines(current[i], next[i]);
    for (let i = endCur + 1, j = endNext + 1; i < current.length; i++, j++) syncLines(current[i], next[j]);

    const anchor = current[endCur + 1] ?? null;
    for (let i = start; i <= endCur; i++) current[i].remove();
    for (let j = start; j <= endNext; j++) {
      const el = next[j] as Block;
      this.article.insertBefore(el, anchor);
      this.enhance(el, nextKeys[j]);
    }
  }

  private enhance(block: Block, key: string): void {
    block.__key = key;
    const roots = [block, ...Array.from(block.querySelectorAll("*"))];
    for (const el of roots) {
      if (el instanceof HTMLImageElement) this.fixImage(el);
      else if (el instanceof HTMLAnchorElement) this.decorateLink(el);
      else if (el.classList.contains("mermaid-block")) void this.renderDiagram(el as HTMLElement);
      else if (el.classList.contains("code-block")) this.addCopyButton(el as HTMLElement);
    }
  }

  private fixImage(img: HTMLImageElement): void {
    const src = img.getAttribute("src");
    if (!src || hasUrlScheme(src) || src.startsWith("//") || src.startsWith("#")) return;
    const absolute = resolvePath(this.baseDir, src.split(/[?#]/)[0]);
    img.dataset.localPath = absolute;
    img.src = this.toAsset(absolute);
    img.loading = "lazy";
  }

  private decorateLink(a: HTMLAnchorElement): void {
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      a.classList.add("external");
      a.title ||= href;
    }
  }

  private async renderDiagram(block: HTMLElement): Promise<void> {
    const source = block.querySelector(".mermaid-source")?.textContent ?? block.dataset.source ?? "";
    block.dataset.source = source;
    try {
      const svg = await renderMermaid(source, this.theme);
      block.innerHTML = svg;
      block.classList.remove("mermaid-error");
    } catch (err) {
      block.classList.add("mermaid-error");
      block.replaceChildren(
        h("div", { class: "mermaid-error-title" }, "Diagram error"),
        h("pre", {}, err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private addCopyButton(block: HTMLElement): void {
    const button = h("button", { class: "copy-code", title: "Copy code", "aria-label": "Copy code", html: icon("copy", 14) });
    button.addEventListener("click", async () => {
      const code = block.querySelector("pre")?.textContent ?? "";
      await navigator.clipboard.writeText(code);
      button.innerHTML = icon("check", 14);
      setTimeout(() => (button.innerHTML = icon("copy", 14)), 1200);
    });
    if (block.dataset.lang) block.prepend(h("span", { class: "code-lang" }, block.dataset.lang));
    block.append(button);
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains("task-list-item-checkbox")) {
      const line = target.closest("[data-line]")?.getAttribute("data-line");
      if (line !== null && line !== undefined) this.callbacks.onTaskToggle(Number(line), target.checked);
      return;
    }
    const link = target.closest("a");
    if (link && this.article.contains(link)) {
      const href = link.getAttribute("href");
      if (href) {
        e.preventDefault();
        this.callbacks.onLinkClick(href, e);
      }
    }
  }

  // ---- Navigation and scroll sync ----

  scrollToId(id: string, smooth = true): boolean {
    const el = this.article.querySelector(`[id="${CSS.escape(id)}"]`) ?? this.article.querySelector(`[name="${CSS.escape(id)}"]`);
    if (!el) return false;
    const top = el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top + this.scroller.scrollTop - 12;
    this.scroller.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
    return true;
  }

  /** Scrolls so source line `line` (0-based, may be fractional) is at the top. */
  scrollToLine(line: number): void {
    const top = this.offsetForLine(line);
    if (top !== null) this.scroller.scrollTop = top;
  }

  /** Briefly highlights the block for a source line (used by search results). */
  flashLine(line: number): void {
    const el = this.blockForLine(line);
    if (!el) return;
    el.classList.remove("flash");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("flash");
  }

  /** The (fractional) source line at the top of the viewport. */
  topLine(): number {
    const blocks = this.lineBlocks();
    if (blocks.length === 0) return 0;
    const viewTop = this.scroller.getBoundingClientRect().top;
    let prev: { line: number; top: number } | null = null;
    for (const el of blocks) {
      const top = el.getBoundingClientRect().top - viewTop;
      const line = Number(el.getAttribute("data-line"));
      if (top > 0) {
        if (!prev) return line;
        const span = top - prev.top;
        const frac = span > 0 ? (0 - prev.top) / span : 0;
        return prev.line + (line - prev.line) * Math.min(Math.max(frac, 0), 1);
      }
      prev = { line, top };
    }
    return prev?.line ?? 0;
  }

  private lineBlocks(): Element[] {
    return Array.from(this.article.querySelectorAll("[data-line]")).filter((el) => (el as HTMLElement).offsetParent !== null);
  }

  private blockForLine(line: number): Element | null {
    let best: Element | null = null;
    for (const el of this.lineBlocks()) {
      if (Number(el.getAttribute("data-line")) <= line) best = el;
      else break;
    }
    return best;
  }

  private offsetForLine(line: number): number | null {
    const blocks = this.lineBlocks();
    if (blocks.length === 0) return null;
    const base = this.scroller.getBoundingClientRect().top - this.scroller.scrollTop;
    let prev: Element | null = null;
    let next: Element | null = null;
    for (const el of blocks) {
      if (Number(el.getAttribute("data-line")) <= line) prev = el;
      else {
        next = el;
        break;
      }
    }
    if (!prev) return 0;
    const prevLine = Number(prev.getAttribute("data-line"));
    const prevTop = prev.getBoundingClientRect().top - base;
    if (!next) return prevTop + (line - prevLine) * 4;
    const nextLine = Number(next.getAttribute("data-line"));
    const nextTop = next.getBoundingClientRect().top - base;
    const frac = nextLine > prevLine ? (line - prevLine) / (nextLine - prevLine) : 0;
    return prevTop + (nextTop - prevTop) * frac;
  }

  private updateActiveHeading(): void {
    const threshold = this.scroller.getBoundingClientRect().top + 80;
    let active: string | null = null;
    for (const hEl of this.headings) {
      if (hEl.getBoundingClientRect().top <= threshold) active = hEl.id;
      else break;
    }
    active ??= this.headings[0]?.id ?? null;
    if (active !== this.activeHeading) {
      this.activeHeading = active;
      this.callbacks.onActiveHeading(active);
    }
  }
}

function syncLines(current: Element, next: Element): void {
  const a = [current, ...Array.from(current.querySelectorAll("[data-line]"))].filter((el) => el.hasAttribute("data-line"));
  const b = [next, ...Array.from(next.querySelectorAll("[data-line]"))].filter((el) => el.hasAttribute("data-line"));
  if (a.length !== b.length) return;
  a.forEach((el, i) => {
    const line = b[i].getAttribute("data-line");
    if (line !== null && el.getAttribute("data-line") !== line) el.setAttribute("data-line", line);
  });
}
