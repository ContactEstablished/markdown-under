export interface PathInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

export interface SearchHit {
  path: string;
  /** 1-based line number. */
  line: number;
  text: string;
}

export interface SearchResult {
  hits: SearchHit[];
  truncated: boolean;
  filesSearched: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ConfirmOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

/**
 * Everything the UI needs from the host. The desktop build talks to the Rust side
 * through Tauri; the browser build (used for UI development) runs on an in-memory demo.
 */
export interface Backend {
  readonly isDesktop: boolean;
  readText(path: string): Promise<string>;
  writeText(path: string, contents: string): Promise<void>;
  pathInfo(path: string): Promise<PathInfo>;
  listTree(root: string): Promise<TreeNode>;
  search(root: string, query: string, caseSensitive: boolean): Promise<SearchResult>;
  setWatches(file: string | null, folder: string | null): Promise<void>;
  onFsChange(cb: (paths: string[]) => void): void;
  onOpenPath(cb: (info: PathInfo) => void): void;
  onDragDrop(cb: (paths: string[]) => void): void;
  /** Return false from the handler to keep the window open. */
  onCloseRequested(handler: () => Promise<boolean>): void;
  takeInitialPath(): Promise<PathInfo | null>;
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  pickSavePath(defaultPath: string, filters: FileFilter[]): Promise<string | null>;
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  /** URL the webview can load a local file (e.g. an image) from. */
  assetUrl(path: string): string;
  themesDir(): Promise<string>;
  listThemes(): Promise<string[]>;
  readTheme(name: string): Promise<string>;
  print(): Promise<void>;
  setTitle(title: string): Promise<void>;
}
