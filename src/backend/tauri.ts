import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { openUrl, openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Backend, ConfirmOptions, FileFilter, PathInfo, SearchResult, TreeNode } from "./types";

const MARKDOWN_FILTER: FileFilter = { name: "Markdown", extensions: ["md", "markdown", "mdx", "mkd", "mdown", "mkdn"] };

export class TauriBackend implements Backend {
  readonly isDesktop = true;

  readText(path: string) {
    return invoke<string>("read_text_file", { path });
  }
  writeText(path: string, contents: string) {
    return invoke<void>("write_text_file", { path, contents });
  }
  pathInfo(path: string) {
    return invoke<PathInfo>("get_path_info", { path });
  }
  listTree(root: string) {
    return invoke<TreeNode>("list_markdown_tree", { root });
  }
  search(root: string, query: string, caseSensitive: boolean) {
    return invoke<SearchResult>("search_folder", { root, query, caseSensitive });
  }
  setWatches(file: string | null, folder: string | null) {
    return invoke<void>("set_watches", { file, folder });
  }
  onFsChange(cb: (paths: string[]) => void) {
    void listen<{ paths: string[] }>("fs-change", (e) => cb(e.payload.paths));
  }
  onOpenPath(cb: (info: PathInfo) => void) {
    void listen<PathInfo>("open-path", (e) => cb(e.payload));
  }
  onDragDrop(cb: (paths: string[]) => void) {
    void getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") cb(e.payload.paths);
    });
  }
  onCloseRequested(handler: () => Promise<boolean>) {
    const win = getCurrentWindow();
    void win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (await handler()) await win.destroy();
    });
  }
  takeInitialPath() {
    return invoke<PathInfo | null>("take_initial_path");
  }
  async pickFile() {
    const result = await open({ multiple: false, directory: false, filters: [MARKDOWN_FILTER, { name: "All files", extensions: ["*"] }] });
    return typeof result === "string" ? result : null;
  }
  async pickFolder() {
    const result = await open({ multiple: false, directory: true });
    return typeof result === "string" ? result : null;
  }
  async pickSavePath(defaultPath: string, filters: FileFilter[]) {
    return (await save({ defaultPath, filters })) ?? null;
  }
  confirm(message: string, options: ConfirmOptions = {}) {
    return ask(message, { title: options.title ?? "Markdown Under", kind: options.kind ?? "warning", okLabel: options.okLabel, cancelLabel: options.cancelLabel });
  }
  openExternal(url: string) {
    return openUrl(url);
  }
  openPath(path: string) {
    return openPath(path);
  }
  revealPath(path: string) {
    return revealItemInDir(path);
  }
  assetUrl(path: string) {
    return convertFileSrc(path);
  }
  themesDir() {
    return invoke<string>("themes_dir");
  }
  listThemes() {
    return invoke<string[]>("list_themes");
  }
  readTheme(name: string) {
    return invoke<string>("read_theme", { name });
  }
  async print() {
    // window.print() blocks until the dialog closes, so callers can restore state after it.
    // Fall back to the native webview print if the webview refuses.
    try {
      window.print();
    } catch {
      await invoke<void>("print_page");
    }
  }
  setTitle(title: string) {
    return getCurrentWindow().setTitle(title);
  }
}
