import "../../src/styles/tokens.css";
import "./options.css";
import { loadSettings, onSettingsChanged, resolveTheme, saveSettings, type ExtensionSettings } from "./settings";

const field = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const selects = ["theme", "fontFamily"] as const;
const ranges = ["fontSize", "contentWidth"] as const;
const checks = ["showOutline", "liveReload", "renderRemote"] as const;

function show(s: ExtensionSettings): void {
  document.documentElement.dataset.theme = resolveTheme(s.theme);
  for (const id of selects) field<HTMLSelectElement>(id).value = s[id];
  for (const id of ranges) {
    field<HTMLInputElement>(id).value = String(s[id]);
    field<HTMLOutputElement>(`${id}-value`).textContent = `${s[id]}px`;
  }
  for (const id of checks) field<HTMLInputElement>(id).checked = s[id];
}

for (const id of selects) field<HTMLSelectElement>(id).addEventListener("change", (e) => void saveSettings({ [id]: (e.target as HTMLSelectElement).value }));
for (const id of ranges) {
  field<HTMLInputElement>(id).addEventListener("input", (e) => {
    const value = Number((e.target as HTMLInputElement).value);
    field<HTMLOutputElement>(`${id}-value`).textContent = `${value}px`;
    void saveSettings({ [id]: value });
  });
}
for (const id of checks) field<HTMLInputElement>(id).addEventListener("change", (e) => void saveSettings({ [id]: (e.target as HTMLInputElement).checked }));

chrome.extension.isAllowedFileSchemeAccess().then((allowed) => {
  field("file-access").hidden = allowed;
});
field("open-details").addEventListener("click", () => {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

void loadSettings().then(show);
onSettingsChanged(show);
