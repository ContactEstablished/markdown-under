import type { SearchResult, TreeNode } from "../backend";
import type { TocEntry } from "../render/markdown";
import { basename, normalizeForCompare, relativeTo, samePath } from "../lib/paths";
import { debounce, escapeHtml, h, icon } from "./dom";

export type SidebarTab = "files" | "outline" | "search";

export interface SidebarCallbacks {
  onOpenFile(path: string): void;
  onOpenFolder(): void;
  onHeadingClick(entry: TocEntry): void;
  onSearch(query: string, caseSensitive: boolean): Promise<SearchResult | null>;
  onSearchHitClick(path: string, line: number, query: string): void;
  onTabChange(tab: SidebarTab): void;
  onCloseFolder(): void;
}

const EXPANDED_KEY = "markdown-under.expanded";

export class Sidebar {
  readonly element: HTMLElement;
  private tabs: Record<SidebarTab, HTMLButtonElement>;
  private panels: Record<SidebarTab, HTMLElement>;
  private treeEl: HTMLElement;
  private treeHeader: HTMLElement;
  private outlineEl: HTMLElement;
  private searchInput: HTMLInputElement;
  private caseToggle: HTMLButtonElement;
  private searchStatus: HTMLElement;
  private searchResults: HTMLElement;
  private caseSensitive = false;
  private tree: TreeNode | null = null;
  private currentFile: string | null = null;
  private expanded: Set<string>;
  private tocEntries: TocEntry[] = [];
  private searchSeq = 0;

  constructor(
    container: HTMLElement,
    private callbacks: SidebarCallbacks,
  ) {
    this.expanded = new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]") as string[]);
    const tab = (id: SidebarTab, label: string, iconName: string) =>
      h("button", {
        class: "sidebar-tab",
        role: "tab",
        "data-tab": id,
        title: label,
        html: `${icon(iconName, 14)}<span>${label}</span>`,
        onclick: () => this.showTab(id, true),
      });
    this.tabs = { files: tab("files", "Files", "folder"), outline: tab("outline", "Outline", "list"), search: tab("search", "Search", "search") };

    this.treeHeader = h("div", { class: "panel-header" });
    this.treeEl = h("div", { class: "tree", role: "tree" });
    this.outlineEl = h("nav", { class: "outline", "aria-label": "Document outline" });

    this.searchInput = h("input", { type: "search", class: "search-input", placeholder: "Search in folder…", spellcheck: "false" });
    this.caseToggle = h("button", {
      class: "icon-btn toggle",
      title: "Match case",
      "aria-pressed": "false",
      html: icon("caseSensitive"),
      onclick: () => {
        this.caseSensitive = !this.caseSensitive;
        this.caseToggle.setAttribute("aria-pressed", String(this.caseSensitive));
        void this.runSearch();
      },
    });
    this.searchStatus = h("div", { class: "search-status" });
    this.searchResults = h("div", { class: "search-results" });
    const debounced = debounce(() => void this.runSearch(), 250);
    this.searchInput.addEventListener("input", debounced);
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        debounced.cancel();
        void this.runSearch();
      }
    });

    this.panels = {
      files: h("div", { class: "sidebar-panel", role: "tabpanel" }, this.treeHeader, this.treeEl),
      outline: h("div", { class: "sidebar-panel", role: "tabpanel" }, this.outlineEl),
      search: h(
        "div",
        { class: "sidebar-panel", role: "tabpanel" },
        h("div", { class: "search-box" }, this.searchInput, this.caseToggle),
        this.searchStatus,
        this.searchResults,
      ),
    };

    this.element = h(
      "aside",
      { class: "sidebar" },
      h("div", { class: "sidebar-tabs", role: "tablist" }, ...Object.values(this.tabs)),
      ...Object.values(this.panels),
    );
    container.append(this.element);
    this.renderTree();
    this.renderOutline();
  }

  showTab(tab: SidebarTab, notify = false): void {
    for (const id of Object.keys(this.tabs) as SidebarTab[]) {
      this.tabs[id].classList.toggle("active", id === tab);
      this.tabs[id].setAttribute("aria-selected", String(id === tab));
      this.panels[id].hidden = id !== tab;
    }
    if (tab === "search") requestAnimationFrame(() => this.searchInput.focus());
    if (notify) this.callbacks.onTabChange(tab);
  }

  focusSearch(prefill?: string): void {
    this.showTab("search", true);
    if (prefill) this.searchInput.value = prefill;
    this.searchInput.select();
    if (prefill) void this.runSearch();
  }

  // ---- Files ----

  setTree(tree: TreeNode | null): void {
    this.tree = tree;
    if (tree) this.expanded.add(normalizeForCompare(tree.path));
    this.renderTree();
  }

  setCurrentFile(path: string | null): void {
    this.currentFile = path;
    if (path && this.tree) {
      // Expand ancestors so the open file is visible.
      const target = normalizeForCompare(path);
      const visit = (node: TreeNode): boolean => {
        if (!node.isDir) return normalizeForCompare(node.path) === target;
        const found = node.children.some(visit);
        if (found) this.expanded.add(normalizeForCompare(node.path));
        return found;
      };
      visit(this.tree);
    }
    this.renderTree();
    this.treeEl.querySelector(".tree-item.current")?.scrollIntoView({ block: "nearest" });
  }

  private renderTree(): void {
    if (!this.tree) {
      this.treeHeader.replaceChildren();
      this.treeEl.replaceChildren(
        h(
          "div",
          { class: "empty-panel" },
          h("p", {}, "No folder open."),
          h("button", { class: "btn", onclick: () => this.callbacks.onOpenFolder() }, "Open folder…"),
        ),
      );
      return;
    }
    this.treeHeader.replaceChildren(
      h("span", { class: "panel-title", title: this.tree.path }, this.tree.name),
      h("button", { class: "icon-btn", title: "Close folder", "aria-label": "Close folder", html: icon("x", 14), onclick: () => this.callbacks.onCloseFolder() }),
    );
    const list = h("ul", { class: "tree-list", role: "group" });
    for (const child of this.tree.children) list.append(this.renderNode(child, 0));
    if (this.tree.children.length === 0) list.append(h("li", { class: "empty-panel" }, "No Markdown files in this folder."));
    this.treeEl.replaceChildren(list);
  }

  private renderNode(node: TreeNode, depth: number): HTMLElement {
    const key = normalizeForCompare(node.path);
    const pad = `padding-left:${8 + depth * 14}px`;
    if (!node.isDir) {
      const current = samePath(node.path, this.currentFile);
      return h(
        "li",
        { role: "treeitem" },
        h("button", {
          class: `tree-item file${current ? " current" : ""}`,
          style: pad,
          title: node.path,
          html: `${icon("file", 14)}<span>${escapeHtml(node.name)}</span>`,
          onclick: () => this.callbacks.onOpenFile(node.path),
        }),
      );
    }
    const open = this.expanded.has(key);
    const li = h("li", { role: "treeitem", "aria-expanded": String(open) });
    li.append(
      h("button", {
        class: "tree-item dir",
        style: pad,
        title: node.path,
        html: `${icon(open ? "chevronDown" : "chevronRight", 14)}${icon(open ? "folderOpen" : "folder", 14)}<span>${escapeHtml(node.name)}</span>`,
        onclick: () => {
          if (open) this.expanded.delete(key);
          else this.expanded.add(key);
          localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded].slice(-500)));
          this.renderTree();
        },
      }),
    );
    if (open) {
      const ul = h("ul", { class: "tree-list", role: "group" });
      for (const child of node.children) ul.append(this.renderNode(child, depth + 1));
      li.append(ul);
    }
    return li;
  }

  // ---- Outline ----

  setOutline(entries: TocEntry[]): void {
    this.tocEntries = entries;
    this.renderOutline();
  }

  setActiveHeading(id: string | null): void {
    this.outlineEl.querySelectorAll(".outline-item.active").forEach((el) => el.classList.remove("active"));
    if (!id) return;
    const el = this.outlineEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "nearest" });
    }
  }

  private renderOutline(): void {
    if (this.tocEntries.length === 0) {
      this.outlineEl.replaceChildren(h("div", { class: "empty-panel" }, "No headings."));
      return;
    }
    const min = Math.min(...this.tocEntries.map((e) => e.level));
    this.outlineEl.replaceChildren(
      ...this.tocEntries.map((entry) =>
        h(
          "button",
          {
            class: `outline-item level-${entry.level}`,
            style: `padding-left:${10 + (entry.level - min) * 14}px`,
            "data-id": entry.id,
            title: entry.text,
            onclick: () => this.callbacks.onHeadingClick(entry),
          },
          entry.text || "(untitled)",
        ),
      ),
    );
  }

  // ---- Search ----

  async runSearch(): Promise<void> {
    const query = this.searchInput.value.trim();
    const seq = ++this.searchSeq;
    if (!query) {
      this.searchStatus.textContent = "";
      this.searchResults.replaceChildren();
      return;
    }
    this.searchStatus.textContent = "Searching…";
    const result = await this.callbacks.onSearch(query, this.caseSensitive);
    if (seq !== this.searchSeq) return;
    if (!result) {
      this.searchStatus.textContent = "Open a folder to search across files.";
      this.searchResults.replaceChildren();
      return;
    }
    const files = new Map<string, typeof result.hits>();
    for (const hit of result.hits) {
      const list = files.get(hit.path) ?? [];
      list.push(hit);
      files.set(hit.path, list);
    }
    const root = this.tree?.path ?? null;
    this.searchStatus.textContent =
      result.hits.length === 0
        ? `No results in ${result.filesSearched} files.`
        : `${result.hits.length}${result.truncated ? "+" : ""} results in ${files.size} files`;

    const highlighter = makeHighlighter(query, this.caseSensitive);
    const groups: HTMLElement[] = [];
    for (const [path, hits] of files) {
      const rel = relativeTo(path, root);
      groups.push(
        h(
          "div",
          { class: "search-group" },
          h("div", { class: "search-file", title: path, html: `${icon("file", 13)}<span>${escapeHtml(basename(path))}</span><small>${escapeHtml(rel === basename(path) ? "" : rel)}</small>` }),
          ...hits.map((hit) =>
            h("button", {
              class: "search-hit",
              title: `Line ${hit.line}`,
              html: `<span class="line-no">${hit.line}</span><span class="hit-text">${highlighter(hit.text)}</span>`,
              onclick: () => this.callbacks.onSearchHitClick(path, hit.line, query),
            }),
          ),
        ),
      );
    }
    this.searchResults.replaceChildren(...groups);
  }
}

function makeHighlighter(query: string, caseSensitive: boolean): (text: string) => string {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  return (text) => {
    let out = "";
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      out += escapeHtml(text.slice(last, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`;
      last = (m.index ?? 0) + m[0].length;
    }
    return out + escapeHtml(text.slice(last));
  };
}
