import type { Backend } from "./types";

export type * from "./types";

/** Picks the Tauri backend inside the desktop app, the in-memory demo elsewhere. */
export async function createBackend(): Promise<Backend> {
  if ("__TAURI_INTERNALS__" in window) {
    const { TauriBackend } = await import("./tauri");
    return new TauriBackend();
  }
  const { BrowserBackend } = await import("./browser");
  return new BrowserBackend();
}
