export type ThemeChoice = "system" | "light" | "dark";

export interface ExtensionSettings {
  theme: ThemeChoice;
  fontSize: number;
  contentWidth: number;
  fontFamily: "sans" | "serif";
  showOutline: boolean;
  liveReload: boolean;
  renderRemote: boolean;
}

export const DEFAULTS: ExtensionSettings = {
  theme: "system",
  fontSize: 16,
  contentWidth: 860,
  fontFamily: "sans",
  showOutline: true,
  liveReload: true,
  renderRemote: true,
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get({ ...DEFAULTS } as Record<string, unknown>);
  return { ...DEFAULTS, ...(stored as Partial<ExtensionSettings>) };
}

export function saveSettings(patch: Partial<ExtensionSettings>): Promise<void> {
  return chrome.storage.sync.set(patch);
}

export function onSettingsChanged(fn: (settings: ExtensionSettings) => void): void {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") void loadSettings().then(fn);
  });
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
