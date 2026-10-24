import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import katex from "katex";

// TeX math via KaTeX: `$inline$` and `$$ display $$` blocks (pandoc-style delimiters).
// An inline opener must not be followed by whitespace, a closer must not be preceded by
// whitespace or followed by a digit, so "$5 and $10" stays plain text.

function renderTex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: "htmlAndMathml" });
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src[start] !== "$" || src[start + 1] === "$") return false;
  const first = src[start + 1];
  if (first === undefined || /\s/.test(first)) return false;

  let end = start + 1;
  while ((end = src.indexOf("$", end)) !== -1) {
    // Skip escaped dollars.
    let backslashes = 0;
    for (let i = end - 1; src[i] === "\\"; i--) backslashes++;
    if (backslashes % 2 === 0) break;
    end++;
  }
  if (end === -1) return false;
  if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? "")) return false;

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.markup = "$";
    token.content = src.slice(start + 1, end);
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  pos += 2;

  let firstLine = state.src.slice(pos, max);
  let lastLine = "";
  let next = startLine;
  let found = false;

  if (firstLine.trim().endsWith("$$")) {
    // Single-line form: $$ x^2 $$
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  while (!found) {
    next++;
    if (next >= endLine) break;
    pos = state.bMarks[next] + state.tShift[next];
    max = state.eMarks[next];
    if (pos < max && state.tShift[next] < state.blkIndent) break;
    const line = state.src.slice(pos, max);
    if (line.trim().endsWith("$$")) {
      lastLine = line.trim().slice(0, -2);
      found = true;
    }
  }
  if (!found) return false;
  if (silent) return true;

  state.line = next + 1;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.markup = "$$";
  token.map = [startLine, state.line];
  const middle = next > startLine + 1 ? state.getLines(startLine + 1, next, state.tShift[startLine], true) : "";
  token.content = [firstLine, middle, lastLine].filter((s) => s.trim() !== "").join("\n");
  return true;
}

export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.after("escape", "math_inline", mathInline);
  md.block.ruler.after("blockquote", "math_block", mathBlock, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.renderer.rules.math_inline = (tokens, idx) => renderTex(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) => {
    const line = tokens[idx].map?.[0];
    const attr = line === undefined ? "" : ` data-line="${line}"`;
    return `<div class="math-block"${attr}>${renderTex(tokens[idx].content, true)}</div>\n`;
  };
}
