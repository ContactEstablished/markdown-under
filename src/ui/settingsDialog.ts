import type { Settings, SettingsStore } from "../settings";
import { h, icon } from "./dom";

export interface SettingsDialogOptions {
  store: SettingsStore;
  listThemes(): Promise<string[]>;
  openThemesFolder(): void;
}

type Field =
  | { kind: "select"; key: keyof Settings; label: string; hint?: string; options: [string, string][] }
  | { kind: "number"; key: keyof Settings; label: string; hint?: string; min: number; max: number; step?: number }
  | { kind: "range"; key: keyof Settings; label: string; hint?: string; min: number; max: number; step?: number; unit: string }
  | { kind: "check"; key: keyof Settings; label: string; hint?: string };

/** Modal settings panel. Every change applies immediately and persists. */
export class SettingsDialog {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;

  constructor(private options: SettingsDialogOptions) {
    this.body = h("div", { class: "settings-body" });
    this.dialog = h(
      "dialog",
      { class: "settings", "aria-label": "Settings" },
      h(
        "div",
        { class: "settings-header" },
        h("h2", {}, "Settings"),
        h("button", { class: "icon-btn", title: "Close", "aria-label": "Close", html: icon("x"), onclick: () => this.dialog.close() }),
      ),
      this.body,
      h(
        "div",
        { class: "settings-footer" },
        h("button", { class: "btn", onclick: () => (this.options.store.reset(), void this.render()) }, "Reset to defaults"),
        h("button", { class: "btn primary", onclick: () => this.dialog.close() }, "Done"),
      ),
    );
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
    document.body.append(this.dialog);
  }

  async open(): Promise<void> {
    await this.render();
    this.dialog.showModal();
  }

  private async render(): Promise<void> {
    let themes: string[] = [];
    try {
      themes = await this.options.listThemes();
    } catch {
      themes = [];
    }
    const sections: [string, Field[]][] = [
      [
        "Appearance",
        [
          { kind: "select", key: "theme", label: "Theme", options: [["system", "Match system"], ["light", "Light"], ["dark", "Dark"]] },
          { kind: "select", key: "font", label: "Document font", options: [["sans", "Sans-serif"], ["serif", "Serif"], ["mono", "Monospace"]] },
          { kind: "range", key: "fontSize", label: "Document font size", min: 12, max: 24, step: 1, unit: "px" },
          { kind: "range", key: "contentWidth", label: "Reading width", hint: "Maximum width of the rendered document", min: 560, max: 1600, step: 20, unit: "px" },
          {
            kind: "select",
            key: "customTheme",
            label: "Custom theme",
            hint: "CSS files from your themes folder",
            options: [["", "None"], ...themes.map((t): [string, string] => [t, t])],
          },
        ],
      ],
      [
        "Reading",
        [
          { kind: "check", key: "showFrontMatter", label: "Show YAML front matter", hint: "As a collapsible table at the top" },
          { kind: "check", key: "syncScroll", label: "Sync scrolling in split view" },
        ],
      ],
      [
        "Editor",
        [
          { kind: "range", key: "editorFontSize", label: "Editor font size", min: 10, max: 24, step: 1, unit: "px" },
          { kind: "check", key: "editorLineNumbers", label: "Line numbers" },
          { kind: "check", key: "editorWrap", label: "Wrap long lines" },
          { kind: "check", key: "autoSave", label: "Auto-save", hint: "Save a second after you stop typing" },
        ],
      ],
    ];

    const settings = this.options.store.get();
    const children: HTMLElement[] = [];
    for (const [title, fields] of sections) {
      children.push(h("h3", {}, title));
      for (const field of fields) children.push(this.row(field, settings));
      if (title === "Appearance") {
        children.push(
          h(
            "div",
            { class: "setting-row" },
            h("label", {}, "Themes folder", h("small", {}, "Drop .css files here, then reopen Settings")),
            h("button", { class: "btn", onclick: () => this.options.openThemesFolder() }, "Open folder"),
          ),
        );
      }
    }
    this.body.replaceChildren(...children);
  }

  private row(field: Field, settings: Readonly<Settings>): HTMLElement {
    const id = `setting-${field.key}`;
    const value = settings[field.key];
    const update = (v: unknown) => this.options.store.update({ [field.key]: v } as Partial<Settings>);
    let control: HTMLElement;
    let readout: HTMLElement | null = null;

    switch (field.kind) {
      case "select": {
        const select = h("select", { id });
        for (const [v, label] of field.options) select.append(h("option", { value: v, selected: v === value }, label));
        select.addEventListener("change", () => update(select.value));
        control = select;
        break;
      }
      case "number": {
        const input = h("input", { id, type: "number", min: field.min, max: field.max, step: field.step ?? 1, value: String(value) });
        input.addEventListener("change", () => update(clamp(Number(input.value), field.min, field.max)));
        control = input;
        break;
      }
      case "range": {
        readout = h("span", { class: "range-readout" }, `${value}${field.unit}`);
        const input = h("input", { id, type: "range", min: field.min, max: field.max, step: field.step ?? 1, value: String(value) });
        input.addEventListener("input", () => {
          readout!.textContent = `${input.value}${field.unit}`;
          update(Number(input.value));
        });
        control = h("div", { style: "display:flex;align-items:center;gap:8px" }, input, readout);
        break;
      }
      case "check": {
        const input = h("input", { id, type: "checkbox", checked: Boolean(value) });
        input.addEventListener("change", () => update(input.checked));
        control = input;
        break;
      }
    }
    return h("div", { class: "setting-row" }, h("label", { for: id }, field.label, field.hint ? h("small", {}, field.hint) : null), control);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
