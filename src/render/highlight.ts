import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import githubLight from "shiki/themes/github-light.mjs";
import githubDark from "shiki/themes/github-dark.mjs";

// Shiki with the JavaScript regex engine (no WASM, so the CSP stays strict).
// Languages load on demand: call ensureLanguages() with a document's fence languages
// before rendering, then highlightCode() runs synchronously inside markdown-it.

const LANGS = bundledLanguages as Record<string, (typeof bundledLanguages)[keyof typeof bundledLanguages]>;

let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
const failedLanguages = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).then((h) => (highlighter = h));
  return highlighterPromise;
}

export function normalizeLanguage(lang: string): string {
  return lang.trim().toLowerCase().split(/[\s{]/)[0] ?? "";
}

export function isKnownLanguage(lang: string): boolean {
  return Object.prototype.hasOwnProperty.call(LANGS, normalizeLanguage(lang));
}

/** Loads every listed language Shiki knows about; unknown ones are ignored. */
export async function ensureLanguages(langs: Iterable<string>): Promise<void> {
  const h = await getHighlighter();
  const loaded = new Set(h.getLoadedLanguages());
  const pending = [...new Set([...langs].map(normalizeLanguage))].filter(
    (l) => l && isKnownLanguage(l) && !loaded.has(l) && !failedLanguages.has(l),
  );
  await Promise.all(
    pending.map(async (l) => {
      try {
        await h.loadLanguage(LANGS[l]);
      } catch (err) {
        failedLanguages.add(l);
        console.warn(`[highlight] could not load ${l}`, err);
      }
    }),
  );
}

/** Highlighted `<pre>` HTML, or null when the language is not loaded. */
export function highlightCode(code: string, lang: string): string | null {
  const l = normalizeLanguage(lang);
  if (!highlighter || !l || !highlighter.getLoadedLanguages().includes(l)) return null;
  try {
    return highlighter.codeToHtml(code, {
      lang: l,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
  } catch {
    return null;
  }
}
