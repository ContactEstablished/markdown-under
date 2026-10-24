// Pure text helpers for Markdown source.

/** Approximate prose word count: ignores front matter, code fences and markup symbols. */
export function countWords(src: string): number {
  const body = src
    .replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\s*(\r?\n|$)/, "")
    .replace(/^(```|~~~)[\s\S]*?^\1/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|=+\-[\]()]/g, " ");
  return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;
}

const TASK_PATTERN = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

/**
 * Sets the task checkbox on source line `line` (0-based) to `checked`.
 * Returns the updated text, or null when that line has no task marker.
 */
export function toggleTaskAt(src: string, line: number, checked: boolean): string | null {
  const lines = src.split("\n");
  const text = lines[line];
  if (text === undefined || !TASK_PATTERN.test(text)) return null;
  lines[line] = text.replace(TASK_PATTERN, `$1[${checked ? "x" : " "}]`);
  return lines.join("\n");
}
