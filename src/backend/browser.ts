import type { Backend, PathInfo, SearchResult, TreeNode } from "./types";
import showcase from "../../samples/showcase.md?raw";
import { basename, dirname, isMarkdownPath } from "../lib/paths";

// In-memory backend used when the UI runs in a normal browser (`npm run dev`), so the
// interface can be developed and tested without the desktop shell. Never used in the app.

const DEMO_FILES: Record<string, string> = {
  "/demo/README.md": `# Demo folder

This is the in-browser demo of **Markdown Under**. The desktop app reads real files.

- [Showcase of every feature](showcase.md)
- [Getting started](guide/getting-started.md)
- [Ideas](notes/ideas.md#later)
`,
  "/demo/showcase.md": showcase,
  "/demo/guide/getting-started.md": `# Getting started

1. Open a file with **Ctrl+O** or a folder with **Ctrl+Shift+O**.
2. Toggle edit mode with **Ctrl+E**.
3. Search the folder with **Ctrl+Shift+F**.

[Back to README](../README.md)
`,
  "/demo/notes/ideas.md": `# Ideas

## Now

- [x] Folder tree
- [ ] Wikilinks

## Later

- Backlinks panel
- Focus mode
`,
};

export class BrowserBackend implements Backend {
  readonly isDesktop = false;
  private files = new Map(Object.entries(DEMO_FILES));
  private fsListeners: ((paths: string[]) => void)[] = [];

  async readText(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`Could not read ${path}: not found`);
    return text;
  }
  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
    setTimeout(() => this.fsListeners.forEach((cb) => cb([path])), 30);
  }
  async pathInfo(path: string): Promise<PathInfo> {
    const isDir = [...this.files.keys()].some((p) => p.startsWith(path.replace(/\/$/, "") + "/"));
    return { path, exists: isDir || this.files.has(path), isDir };
  }
  async listTree(root: string): Promise<TreeNode> {
    const rootNode: TreeNode = { name: basename(root), path: root, isDir: true, children: [] };
    for (const path of [...this.files.keys()].sort()) {
      if (!path.startsWith(root + "/") || !isMarkdownPath(path)) continue;
      const parts = path.slice(root.length + 1).split("/");
      let node = rootNode;
      parts.forEach((part, i) => {
        const childPath = `${node.path}/${part}`;
        let child = node.children.find((c) => c.path === childPath);
        if (!child) {
          child = { name: part, path: childPath, isDir: i < parts.length - 1, children: [] };
          node.children.push(child);
        }
        node = child;
      });
    }
    const sort = (n: TreeNode) => {
      n.children.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
      n.children.forEach(sort);
    };
    sort(rootNode);
    return rootNode;
  }
  async search(root: string, query: string, caseSensitive: boolean): Promise<SearchResult> {
    const result: SearchResult = { hits: [], truncated: false, filesSearched: 0 };
    if (!query) return result;
    const needle = caseSensitive ? query : query.toLowerCase();
    for (const [path, text] of this.files) {
      if (!path.startsWith(root + "/")) continue;
      result.filesSearched++;
      text.split("\n").forEach((line, i) => {
        if ((caseSensitive ? line : line.toLowerCase()).includes(needle)) {
          result.hits.push({ path, line: i + 1, text: line.trim() });
        }
      });
    }
    return result;
  }
  async setWatches() {}
  onFsChange(cb: (paths: string[]) => void) {
    this.fsListeners.push(cb);
  }
  onOpenPath() {}
  onDragDrop() {}
  onCloseRequested() {}
  async takeInitialPath(): Promise<PathInfo | null> {
    const params = new URLSearchParams(location.search);
    const path = params.get("open");
    return path ? this.pathInfo(path) : null;
  }
  async pickFile() {
    return "/demo/showcase.md";
  }
  async pickFolder() {
    return "/demo";
  }
  async pickSavePath(defaultPath: string) {
    return `${dirname(defaultPath) || "/demo"}/${basename(defaultPath)}`;
  }
  async confirm(message: string) {
    console.info("[browser backend] auto-confirming:", message);
    return true;
  }
  async openExternal(url: string) {
    window.open(url, "_blank", "noopener");
  }
  async openPath(path: string) {
    console.info("[browser backend] open path", path);
  }
  async revealPath(path: string) {
    console.info("[browser backend] reveal", path);
  }
  assetUrl(path: string) {
    return path;
  }
  async themesDir() {
    return "/themes";
  }
  async listThemes() {
    return ["sepia-demo"];
  }
  async readTheme() {
    return ".markdown-body { --mu-bg: #f4ecd8; --mu-fg: #433422; background: var(--mu-bg); color: var(--mu-fg); }";
  }
  async print() {
    window.print();
  }
  async setTitle(title: string) {
    document.title = title;
  }
}
