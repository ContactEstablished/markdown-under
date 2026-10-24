export type ThemeChoice = "system" | "light" | "dark";
export type ViewMode = "view" | "split" | "edit";
export type FontChoice = "sans" | "serif" | "mono";

export interface Settings {
  theme: ThemeChoice;
  fontSize: number;
  contentWidth: number;
  font: FontChoice;
  customTheme: string;
  mode: ViewMode;
  sidebarVisible: boolean;
  sidebarWidth: number;
  sidebarTab: "files" | "outline" | "search";
  editorLineNumbers: boolean;
  editorWrap: boolean;
  editorFontSize: number;
  syncScroll: boolean;
  showFrontMatter: boolean;
  splitRatio: number;
  autoSave: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  fontSize: 16,
  contentWidth: 860,
  font: "sans",
  customTheme: "",
  mode: "view",
  sidebarVisible: true,
  sidebarWidth: 270,
  sidebarTab: "outline",
  editorLineNumbers: true,
  editorWrap: true,
  editorFontSize: 14,
  syncScroll: true,
  showFrontMatter: true,
  splitRatio: 0.5,
  autoSave: false,
};

const STORAGE_KEY = "markdown-under.settings";

type Listener = (settings: Settings, changed: (keyof Settings)[]) => void;

export class SettingsStore {
  private value: Settings;
  private listeners: Listener[] = [];

  constructor() {
    this.value = { ...DEFAULT_SETTINGS, ...loadJson<Partial<Settings>>(STORAGE_KEY, {}) };
  }

  get(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== this.value[k]);
    if (changed.length === 0) return;
    this.value = { ...this.value, ...patch };
    saveJson(STORAGE_KEY, this.value);
    this.listeners.forEach((l) => l(this.value, changed));
  }

  reset(): void {
    this.update({ ...DEFAULT_SETTINGS });
  }

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable; settings just won't persist.
  }
}

const RECENT_KEY = "markdown-under.recent";
const MAX_RECENT = 12;

export interface RecentEntry {
  path: string;
  isDir: boolean;
}

export function getRecent(): RecentEntry[] {
  return loadJson<RecentEntry[]>(RECENT_KEY, []);
}

export function pushRecent(entry: RecentEntry): void {
  const list = getRecent().filter((r) => r.path.toLowerCase() !== entry.path.toLowerCase());
  list.unshift(entry);
  saveJson(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export function removeRecent(path: string): void {
  saveJson(RECENT_KEY, getRecent().filter((r) => r.path !== path));
}
