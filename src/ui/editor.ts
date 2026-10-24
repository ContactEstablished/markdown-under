import { EditorState, Compartment, EditorSelection, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { h, icon } from "./dom";

export interface EditorCallbacks {
  onChange(text: string): void;
  onScroll(): void;
  onCursor(line: number, col: number): void;
  onSave(): void;
}

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "var(--bg)", color: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--bg-subtle)", color: "var(--fg-muted)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
});

/** Markdown-friendly light syntax colors (CodeMirror's default underlines headings). */
const lightHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.15em", color: "#1f4fae" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.08em", color: "#1f4fae" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: "700", color: "#1f4fae" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "#0a6c74" },
  { tag: tags.monospace, color: "#b0306a" },
  { tag: tags.quote, color: "#57606a", fontStyle: "italic" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "#8c959f" },
  { tag: tags.list, color: "#9a6700" },
  { tag: tags.keyword, color: "#cf222e" },
  { tag: [tags.string, tags.special(tags.string)], color: "#0a3069" },
  { tag: [tags.number, tags.bool, tags.atom], color: "#0550ae" },
  { tag: tags.comment, color: "#6e7781", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "#8250df" },
  { tag: [tags.typeName, tags.className], color: "#953800" },
  { tag: tags.propertyName, color: "#0550ae" },
]);

const baseTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { padding: "16px 0 40vh" },
  ".cm-line": { padding: "0 16px" },
  "&.cm-focused": { outline: "none" },
});

/** Markdown source editor (CodeMirror 6) with a formatting toolbar. */
export class Editor {
  readonly element: HTMLElement;
  readonly view: EditorView;
  private themeSlot = new Compartment();
  private gutterSlot = new Compartment();
  private wrapSlot = new Compartment();
  private fontSlot = new Compartment();
  private suppressChange = false;
  private config = { dark: false, lineNumbers: true, wrap: true, fontSize: 14 };

  constructor(
    container: HTMLElement,
    private callbacks: EditorCallbacks,
  ) {
    const host = h("div", { class: "editor-host" });
    this.element = h("div", { class: "editor" }, this.buildToolbar(), host);
    container.append(this.element);
    this.view = new EditorView({ state: this.createState(""), parent: host });
    this.view.scrollDOM.addEventListener("scroll", () => this.callbacks.onScroll(), { passive: true });
  }

  private createState(doc: string): EditorState {
    return EditorState.create({ doc, extensions: this.buildExtensions() });
  }

  private buildExtensions(): Extension[] {
    const { dark, lineNumbers: showGutter, wrap, fontSize } = this.config;
    return [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (this.callbacks.onSave(), true) },
        { key: "Mod-b", preventDefault: true, run: () => this.wrap("**") },
        { key: "Mod-i", preventDefault: true, run: () => this.wrap("*") },
        { key: "Mod-k", preventDefault: true, run: () => this.insertLink() },
        { key: "Mod-`", preventDefault: true, run: () => this.wrap("`") },
        { key: "Mod-Shift-x", preventDefault: true, run: () => this.wrap("~~") },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      baseTheme,
      this.themeSlot.of(this.themeExtension(dark)),
      this.gutterSlot.of(this.gutters(showGutter)),
      this.wrapSlot.of(wrap ? EditorView.lineWrapping : []),
      this.fontSlot.of(this.fontTheme(fontSize)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.suppressChange) this.callbacks.onChange(update.state.doc.toString());
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          this.callbacks.onCursor(line.number, pos - line.from + 1);
        }
      }),
    ];
  }

  private themeExtension(dark: boolean): Extension {
    return dark ? oneDark : [lightTheme, syntaxHighlighting(lightHighlight)];
  }

  private gutters(show: boolean): Extension {
    return show ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [];
  }

  private fontTheme(size: number): Extension {
    return EditorView.theme({ ".cm-scroller": { fontSize: `${size}px` } });
  }

  private buildToolbar(): HTMLElement {
    const btn = (name: string, title: string, run: () => void) =>
      h("button", {
        class: "icon-btn",
        title,
        "aria-label": title,
        html: icon(name),
        onmousedown: ((e: MouseEvent) => e.preventDefault()) as EventListener,
        onclick: (() => {
          run();
          this.view.focus();
        }) as EventListener,
      });
    const sep = () => h("span", { class: "toolbar-sep" });
    return h(
      "div",
      { class: "editor-toolbar", role: "toolbar", "aria-label": "Formatting" },
      btn("bold", "Bold (Ctrl+B)", () => this.wrap("**")),
      btn("italic", "Italic (Ctrl+I)", () => this.wrap("*")),
      btn("strike", "Strikethrough (Ctrl+Shift+X)", () => this.wrap("~~")),
      btn("code", "Inline code (Ctrl+`)", () => this.wrap("`")),
      sep(),
      btn("heading", "Cycle heading level", () => this.cycleHeading()),
      btn("quote", "Blockquote", () => this.prefixLines("> ")),
      btn("listUl", "Bulleted list", () => this.prefixLines("- ")),
      btn("listOl", "Numbered list", () => this.prefixLines("1. ")),
      btn("listTask", "Task list", () => this.prefixLines("- [ ] ")),
      sep(),
      btn("link", "Link (Ctrl+K)", () => this.insertLink()),
      btn("image", "Image", () => this.insertSnippet("![alt text](", "path/to/image.png", ")")),
      btn("table", "Table", () => this.insertBlock("| Column | Column |\n| ------ | ------ |\n| Cell   | Cell   |")),
      btn("minus", "Horizontal rule", () => this.insertBlock("---")),
      sep(),
      btn("search", "Find and replace (Ctrl+F)", () => openSearchPanel(this.view)),
    );
  }

  // ---- Document ----

  getText(): string {
    return this.view.state.doc.toString();
  }

  /** Replaces the document without firing onChange. Keeps the cursor if possible. */
  setText(text: string, resetHistory = false): void {
    if (text === this.getText() && !resetHistory) return;
    this.suppressChange = true;
    try {
      if (resetHistory) {
        this.view.setState(this.createState(text));
        this.callbacks.onCursor(1, 1);
      } else {
        const head = Math.min(this.view.state.selection.main.head, text.length);
        this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, selection: { anchor: head } });
      }
    } finally {
      this.suppressChange = false;
    }
  }

  focus(): void {
    this.view.focus();
  }

  // ---- Settings ----

  setDark(dark: boolean): void {
    this.config.dark = dark;
    this.view.dispatch({ effects: this.themeSlot.reconfigure(this.themeExtension(dark)) });
  }
  setLineNumbers(show: boolean): void {
    this.config.lineNumbers = show;
    this.view.dispatch({ effects: this.gutterSlot.reconfigure(this.gutters(show)) });
  }
  setWrap(wrap: boolean): void {
    this.config.wrap = wrap;
    this.view.dispatch({ effects: this.wrapSlot.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }
  setFontSize(size: number): void {
    this.config.fontSize = size;
    this.view.dispatch({ effects: this.fontSlot.reconfigure(this.fontTheme(size)) });
  }

  // ---- Scroll sync ----

  /** The (fractional, 0-based) source line at the top of the editor viewport. */
  topLine(): number {
    const scroller = this.view.scrollDOM;
    const block = this.view.lineBlockAtHeight(scroller.scrollTop - this.view.documentPadding.top);
    const line = this.view.state.doc.lineAt(block.from).number - 1;
    const frac = block.height > 0 ? (scroller.scrollTop - this.view.documentPadding.top - block.top) / block.height : 0;
    return line + Math.min(Math.max(frac, 0), 1);
  }

  scrollToLine(line: number): void {
    const doc = this.view.state.doc;
    const whole = Math.max(0, Math.min(Math.floor(line), doc.lines - 1));
    const block = this.view.lineBlockAt(doc.line(whole + 1).from);
    this.view.scrollDOM.scrollTop = block.top + block.height * (line - whole) + this.view.documentPadding.top;
  }

  /** Moves the cursor to a 1-based line and centers it. */
  revealLine(lineNumber: number): void {
    const doc = this.view.state.doc;
    const line = doc.line(Math.max(1, Math.min(lineNumber, doc.lines)));
    this.view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
  }

  // ---- Formatting commands ----

  private wrap(marker: string): boolean {
    const { state } = this.view;
    this.view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to);
        const before = state.sliceDoc(range.from - marker.length, range.from);
        const after = state.sliceDoc(range.to, range.to + marker.length);
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - marker.length, to: range.from },
              { from: range.to, to: range.to + marker.length },
            ],
            range: EditorSelection.range(range.from - marker.length, range.to - marker.length),
          };
        }
        return {
          changes: { from: range.from, to: range.to, insert: `${marker}${text}${marker}` },
          range: EditorSelection.range(range.from + marker.length, range.to + marker.length),
        };
      }),
    );
    return true;
  }

  private prefixLines(prefix: string): void {
    const { state } = this.view;
    const changes: { from: number; insert?: string; to?: number }[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      for (let pos = range.from; pos <= range.to; ) {
        const line = state.doc.lineAt(pos);
        if (!seen.has(line.number)) {
          seen.add(line.number);
          if (line.text.startsWith(prefix)) changes.push({ from: line.from, to: line.from + prefix.length });
          else changes.push({ from: line.from, insert: prefix });
        }
        pos = line.to + 1;
      }
    }
    this.view.dispatch({ changes });
  }

  private cycleHeading(): void {
    const { state } = this.view;
    const line = state.doc.lineAt(state.selection.main.head);
    const match = /^(#{1,6})\s/.exec(line.text);
    const level = match ? match[1].length : 0;
    const next = level >= 6 ? "" : "#".repeat(level + 1) + " ";
    this.view.dispatch({ changes: { from: line.from, to: line.from + (match ? match[0].length : 0), insert: next } });
  }

  private insertLink(): boolean {
    const { state } = this.view;
    const range = state.selection.main;
    const text = state.sliceDoc(range.from, range.to) || "link text";
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;
    this.view.dispatch({ changes: { from: range.from, to: range.to, insert }, selection: EditorSelection.range(urlStart, urlStart + 3) });
    return true;
  }

  private insertSnippet(before: string, placeholder: string, after: string): void {
    const range = this.view.state.selection.main;
    const start = range.from + before.length;
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: before + placeholder + after },
      selection: EditorSelection.range(start, start + placeholder.length),
    });
  }

  private insertBlock(block: string): void {
    const { state } = this.view;
    const line = state.doc.lineAt(state.selection.main.head);
    const prefix = line.text.trim() ? "\n\n" : "";
    const insert = `${prefix}${block}\n`;
    const pos = line.text.trim() ? line.to : line.from;
    this.view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  }
}
