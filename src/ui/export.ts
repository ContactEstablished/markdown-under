import tokensCss from "../styles/tokens.css?inline";
import markdownCss from "../styles/markdown.css?inline";
import katexCss from "katex/dist/katex.min.css?inline";
import katexPkg from "katex/package.json";
import { escapeHtml } from "./dom";

const KATEX_FONTS = `https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist/fonts/`;

/**
 * Points KaTeX font URLs at the CDN. Vite rewrites them (to /node_modules/... in dev and to
 * hashed /assets/KaTeX_Main-Regular-AbC123xy.woff2 in builds), so match on the file name.
 */
export function rewriteKatexFonts(css: string): string {
  return css.replace(
    /url\((['"]?)[^)'"]*?(KaTeX_[A-Za-z0-9_-]+?)(?:-[A-Za-z0-9_-]{8})?\.(woff2|woff|ttf)\1\)/g,
    (_m, quote: string, name: string, ext: string) => `url(${quote}${KATEX_FONTS}${name}.${ext}${quote})`,
  );
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * A self-contained HTML page for the rendered document: styles inlined, local images
 * embedded as data URLs, diagrams kept as inline SVG. KaTeX fonts load from a CDN.
 */
export async function buildStandaloneHtml(article: HTMLElement, title: string, theme: "light" | "dark", customCss: string): Promise<string> {
  const clone = article.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".copy-code, .code-lang, .mermaid-source").forEach((el) => el.remove());
  clone.querySelectorAll("[data-line]").forEach((el) => el.removeAttribute("data-line"));
  clone.querySelectorAll("input.task-list-item-checkbox").forEach((el) => el.setAttribute("disabled", ""));
  clone.querySelectorAll(".flash").forEach((el) => el.classList.remove("flash"));

  await Promise.all(
    Array.from(clone.querySelectorAll<HTMLImageElement>("img[data-local-path]")).map(async (img) => {
      const data = await toDataUrl(img.src);
      if (data) img.src = data;
      img.removeAttribute("data-local-path");
      img.removeAttribute("loading");
    }),
  );

  const katex = rewriteKatexFonts(katexCss);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Markdown Under">
<title>${escapeHtml(title)}</title>
<style>
${tokensCss}
${katex}
${markdownCss}
body { margin: 0; background: var(--bg); color: var(--fg); }
.markdown-body { max-width: 860px; margin: 0 auto; padding: 48px 32px 96px; }
${customCss}
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>
`;
}
