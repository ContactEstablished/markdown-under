import { h, icon } from "./dom";

const ALL = "mu-find";
const CURRENT = "mu-find-current";

/**
 * Find-in-document for the rendered preview. Matches are painted with the CSS Custom
 * Highlight API, so the rendered DOM is never modified.
 */
export class FindBar {
  readonly element: HTMLElement;
  private input: HTMLInputElement;
  private count: HTMLElement;
  private caseBtn: HTMLButtonElement;
  private ranges: Range[] = [];
  private index = -1;
  private caseSensitive = false;

  constructor(
    container: HTMLElement,
    private root: HTMLElement,
    private scroller: HTMLElement,
  ) {
    this.input = h("input", { type: "search", class: "find-input", placeholder: "Find in document", spellcheck: "false", "aria-label": "Find in document" });
    this.count = h("span", { class: "find-count", "aria-live": "polite" });
    this.caseBtn = h("button", {
      class: "icon-btn toggle",
      title: "Match case",
      "aria-pressed": "false",
      html: icon("caseSensitive"),
      onclick: () => {
        this.caseSensitive = !this.caseSensitive;
        this.caseBtn.setAttribute("aria-pressed", String(this.caseSensitive));
        this.search(true);
      },
    });
    this.element = h(
      "div",
      { class: "findbar", hidden: true, role: "search" },
      h("span", { class: "find-icon", html: icon("search", 14) }),
      this.input,
      this.count,
      this.caseBtn,
      h("button", { class: "icon-btn", title: "Previous (Shift+Enter)", html: icon("arrowUp"), onclick: () => this.step(-1) }),
      h("button", { class: "icon-btn", title: "Next (Enter)", html: icon("arrowDown"), onclick: () => this.step(1) }),
      h("button", { class: "icon-btn", title: "Close (Esc)", html: icon("x"), onclick: () => this.close() }),
    );
    container.append(this.element);

    this.input.addEventListener("input", () => this.search(true));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(prefill?: string, line?: number): void {
    this.element.hidden = false;
    if (prefill !== undefined) this.input.value = prefill;
    this.input.focus();
    this.input.select();
    this.search(true, line);
  }

  close(): void {
    this.element.hidden = true;
    this.clearHighlights();
    this.ranges = [];
    this.count.textContent = "";
  }

  /** Re-runs the current query after the document re-renders, keeping the position. */
  refresh(): void {
    if (this.isOpen && this.input.value) this.search(false);
  }

  private search(jump: boolean, nearLine?: number): void {
    const query = this.input.value;
    this.clearHighlights();
    this.ranges = query ? this.findRanges(query) : [];
    if (this.ranges.length === 0) {
      this.index = -1;
      this.count.textContent = query ? "No results" : "";
      return;
    }
    if (nearLine !== undefined) {
      const idx = this.ranges.findIndex((r) => {
        const block = (r.startContainer.parentElement as HTMLElement | null)?.closest("[data-line]");
        return block !== null && block !== undefined && Number(block.getAttribute("data-line")) >= nearLine - 1;
      });
      this.index = idx >= 0 ? idx : 0;
    } else if (jump || this.index < 0 || this.index >= this.ranges.length) {
      this.index = this.firstVisibleIndex();
    }
    this.paint(jump || nearLine !== undefined);
  }

  private step(delta: number): void {
    if (this.ranges.length === 0) return;
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.paint(true);
  }

  private paint(scroll: boolean): void {
    this.count.textContent = `${this.index + 1} of ${this.ranges.length}`;
    if (typeof Highlight !== "undefined" && CSS.highlights) {
      CSS.highlights.set(ALL, new Highlight(...this.ranges));
      CSS.highlights.set(CURRENT, new Highlight(this.ranges[this.index]));
    }
    if (scroll) {
      const rect = this.ranges[this.index].getBoundingClientRect();
      const box = this.scroller.getBoundingClientRect();
      if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
        this.scroller.scrollTop += rect.top - box.top - box.height / 3;
      }
    }
  }

  private firstVisibleIndex(): number {
    const top = this.scroller.getBoundingClientRect().top;
    const idx = this.ranges.findIndex((r) => r.getBoundingClientRect().top >= top);
    return idx >= 0 ? idx : 0;
  }

  private findRanges(query: string): Range[] {
    const needle = this.caseSensitive ? query : query.toLowerCase();
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || parent.closest("svg, .katex-mathml, .copy-code, .code-lang")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = this.caseSensitive ? node.textContent ?? "" : (node.textContent ?? "").toLowerCase();
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        ranges.push(range);
        if (ranges.length >= 5000) return ranges;
      }
    }
    return ranges;
  }

  private clearHighlights(): void {
    if (typeof Highlight !== "undefined" && CSS.highlights) {
      CSS.highlights.delete(ALL);
      CSS.highlights.delete(CURRENT);
    }
  }
}
