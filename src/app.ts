import type { Backend, TreeNode } from "./backend";
import { SettingsStore, getRecent, pushRecent, removeRecent, loadJson, saveJson, type Settings, type ViewMode } from "./settings";
import { basename, dirname, hasUrlScheme, isInside, isMarkdownPath, relativeTo, resolvePath, samePath, splitHash, stripExtension } from "./lib/paths";
import { countWords, toggleTaskAt } from "./lib/text";
import { Preview } from "./ui/preview";
import { Editor } from "./ui/editor";
import { Sidebar, type SidebarTab } from "./ui/sidebar";
import { FindBar } from "./ui/findbar";
import { SettingsDialog } from "./ui/settingsDialog";
import { buildStandaloneHtml } from "./ui/export";
import { debounce, h, icon, iconButton } from "./ui/dom";
import { toast, errorMessage } from "./ui/toast";
import appIcon from "../app-icon.svg";

interface Doc {
  /** null for an unsaved new document. */
  path: string | null;
  /** Last content known to be on disk. */
  saved: string;
  /** Current buffer. */
  text: string;
}

interface HistoryEntry {
  path: string;
  line: number;
}

interface OpenOptions {
  hash?: string;
  line?: number;
  /** 1-based line to flash/highlight after opening (search results). */
  revealLine?: number;
  findQuery?: string;
  pushHistory?: boolean;
}

const SESSION_KEY = "markdown-under.session";
const MODES: ViewMode[] = ["view", "split", "edit"];

export class App {
  private settings = new SettingsStore();
  private root: HTMLElement;
  private preview!: Preview;
  private editor!: Editor;
  private sidebar!: Sidebar;
  private findbar!: FindBar;
  private settingsDialog!: SettingsDialog;

  private titleName!: HTMLElement;
  private titlePath!: HTMLElement;
  private dirtyDot!: HTMLElement;
  private banner!: HTMLElement;
  private welcome!: HTMLElement;
  private modeButtons = new Map<ViewMode, HTMLButtonElement>();
  private backBtn!: HTMLButtonElement;
  private forwardBtn!: HTMLButtonElement;
  private status: Record<"path" | "words" | "cursor" | "state", HTMLElement> = {} as never;
  private customThemeStyle = h("style", { id: "custom-theme" });

  private doc: Doc | null = null;
  private folder: string | null = null;
  private back: HistoryEntry[] = [];
  private forward: HistoryEntry[] = [];
  private theme: "light" | "dark" = "light";
  private customCss = "";
  private syncSource: "editor" | "preview" | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private conflictDisk: string | null = null;

  private renderSoon = debounce(() => void this.renderDoc(), 120);
  private autoSaveSoon = debounce(() => {
    if (this.doc?.path && this.isDirty()) void this.save();
  }, 1000);
  private refreshTreeSoon = debounce(() => void this.refreshTree(), 400);
  private handleFileChangeSoon = debounce(() => void this.handleExternalChange(), 120);

  constructor(
    private backend: Backend,
    mount: HTMLElement,
  ) {
    this.root = mount;
    document.head.append(this.customThemeStyle);
    this.build();
    this.applySettings(this.settings.get(), Object.keys(this.settings.get()) as (keyof Settings)[]);
    this.settings.subscribe((s, changed) => this.applySettings(s, changed));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    this.bindShortcuts();
    this.bindBackend();
    this.updateChrome();
  }

  // ======================================================================
  // Layout
  // ======================================================================

  private build(): void {
    const s = this.settings.get();
    this.root.className = "app";

    // Toolbar
    this.backBtn = iconButton("arrowLeft", "Back (Alt+Left)", () => void this.goBack());
    this.forwardBtn = iconButton("arrowRight", "Forward (Alt+Right)", () => void this.goForward());
    this.titleName = h("span", { class: "doc-name" }, "Markdown Under");
    this.titlePath = h("span", { class: "doc-path" });
    this.dirtyDot = h("span", { class: "dirty-dot", title: "Unsaved changes", hidden: true });

    const modeGroup = h("div", { class: "segmented", role: "group", "aria-label": "View mode" });
    const modeDefs: [ViewMode, string, string, string][] = [
      ["view", "eye", "Read", "Read only (Ctrl+1)"],
      ["split", "columns", "Split", "Editor and preview (Ctrl+2, or Ctrl+E to toggle)"],
      ["edit", "pencil", "Edit", "Editor only (Ctrl+3)"],
    ];
    for (const [mode, iconName, label, title] of modeDefs) {
      const btn = h("button", { title, "aria-pressed": "false", html: `${icon(iconName, 14)}<span>${label}</span>`, onclick: () => this.setMode(mode) });
      this.modeButtons.set(mode, btn);
      modeGroup.append(btn);
    }

    const exportMenu = this.buildMenu("download", "Export", [
      ["printer", "Print / Save as PDF…", "Ctrl+P", () => void this.print()],
      ["code", "Export as HTML…", "Ctrl+Shift+E", () => void this.exportHtml()],
      ["copy", "Copy rendered HTML", "", () => void this.copyHtml()],
    ]);
    const fileMenu = this.buildMenu("file", "File", [
      ["plus", "New file", "Ctrl+N", () => void this.newFile()],
      ["file", "Open file…", "Ctrl+O", () => void this.pickAndOpenFile()],
      ["folder", "Open folder…", "Ctrl+Shift+O", () => void this.pickAndOpenFolder()],
      null,
      ["save", "Save", "Ctrl+S", () => void this.save()],
      ["save", "Save as…", "Ctrl+Shift+S", () => void this.saveAs()],
      ["refresh", "Reload from disk", "F5", () => void this.reloadFromDisk()],
      null,
      ["external", "Show in Explorer", "", () => this.doc?.path && void this.backend.revealPath(this.doc.path)],
    ]);

    const toolbar = h(
      "header",
      { class: "toolbar" },
      h(
        "div",
        { class: "toolbar-group" },
        iconButton("sidebar", "Toggle sidebar (Ctrl+\\)", () => this.settings.update({ sidebarVisible: !this.settings.get().sidebarVisible })),
        this.backBtn,
        this.forwardBtn,
        h("span", { class: "toolbar-sep" }),
        fileMenu,
        iconButton("save", "Save (Ctrl+S)", () => void this.save()),
      ),
      h("div", { class: "toolbar-title" }, this.dirtyDot, this.titleName, this.titlePath),
      h(
        "div",
        { class: "toolbar-group" },
        modeGroup,
        h("span", { class: "toolbar-sep" }),
        iconButton("search", "Find in document (Ctrl+F)", () => this.openFind()),
        iconButton("sun", "Toggle light/dark (Ctrl+Shift+L)", () => this.toggleTheme(), "theme-btn"),
        exportMenu,
        iconButton("settings", "Settings (Ctrl+,)", () => void this.settingsDialog.open()),
      ),
    );

    this.banner = h("div", { class: "banner", hidden: true, role: "alert" });

    // Workspace
    const workspace = h("main", { class: "workspace" });
    this.sidebar = new Sidebar(workspace, {
      onOpenFile: (p) => void this.openFile(p),
      onOpenFolder: () => void this.pickAndOpenFolder(),
      onCloseFolder: () => this.closeFolder(),
      onHeadingClick: (entry) => {
        if (this.settings.get().mode === "edit") this.editor.revealLine(entry.line + 1);
        else this.preview.scrollToId(entry.id);
      },
      onSearch: async (q, cs) => (this.folder ? this.backend.search(this.folder, q, cs) : null),
      onSearchHitClick: (p, line, q) => void this.openFile(p, { revealLine: line, findQuery: q }),
      onTabChange: (tab: SidebarTab) => this.settings.update({ sidebarTab: tab }),
    });
    this.sidebar.showTab(s.sidebarTab);
    const sidebarResizer = h("div", { class: "resizer sidebar-resizer", title: "Drag to resize" });
    workspace.append(sidebarResizer);

    const editorPane = h("section", { class: "pane editor-pane", "aria-label": "Editor" });
    const splitResizer = h("div", { class: "resizer split-resizer", title: "Drag to resize" });
    const previewPane = h("section", { class: "pane preview-pane", "aria-label": "Preview" });
    workspace.append(h("div", { class: "panes" }, editorPane, splitResizer, previewPane));

    this.editor = new Editor(editorPane, {
      onChange: (text) => this.onEditorChange(text),
      onScroll: () => this.syncFrom("editor"),
      onCursor: (line, col) => (this.status.cursor.textContent = `Ln ${line}, Col ${col}`),
      onSave: () => void this.save(),
    });
    this.preview = new Preview(previewPane, {
      onLinkClick: (href) => void this.followLink(href),
      onTaskToggle: (line, checked) => void this.toggleTask(line, checked),
      onActiveHeading: (id) => this.sidebar.setActiveHeading(id),
      onScroll: () => this.syncFrom("preview"),
    });
    this.preview.setAssetResolver((p) => this.backend.assetUrl(p));
    this.findbar = new FindBar(previewPane, this.preview.article, this.preview.scroller);
    this.welcome = h("div", { class: "welcome" });
    previewPane.append(this.welcome);

    // Status bar
    this.status = {
      path: h("span", {}),
      words: h("span", {}),
      cursor: h("span", {}),
      state: h("span", {}),
    };
    const statusbar = h("footer", { class: "statusbar" }, this.status.path, h("span", { class: "spacer" }), this.status.words, this.status.cursor, this.status.state);

    this.root.append(toolbar, this.banner, workspace, statusbar);

    this.settingsDialog = new SettingsDialog({
      store: this.settings,
      listThemes: () => this.backend.listThemes(),
      openThemesFolder: async () => {
        try {
          await this.backend.openPath(await this.backend.themesDir());
        } catch (err) {
          toast(errorMessage(err), "error");
        }
      },
    });

    this.makeResizer(sidebarResizer, (x) => {
      const left = this.root.getBoundingClientRect().left;
      this.settings.update({ sidebarWidth: Math.round(Math.min(Math.max(x - left, 180), window.innerWidth * 0.6)) });
    });
    this.makeResizer(splitResizer, (x) => {
      const panes = editorPane.parentElement!.getBoundingClientRect();
      this.settings.update({ splitRatio: Math.min(Math.max((x - panes.left) / panes.width, 0.15), 0.85) });
    });
  }

  private buildMenu(iconName: string, title: string, items: ([string, string, string, () => void] | null)[]): HTMLElement {
    const menu = h("div", { class: "menu", role: "menu", hidden: true });
    for (const item of items) {
      if (!item) {
        menu.append(h("hr"));
        continue;
      }
      const [ic, label, kbd, run] = item;
      menu.append(
        h("button", {
          role: "menuitem",
          html: `${icon(ic, 15)}<span>${label}</span>${kbd ? `<kbd>${kbd}</kbd>` : ""}`,
          onclick: () => {
            menu.hidden = true;
            run();
          },
        }),
      );
    }
    const trigger = iconButton(iconName, title, (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      document.querySelectorAll<HTMLElement>(".menu").forEach((m) => (m.hidden = true));
      menu.hidden = !willOpen;
    });
    trigger.setAttribute("aria-haspopup", "menu");
    document.addEventListener("click", () => (menu.hidden = true));
    document.addEventListener("keydown", (e) => e.key === "Escape" && (menu.hidden = true));
    return h("div", { class: "menu-wrap" }, trigger, menu);
  }

  private makeResizer(handle: HTMLElement, onMove: (clientX: number) => void): void {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      const move = (ev: PointerEvent) => onMove(ev.clientX);
      const up = () => {
        handle.classList.remove("dragging");
        document.body.style.cursor = "";
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // ======================================================================
  // Settings and theme
  // ======================================================================

  private applySettings(s: Readonly<Settings>, changed: (keyof Settings)[]): void {
    const has = (...keys: (keyof Settings)[]) => keys.some((k) => changed.includes(k));
    const style = this.root.style;
    if (has("theme")) this.applyTheme();
    if (has("contentWidth")) style.setProperty("--content-width", `${s.contentWidth}px`);
    if (has("fontSize")) this.preview.article.style.setProperty("--doc-font-size", `${s.fontSize}px`);
    if (has("font")) this.preview.article.style.setProperty("--doc-font", `var(--font-${s.font})`);
    if (has("sidebarWidth")) style.setProperty("--sidebar-width", `${s.sidebarWidth}px`);
    if (has("splitRatio")) style.setProperty("--split", `${(s.splitRatio * 100).toFixed(2)}%`);
    if (has("sidebarVisible")) this.root.dataset.sidebar = s.sidebarVisible ? "on" : "off";
    if (has("mode")) this.applyMode(s.mode);
    if (has("editorLineNumbers")) this.editor.setLineNumbers(s.editorLineNumbers);
    if (has("editorWrap")) this.editor.setWrap(s.editorWrap);
    if (has("editorFontSize")) this.editor.setFontSize(s.editorFontSize);
    if (has("showFrontMatter")) this.preview.article.classList.toggle("hide-front-matter", !s.showFrontMatter);
    if (has("customTheme")) void this.loadCustomTheme(s.customTheme);
  }

  private applyTheme(): void {
    const choice = this.settings.get().theme;
    const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    this.setResolvedTheme(dark ? "dark" : "light");
  }

  private setResolvedTheme(theme: "light" | "dark"): Promise<void> {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    this.editor.setDark(theme === "dark");
    const btn = this.root.querySelector(".theme-btn");
    if (btn) btn.innerHTML = icon(theme === "dark" ? "moon" : "sun");
    return this.preview.setTheme(theme);
  }

  private toggleTheme(): void {
    this.settings.update({ theme: this.theme === "dark" ? "light" : "dark" });
  }

  private async loadCustomTheme(name: string): Promise<void> {
    this.customCss = "";
    if (name) {
      try {
        this.customCss = await this.backend.readTheme(name);
      } catch (err) {
        toast(`Custom theme: ${errorMessage(err)}`, "error");
      }
    }
    this.customThemeStyle.textContent = this.customCss;
  }

  // ======================================================================
  // Modes and scroll sync
  // ======================================================================

  private setMode(mode: ViewMode): void {
    this.settings.update({ mode });
  }

  private applyMode(mode: ViewMode): void {
    const previous = this.root.dataset.mode as ViewMode | undefined;
    // Remember the reading position before the panes resize and the preview reflows.
    const line = previous === "edit" || (previous === "split" && mode === "view") ? this.editor.topLine() : this.preview.topLine();
    this.root.dataset.mode = mode;
    for (const [m, btn] of this.modeButtons) btn.setAttribute("aria-pressed", String(m === mode));
    if (previous && previous !== mode) {
      this.syncSource = "editor"; // Suppress scroll-sync echoes while restoring.
      clearTimeout(this.syncTimer);
      requestAnimationFrame(() => {
        if (mode !== "view") {
          this.editor.view.requestMeasure();
          this.editor.scrollToLine(line);
        }
        if (mode !== "edit") this.preview.scrollToLine(line);
        this.syncTimer = setTimeout(() => (this.syncSource = null), 150);
        if (mode !== "view" && this.doc) this.editor.focus();
      });
    }
    this.updateChrome();
  }

  private syncFrom(source: "editor" | "preview"): void {
    if (this.settings.get().mode !== "split" || !this.settings.get().syncScroll) return;
    if (this.syncSource && this.syncSource !== source) return;
    this.syncSource = source;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => (this.syncSource = null), 150);
    if (source === "editor") this.preview.scrollToLine(this.editor.topLine());
    else this.editor.scrollToLine(this.preview.topLine());
  }

  // ======================================================================
  // Opening documents and folders
  // ======================================================================

  async openPath(path: string, options: OpenOptions = {}): Promise<void> {
    try {
      const info = await this.backend.pathInfo(path);
      if (!info.exists) {
        removeRecent(path);
        toast(`Not found: ${path}`, "error");
        this.updateChrome();
        return;
      }
      if (info.isDir) await this.openFolder(info.path);
      else await this.openFile(info.path, options);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async openFile(path: string, options: OpenOptions = {}): Promise<void> {
    if (this.doc?.path && samePath(this.doc.path, path)) {
      if (options.pushHistory !== false && (options.hash || options.revealLine)) this.pushHistory();
      this.revealInDoc(options);
      return;
    }
    if (!(await this.confirmDiscard())) return;

    let text: string;
    try {
      text = await this.backend.readText(path);
    } catch (err) {
      removeRecent(path);
      toast(errorMessage(err), "error");
      return;
    }

    if (options.pushHistory !== false) this.pushHistory();
    this.doc = { path, saved: text, text };
    this.conflictDisk = null;
    this.banner.hidden = true;
    this.editor.setText(text, true);
    this.findbar.close();
    await this.renderDoc(true);
    if (options.line === undefined && !options.hash && !options.revealLine) this.preview.scroller.scrollTop = 0;
    this.revealInDoc(options);

    pushRecent({ path, isDir: false });
    this.sidebar.setCurrentFile(path);
    if (!this.folder && this.settings.get().sidebarTab === "files") {
      this.sidebar.showTab("outline");
      this.settings.update({ sidebarTab: "outline" });
    }
    this.saveSession();
    await this.updateWatches();
    this.updateChrome();
  }

  private revealInDoc(options: OpenOptions): void {
    requestAnimationFrame(() => {
      if (options.hash) {
        if (!this.preview.scrollToId(options.hash, false)) toast(`No heading “${options.hash}” in this document`);
      } else if (options.revealLine !== undefined) {
        const line0 = options.revealLine - 1;
        this.preview.scrollToLine(Math.max(0, line0 - 3));
        this.preview.flashLine(line0);
        if (this.settings.get().mode !== "view") this.editor.revealLine(options.revealLine);
        if (options.findQuery) this.findbar.open(options.findQuery, options.revealLine);
      } else if (options.line !== undefined) {
        this.preview.scrollToLine(options.line);
        if (this.settings.get().mode !== "view") this.editor.scrollToLine(options.line);
      }
    });
  }

  async openFolder(path: string): Promise<void> {
    try {
      const tree = await this.backend.listTree(path);
      this.folder = path;
      this.sidebar.setTree(tree);
      this.sidebar.showTab("files");
      this.settings.update({ sidebarVisible: true, sidebarTab: "files" });
      pushRecent({ path, isDir: true });
      this.saveSession();
      await this.updateWatches();
      if (!this.doc) {
        const readme = tree.children.find((c) => !c.isDir && /^(readme|index)\.(md|markdown)$/i.test(c.name));
        const first = readme ?? findFirstFile(tree);
        if (first) await this.openFile(first.path, { pushHistory: false });
      }
      this.updateChrome();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  private closeFolder(): void {
    this.folder = null;
    this.sidebar.setTree(null);
    this.saveSession();
    void this.updateWatches();
  }

  private async refreshTree(): Promise<void> {
    if (!this.folder) return;
    try {
      this.sidebar.setTree(await this.backend.listTree(this.folder));
      this.sidebar.setCurrentFile(this.doc?.path ?? null);
    } catch {
      // Folder may have been removed; leave the stale tree.
    }
  }

  private async pickAndOpenFile(): Promise<void> {
    const path = await this.backend.pickFile();
    if (path) await this.openFile(path);
  }

  private async pickAndOpenFolder(): Promise<void> {
    const path = await this.backend.pickFolder();
    if (path) await this.openFolder(path);
  }

  private async newFile(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.pushHistory();
    this.doc = { path: null, saved: "", text: "" };
    this.editor.setText("", true);
    await this.renderDoc(true);
    this.sidebar.setCurrentFile(null);
    if (this.settings.get().mode === "view") this.setMode("split");
    await this.updateWatches();
    this.updateChrome();
    requestAnimationFrame(() => this.editor.focus());
  }

  private async updateWatches(): Promise<void> {
    try {
      await this.backend.setWatches(this.doc?.path ?? null, this.folder);
    } catch (err) {
      console.warn("[watch]", err);
    }
  }

  private saveSession(): void {
    saveJson(SESSION_KEY, { folder: this.folder, file: this.doc?.path ?? null });
  }

  /** Restores the folder and file from the previous run (when nothing was passed at launch). */
  async restoreSession(): Promise<void> {
    const session = loadJson<{ folder: string | null; file: string | null }>(SESSION_KEY, { folder: null, file: null });
    if (session.folder) {
      const info = await this.backend.pathInfo(session.folder).catch(() => null);
      if (info?.exists && info.isDir) {
        this.folder = session.folder;
        try {
          this.sidebar.setTree(await this.backend.listTree(session.folder));
        } catch {
          this.folder = null;
        }
      }
    }
    if (session.file) {
      const info = await this.backend.pathInfo(session.file).catch(() => null);
      if (info?.exists && !info.isDir) await this.openFile(session.file, { pushHistory: false });
    }
    await this.updateWatches();
    this.updateChrome();
  }

  // ======================================================================
  // History
  // ======================================================================

  private pushHistory(): void {
    if (!this.doc?.path) return;
    this.back.push({ path: this.doc.path, line: this.preview.topLine() });
    if (this.back.length > 100) this.back.shift();
    this.forward = [];
    this.updateChrome();
  }

  private async goBack(): Promise<void> {
    const entry = this.back.pop();
    if (!entry) return;
    if (this.doc?.path) this.forward.push({ path: this.doc.path, line: this.preview.topLine() });
    await this.navigateTo(entry);
  }

  private async goForward(): Promise<void> {
    const entry = this.forward.pop();
    if (!entry) return;
    if (this.doc?.path) this.back.push({ path: this.doc.path, line: this.preview.topLine() });
    await this.navigateTo(entry);
  }

  private async navigateTo(entry: HistoryEntry): Promise<void> {
    if (this.doc?.path && samePath(this.doc.path, entry.path)) {
      this.preview.scrollToLine(entry.line);
    } else {
      await this.openFile(entry.path, { line: entry.line, pushHistory: false });
    }
    this.updateChrome();
  }

  // ======================================================================
  // Rendering and editing
  // ======================================================================

  private async renderDoc(newDocument = false): Promise<void> {
    if (!this.doc) {
      this.preview.clear();
      this.sidebar.setOutline([]);
      return;
    }
    const baseDir = this.doc.path ? dirname(this.doc.path) : "";
    const result = await this.preview.render(this.doc.text, baseDir, newDocument);
    if (!result) return;
    this.sidebar.setOutline(result.toc);
    this.findbar.refresh();
    const words = countWords(this.doc.text);
    this.status.words.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`;
  }

  private onEditorChange(text: string): void {
    if (!this.doc) this.doc = { path: null, saved: "", text: "" };
    this.doc.text = text;
    this.renderSoon();
    if (this.settings.get().autoSave) this.autoSaveSoon();
    this.updateDirty();
  }

  private isDirty(): boolean {
    return !!this.doc && this.doc.text !== this.doc.saved;
  }

  private async toggleTask(line: number, checked: boolean): Promise<void> {
    if (!this.doc) return;
    const updated = toggleTaskAt(this.doc.text, line, checked);
    if (updated === null) return;
    this.doc.text = updated;
    this.editor.setText(updated);
    this.updateDirty();
    // In read mode there is no visible editor, so persist the click right away.
    if (this.settings.get().mode === "view" && this.doc.path) await this.save(true);
    else this.renderSoon();
  }

  private async followLink(href: string): Promise<void> {
    if (href.startsWith("#")) {
      this.pushHistory();
      this.preview.scrollToId(decodeURIComponent(href.slice(1)));
      return;
    }
    if (hasUrlScheme(href) && !href.startsWith("file:")) {
      await this.backend.openExternal(href).catch((err) => toast(errorMessage(err), "error"));
      return;
    }
    const [target, hash] = splitHash(href);
    if (!this.doc?.path) {
      toast("Save the document first to follow relative links");
      return;
    }
    const resolved = resolvePath(dirname(this.doc.path), target);
    if (isMarkdownPath(resolved)) {
      await this.openPath(resolved, { hash: hash ? decodeURIComponent(hash) : undefined });
    } else {
      await this.backend.openPath(resolved).catch((err) => toast(errorMessage(err), "error"));
    }
  }

  // ======================================================================
  // Saving
  // ======================================================================

  async save(quiet = false): Promise<boolean> {
    if (!this.doc) return false;
    if (!this.doc.path) return this.saveAs();
    const text = this.doc.text;
    try {
      await this.backend.writeText(this.doc.path, text);
      this.doc.saved = text;
      this.conflictDisk = null;
      this.banner.hidden = true;
      this.updateDirty();
      if (!quiet) toast("Saved", "success", 1400);
      return true;
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    if (!this.doc) return false;
    const suggested = this.doc.path ?? `${this.folder ?? ""}${this.folder ? (this.folder.includes("\\") ? "\\" : "/") : ""}Untitled.md`;
    const path = await this.backend.pickSavePath(suggested, [{ name: "Markdown", extensions: ["md", "markdown"] }]);
    if (!path) return false;
    try {
      await this.backend.writeText(path, this.doc.text);
    } catch (err) {
      toast(errorMessage(err), "error");
      return false;
    }
    this.doc.path = path;
    this.doc.saved = this.doc.text;
    pushRecent({ path, isDir: false });
    this.saveSession();
    await this.renderDoc(true);
    await this.updateWatches();
    if (this.folder && isInside(path, this.folder)) await this.refreshTree();
    this.sidebar.setCurrentFile(path);
    this.updateChrome();
    toast(`Saved as ${basename(path)}`, "success");
    return true;
  }

  private async reloadFromDisk(): Promise<void> {
    if (!this.doc?.path) return;
    if (this.isDirty() && !(await this.backend.confirm(`Discard your changes to ${basename(this.doc.path)} and reload it from disk?`, { okLabel: "Reload", cancelLabel: "Cancel" }))) return;
    await this.applyDiskText(await this.backend.readText(this.doc.path));
  }

  private async applyDiskText(disk: string): Promise<void> {
    if (!this.doc) return;
    this.doc.saved = disk;
    this.doc.text = disk;
    this.conflictDisk = null;
    this.banner.hidden = true;
    this.editor.setText(disk);
    await this.renderDoc();
    this.updateDirty();
  }

  /** Asks before throwing away unsaved edits. Resolves true when it's OK to proceed. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.isDirty()) return true;
    const name = this.doc?.path ? basename(this.doc.path) : "Untitled";
    return this.backend.confirm(`You have unsaved changes in ${name}. Discard them?`, { title: "Unsaved changes", okLabel: "Discard", cancelLabel: "Cancel" });
  }

  // ======================================================================
  // File system events
  // ======================================================================

  private bindBackend(): void {
    this.backend.onFsChange((paths) => {
      if (this.doc?.path && paths.some((p) => samePath(p, this.doc!.path))) this.handleFileChangeSoon();
      if (this.folder && paths.some((p) => isInside(p, this.folder!))) this.refreshTreeSoon();
    });
    this.backend.onOpenPath((info) => void this.openPath(info.path));
    this.backend.onDragDrop((paths) => {
      if (paths[0]) void this.openPath(paths[0]);
    });
    this.backend.onCloseRequested(async () => {
      if (!this.isDirty()) return true;
      return this.backend.confirm("You have unsaved changes. Quit anyway?", { title: "Unsaved changes", okLabel: "Quit", cancelLabel: "Cancel" });
    });
  }

  private async handleExternalChange(): Promise<void> {
    const doc = this.doc;
    if (!doc?.path) return;
    let disk: string;
    try {
      disk = await this.backend.readText(doc.path);
    } catch {
      // Some editors save by delete + rename; try once more before reporting.
      await new Promise((r) => setTimeout(r, 300));
      try {
        disk = await this.backend.readText(doc.path);
      } catch {
        toast(`${basename(doc.path)} was deleted or moved. Save to recreate it.`, "error");
        doc.saved = "\u0000deleted";
        this.updateDirty();
        return;
      }
    }
    if (disk === doc.saved || disk === this.conflictDisk) return;
    if (!this.isDirty()) {
      const editorLine = this.editor.topLine();
      await this.applyDiskText(disk);
      if (this.settings.get().mode !== "view") this.editor.scrollToLine(editorLine);
      return;
    }
    this.conflictDisk = disk;
    this.showConflict(basename(doc.path));
  }

  private showConflict(name: string): void {
    this.banner.replaceChildren(
      h("span", { html: icon("refresh") }),
      h("span", { class: "banner-text" }, `${name} changed on disk while you have unsaved edits.`),
      h("button", { class: "btn", onclick: () => this.conflictDisk !== null && void this.applyDiskText(this.conflictDisk) }, "Reload from disk"),
      h(
        "button",
        {
          class: "btn primary",
          onclick: () => {
            if (this.doc && this.conflictDisk !== null) this.doc.saved = this.conflictDisk;
            this.banner.hidden = true;
            this.updateDirty();
          },
        },
        "Keep my version",
      ),
    );
    this.banner.hidden = false;
  }

  // ======================================================================
  // Export and printing
  // ======================================================================

  private docTitle(): string {
    return this.doc?.path ? stripExtension(basename(this.doc.path)) : "Untitled";
  }

  private async exportHtml(): Promise<void> {
    if (!this.doc) return toast("Nothing to export");
    const base = this.doc.path ? this.doc.path.replace(/\.[^./\\]+$/, "") : "Untitled";
    const path = await this.backend.pickSavePath(`${base}.html`, [{ name: "HTML", extensions: ["html"] }]);
    if (!path) return;
    try {
      const html = await buildStandaloneHtml(this.preview.article, this.docTitle(), this.theme, this.customCss);
      await this.backend.writeText(path, html);
      toast(`Exported ${basename(path)}`, "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  private async copyHtml(): Promise<void> {
    if (!this.doc) return;
    const html = await buildStandaloneHtml(this.preview.article, this.docTitle(), this.theme, this.customCss);
    await navigator.clipboard.writeText(html);
    toast("Rendered HTML copied", "success", 1600);
  }

  private async print(): Promise<void> {
    if (!this.doc) return toast("Nothing to print");
    const restore = this.theme;
    // Paper is white: render diagrams and code in the light theme for printing.
    if (restore === "dark") await this.setResolvedTheme("light");
    try {
      await this.backend.print();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      if (restore === "dark") await this.setResolvedTheme("dark");
    }
  }

  // ======================================================================
  // Find
  // ======================================================================

  private openFind(): void {
    const selection = window.getSelection()?.toString().trim();
    if (this.settings.get().mode === "edit") {
      this.editor.focus();
      return;
    }
    this.findbar.open(selection && !selection.includes("\n") ? selection : undefined);
  }

  // ======================================================================
  // Chrome (title, status, welcome)
  // ======================================================================

  private updateDirty(): void {
    const dirty = this.isDirty();
    this.dirtyDot.hidden = !dirty;
    this.status.state.textContent = !this.doc ? "" : dirty ? "Unsaved" : this.doc.path ? "Saved" : "";
    const name = this.doc ? (this.doc.path ? basename(this.doc.path) : "Untitled") : null;
    void this.backend.setTitle(name ? `${dirty ? "● " : ""}${name} — Markdown Under` : "Markdown Under");
  }

  private updateChrome(): void {
    const doc = this.doc;
    this.titleName.textContent = doc ? (doc.path ? basename(doc.path) : "Untitled") : "Markdown Under";
    this.titlePath.textContent = doc?.path ? shortDir(doc.path, this.folder) : "";
    this.titlePath.title = doc?.path ?? "";
    this.status.path.textContent = doc?.path ?? (doc ? "Not saved yet" : this.folder ?? "");
    if (!doc) {
      this.status.words.textContent = "";
      this.status.cursor.textContent = "";
    }
    this.status.cursor.hidden = this.settings.get().mode === "view";
    this.backBtn.disabled = this.back.length === 0;
    this.forwardBtn.disabled = this.forward.length === 0;
    this.welcome.hidden = !!doc;
    if (!doc) this.renderWelcome();
    this.updateDirty();
  }

  private renderWelcome(): void {
    const recent = getRecent();
    const shortcuts: [string, string][] = [
      ["Open file", "Ctrl+O"],
      ["Open folder", "Ctrl+Shift+O"],
      ["New file", "Ctrl+N"],
      ["Save", "Ctrl+S"],
      ["Read / Split / Edit", "Ctrl+1 / 2 / 3"],
      ["Toggle split view", "Ctrl+E"],
      ["Find in document", "Ctrl+F"],
      ["Search folder", "Ctrl+Shift+F"],
      ["Toggle sidebar", "Ctrl+\\"],
      ["Back / Forward", "Alt+← / →"],
      ["Zoom text", "Ctrl+= / Ctrl+-"],
      ["Print / PDF", "Ctrl+P"],
    ];
    this.welcome.replaceChildren(
      h(
        "div",
        { class: "welcome-inner" },
        h("div", { class: "welcome-logo" }, h("img", { src: appIcon, alt: "" }), h("h1", {}, "Markdown Under")),
        h("p", { class: "tagline" }, "Read, edit and search your Markdown, locally."),
        h(
          "div",
          { class: "welcome-actions" },
          h("button", { class: "btn primary", html: `${icon("file")}<span>Open file</span>`, onclick: () => void this.pickAndOpenFile() }),
          h("button", { class: "btn", html: `${icon("folder")}<span>Open folder</span>`, onclick: () => void this.pickAndOpenFolder() }),
          h("button", { class: "btn", html: `${icon("plus")}<span>New file</span>`, onclick: () => void this.newFile() }),
        ),
        recent.length ? h("h2", {}, "Recent") : null,
        recent.length
          ? h(
              "ul",
              { class: "recent-list" },
              ...recent.map((r) =>
                h(
                  "li",
                  {},
                  h("button", {
                    class: "recent-item",
                    title: r.path,
                    html: `${icon(r.isDir ? "folder" : "file")}<span class="name"></span><span class="path"></span>`,
                    onclick: () => void this.openPath(r.path),
                  }),
                ),
              ),
            )
          : null,
        h("h2", {}, "Keyboard shortcuts"),
        h("div", { class: "shortcut-grid" }, ...shortcuts.map(([label, key]) => h("div", {}, h("span", {}, label), h("kbd", { class: "key" }, key)))),
      ),
    );
    // Fill names/paths as text to avoid any HTML interpretation of file names.
    this.welcome.querySelectorAll<HTMLElement>(".recent-item").forEach((btn, i) => {
      btn.querySelector(".name")!.textContent = basename(recent[i].path);
      btn.querySelector(".path")!.textContent = dirname(recent[i].path);
    });
  }

  // ======================================================================
  // Keyboard
  // ======================================================================

  private bindShortcuts(): void {
    window.addEventListener(
      "keydown",
      (e) => {
        // A modal (settings) owns the keyboard, including Escape to close it.
        if (document.querySelector("dialog[open]")) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        const inEditor = this.editor.view.hasFocus;
        const run = (fn: () => unknown) => {
          e.preventDefault();
          e.stopPropagation();
          void fn();
        };

        if (mod && e.shiftKey) {
          if (key === "o") return run(() => this.pickAndOpenFolder());
          if (key === "s") return run(() => this.saveAs());
          if (key === "f") return run(() => this.sidebar.focusSearch(window.getSelection()?.toString().trim() || undefined));
          if (key === "e") return run(() => this.exportHtml());
          if (key === "l") return run(() => this.toggleTheme());
        }
        if (mod && !e.shiftKey && !e.altKey) {
          if (key === "o") return run(() => this.pickAndOpenFile());
          if (key === "n") return run(() => this.newFile());
          if (key === "s") return run(() => this.save());
          if (key === "p") return run(() => this.print());
          if (key === "e") return run(() => this.setMode(this.settings.get().mode === "view" ? "split" : "view"));
          if (key === "1" || key === "2" || key === "3") return run(() => this.setMode(MODES[Number(key) - 1]));
          if (key === "\\") return run(() => this.settings.update({ sidebarVisible: !this.settings.get().sidebarVisible }));
          if (key === ",") return run(() => this.settingsDialog.open());
          if (key === "r") return run(() => this.reloadFromDisk());
          if (key === "=" || key === "+") return run(() => this.zoom(1));
          if (key === "-") return run(() => this.zoom(-1));
          if (key === "0") return run(() => this.settings.update({ fontSize: 16 }));
          if (key === "f" && !inEditor) return run(() => this.openFind());
        }
        if (e.altKey && !mod) {
          if (e.key === "ArrowLeft") return run(() => this.goBack());
          if (e.key === "ArrowRight") return run(() => this.goForward());
        }
        if (e.key === "F5") return run(() => this.reloadFromDisk());
        if (e.key === "Escape" && this.findbar.isOpen) return run(() => this.findbar.close());
      },
      true,
    );
    // Mouse back/forward buttons.
    window.addEventListener("mouseup", (e) => {
      if (e.button === 3) void this.goBack();
      if (e.button === 4) void this.goForward();
    });
  }

  private zoom(delta: number): void {
    const s = this.settings.get();
    if (this.editor.view.hasFocus) this.settings.update({ editorFontSize: Math.min(24, Math.max(10, s.editorFontSize + delta)) });
    else this.settings.update({ fontSize: Math.min(24, Math.max(12, s.fontSize + delta)) });
  }
}

/** Compact folder label for the title bar: relative to the open folder, else the last two segments. */
function shortDir(path: string, folder: string | null): string {
  const dir = dirname(path);
  if (folder && isInside(path, folder)) {
    const rel = relativeTo(dir, folder);
    return rel && rel !== dir ? `${basename(folder)}/${rel}` : basename(folder);
  }
  const parts = dir.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : dir;
}

function findFirstFile(node: TreeNode): TreeNode | null {
  for (const child of node.children) {
    if (!child.isDir) return child;
  }
  for (const child of node.children) {
    const found = findFirstFile(child);
    if (found) return found;
  }
  return null;
}
