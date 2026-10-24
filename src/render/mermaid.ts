import type { Mermaid } from "mermaid";

// Mermaid is large, so it loads on first use. Renders are cached by (theme, source) so
// re-rendering a document while typing doesn't redraw untouched diagrams, and they run
// one at a time because mermaid.render() is not safe to call concurrently.

let mermaidPromise: Promise<Mermaid> | null = null;
let currentTheme: "light" | "dark" | null = null;
const cache = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

async function ready(theme: "light" | "dark"): Promise<Mermaid> {
  const mermaid = await loadMermaid();
  if (currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      fontFamily: "inherit",
    });
    currentTheme = theme;
  }
  return mermaid;
}

export function renderMermaid(source: string, theme: "light" | "dark"): Promise<string> {
  const key = `${theme}\u0000${source}`;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const job = queue.then(async () => {
    const mermaid = await ready(theme);
    const { svg } = await mermaid.render(`mu-mermaid-${++counter}`, source);
    if (cache.size > 200) cache.clear();
    cache.set(key, svg);
    return svg;
  });
  queue = job.catch(() => undefined);
  return job;
}
