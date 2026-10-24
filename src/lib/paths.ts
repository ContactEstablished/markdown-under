// Path helpers that work on both Windows ("C:\a\b.md") and POSIX ("/a/b.md") paths.
// Paths keep the separator style of their input so they round-trip to the backend.

const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx", "mkd", "mdown", "mkdn"];

export function separatorOf(path: string): "\\" | "/" {
  return /^[a-zA-Z]:\\|^\\\\/.test(path) || (path.includes("\\") && !path.includes("/")) ? "\\" : "/";
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx < 0) return "";
  if (idx === 0) return path[0];
  // Keep the trailing separator for drive roots ("C:\").
  if (idx === 2 && /^[a-zA-Z]:/.test(path)) return path.slice(0, 3);
  return path.slice(0, idx);
}

export function extname(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(extname(path));
}

/** True for "C:\x", "C:/x", "\\server\share", and "/x". */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

/** True for anything with a URL scheme (http:, mailto:, data:) but not a drive letter. */
export function hasUrlScheme(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(href) && !/^[a-zA-Z]:[\\/]/.test(href);
}

/**
 * Resolves `relative` (a link or image target from a document) against `baseDir`,
 * collapsing "." and ".." segments. Percent-escapes are decoded.
 */
export function resolvePath(baseDir: string, relative: string): string {
  let rel = relative;
  try {
    rel = decodeURIComponent(relative);
  } catch {
    // Leave malformed escapes as-is.
  }
  const sep = separatorOf(baseDir || rel);
  if (rel.startsWith("file://")) {
    rel = rel.slice(7);
    // file:///C:/x -> C:/x, but file:///etc/x -> /etc/x
    if (/^\/[a-zA-Z]:/.test(rel)) rel = rel.slice(1);
  }
  const combined = isAbsolutePath(rel) ? rel : `${baseDir}${sep}${rel}`;

  const uncPrefix = combined.startsWith("\\\\") ? "\\\\" : "";
  const parts = combined.slice(uncPrefix.length).split(/[\\/]+/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === "." || (part === "" && out.length > 0)) continue;
    if (part === "..") {
      if (out.length > 1 || (out.length === 1 && out[0] !== "" && !/^[a-zA-Z]:$/.test(out[0]))) out.pop();
      continue;
    }
    out.push(part);
  }
  let joined = out.join(sep);
  if (/^[a-zA-Z]:$/.test(joined)) joined += sep;
  return uncPrefix + joined;
}

/** Splits "doc.md#heading" into ["doc.md", "heading"]. */
export function splitHash(href: string): [string, string] {
  const idx = href.indexOf("#");
  if (idx < 0) return [href, ""];
  return [href.slice(0, idx), href.slice(idx + 1)];
}

/** Case- and separator-insensitive on Windows-style paths. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeForCompare(a) === normalizeForCompare(b);
}

export function normalizeForCompare(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:/.test(unified) || path.includes("\\") ? unified.toLowerCase() : unified;
}

/** True when `path` is `folder` or lies inside it. */
export function isInside(path: string, folder: string): boolean {
  const p = normalizeForCompare(path);
  const f = normalizeForCompare(folder);
  return p === f || p.startsWith(f + "/");
}

/** `path` relative to `folder` with forward slashes, or the full path when outside it. */
export function relativeTo(path: string, folder: string | null): string {
  if (!folder || !isInside(path, folder)) return path;
  return path.replace(/\\/g, "/").slice(folder.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);
}
