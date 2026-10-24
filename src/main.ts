import "katex/dist/katex.min.css";
import "./styles/tokens.css";
import "./styles/markdown.css";
import "./styles/app.css";
import { createBackend } from "./backend";
import { App } from "./app";

async function start(): Promise<void> {
  const backend = await createBackend();
  const mount = document.getElementById("app");
  if (!mount) throw new Error("Missing #app mount point");
  const app = new App(backend, mount);
  if (import.meta.env.DEV) Object.assign(window, { __mu: { app, backend } });

  const initial = await backend.takeInitialPath();
  if (initial) await app.openPath(initial.path);
  else await app.restoreSession();
}

// Block the webview's own reload/context-menu behaviour so state isn't lost by accident.
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest("input, textarea, .cm-editor, .markdown-body")) e.preventDefault();
});

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Markdown Under failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
