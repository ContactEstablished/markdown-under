import katexCss from "katex/dist/katex.min.css?inline";
import tokensCss from "../../src/styles/tokens.css?inline";
import markdownCss from "../../src/styles/markdown.css?inline";
import viewerCss from "./viewer.css?inline";
import { Preview } from "../../src/ui/preview";
import type { TocEntry } from "../../src/render/markdown";
import { h, icon } from "../../src/ui/dom";
import { loadSettings, onSettingsChanged, resolveTheme, saveSettings, type ExtensionSettings, type ThemeChoice } from "./settings";

const POLL_MS = 1000;

/** Points bundled asset URLs (KaTeX fonts) at the extension, since the page itself is file:// or http(s). */
function rewriteAssetUrls(css: string): string {
  return css.replace(/url\((['"]?)[^)'"]*?(assets\/[^)'"]+)\1\)/g, (_m, q: string, path: string) => `url(${q}${chrome.runtime.getURL(path)}${q})`);
}

/** Re-reads this page's local file. The page itself can't read file:// URLs, so the background worker does. */
async function readCurrentFile(): Promise<string | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "read-file" })) as { text: string | null } | undefined;
    return res?.text ?? null;
  } catch {
    return null; // Extension reloaded or worker unavailable; try again next tick.
  }
}

function fileName(): string {
  const last = decodeURIComponent(location.pathname.split("/").pop() ?? "");
  return last || location.href;
}

class Viewer {
  private settings!: ExtensionSettings;
  private preview: Preview;
  private root: HTMLElement;
  private outline: HTMLElement;
  private raw: HTMLPreElement;
  private outlineItems = new Map<string, HTMLElement>();
  private themeButton: HTMLButtonElement;
  private rawButton: HTMLButtonElement;
  private text: string;
  private polling = false;

  constructor(text: string) {
    this.text = text;
    this.outline = h("nav", { class: "mu-outline-list" });
    this.raw = h("pre", { class: "mu-raw", hidden: true });
    const main = h("main", { class: "mu-main" });
    this.themeButton = this.button("monitor", "Theme", () => this.cycleTheme());
    this.rawButton = this.button("code", "Show source", () => this.toggleRaw());
    const toolbar = h("div", { class: "mu-toolbar" },
      this.button("sidebar", "Toggle outline", () => void saveSettings({ showOutline: !this.settings.showOutline })),
      this.themeButton,
      this.rawButton,
      this.button("printer", "Print or save as PDF", () => window.print()),
    );
    this.root = h("div", { class: "mu-root" },
      h("aside", { class: "mu-outline" }, h("div", { class: "mu-outline-title" }, "Outline"), this.outline),
      main,
      this.raw,
      toolbar,
    );
    this.preview = new Preview(main, {
      onLinkClick: (href, e) => this.followLink(href, e),
      onTaskToggle: () => {},
      onActiveHeading: (id) => this.setActiveHeading(id),
      onScroll: () => {},
    });
  }

  private button(name: string, title: string, onclick: () => void): HTMLButtonElement {
    return h("button", { class: "mu-btn", title, "aria-label": title, html: icon(name, 18), onclick: onclick as EventListener });
  }

  async mount(): Promise<void> {
    this.settings = await loadSettings();
    if (!this.settings.renderRemote && !location.protocol.startsWith("file")) return;

    const style = h("style", {}, [katexCss, tokensCss, markdownCss, viewerCss].map(rewriteAssetUrls).join("\n"));
    document.head.replaceChildren(
      h("meta", { charset: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      style,
    );
    document.body.replaceChildren(this.root);
    document.body.className = "mu-body";

    await this.applySettings();
    await this.render(true);
    if (location.hash) this.preview.scrollToId(decodeURIComponent(location.hash.slice(1)), false);

    onSettingsChanged((s) => {
      this.settings = s;
      void this.applySettings();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void this.applySettings());
    window.addEventListener("hashchange", () => this.preview.scrollToId(decodeURIComponent(location.hash.slice(1))));
    document.addEventListener("visibilitychange", () => this.updatePolling());
    // Print on white paper whatever the screen theme.
    window.addEventListener("beforeprint", () => (document.documentElement.dataset.theme = "light"));
    window.addEventListener("afterprint", () => void this.applySettings());
    this.updatePolling();
  }

  private async applySettings(): Promise<void> {
    const s = this.settings;
    const theme = resolveTheme(s.theme);
    document.documentElement.dataset.theme = theme;
    this.root.dataset.outline = String(s.showOutline);
    this.root.style.setProperty("--content-width", `${s.contentWidth}px`);
    this.preview.article.style.setProperty("--doc-font-size", `${s.fontSize}px`);
    this.preview.article.style.setProperty("--doc-font", s.fontFamily === "serif" ? "var(--font-serif)" : "var(--font-sans)");
    const themeIcon = { system: "monitor", light: "sun", dark: "moon" }[s.theme];
    this.themeButton.innerHTML = icon(themeIcon, 18);
    this.themeButton.title = `Theme: ${s.theme}`;
    this.updatePolling();
    await this.preview.setTheme(theme);
  }

  private cycleTheme(): void {
    const order: ThemeChoice[] = ["system", "light", "dark"];
    void saveSettings({ theme: order[(order.indexOf(this.settings.theme) + 1) % order.length] });
  }

  private toggleRaw(): void {
    const showRaw = this.raw.hidden;
    if (showRaw) this.raw.textContent = this.text;
    this.raw.hidden = !showRaw;
    this.root.classList.toggle("show-raw", showRaw);
    this.rawButton.innerHTML = icon(showRaw ? "eye" : "code", 18);
    this.rawButton.title = showRaw ? "Show rendered" : "Show source";
  }

  private async render(force = false): Promise<void> {
    const base = new URL(".", location.href).href;
    const result = await this.preview.render(this.text, base, force);
    if (!result) return;
    document.title = result.title ?? fileName();
    // Checkboxes can't be saved back from the browser, so show them read-only.
    for (const box of this.preview.article.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox")) box.disabled = true;
    this.buildOutline(result.toc);
    if (!this.raw.hidden) this.raw.textContent = this.text;
  }

  private buildOutline(toc: TocEntry[]): void {
    this.outlineItems.clear();
    const items = toc.map((entry) => {
      const item = h("a", { class: `mu-outline-item level-${entry.level}`, href: `#${entry.id}` }, entry.text);
      item.addEventListener("click", (e) => {
        e.preventDefault();
        history.replaceState(null, "", `#${entry.id}`);
        this.preview.scrollToId(entry.id);
      });
      this.outlineItems.set(entry.id, item);
      return item;
    });
    this.outline.replaceChildren(...(items.length ? items : [h("div", { class: "mu-outline-empty" }, "No headings")]));
  }

  private setActiveHeading(id: string | null): void {
    for (const [key, el] of this.outlineItems) el.classList.toggle("active", key === id);
    if (id) this.outlineItems.get(id)?.scrollIntoView({ block: "nearest" });
  }

  private followLink(href: string, e: MouseEvent): void {
    if (href.startsWith("#")) {
      const id = decodeURIComponent(href.slice(1));
      history.replaceState(null, "", href);
      this.preview.scrollToId(id);
      return;
    }
    const url = new URL(href, location.href).href;
    if (e.ctrlKey || e.metaKey || e.button === 1) window.open(url, "_blank");
    else location.href = url;
  }

  private updatePolling(): void {
    const want = this.settings.liveReload && location.protocol === "file:" && document.visibilityState === "visible";
    if (want && !this.polling) {
      this.polling = true;
      void this.poll();
    } else if (!want) {
      this.polling = false;
    }
  }

  private async poll(): Promise<void> {
    while (this.polling) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (!this.polling) break;
      const next = await readCurrentFile();
      if (next !== null && next !== this.text) {
        this.text = next;
        await this.render();
      }
    }
  }
}

export async function start(text: string): Promise<void> {
  await new Viewer(text).mount();
}
