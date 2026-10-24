import { h } from "./dom";

let container: HTMLElement | null = null;

/** Short, non-blocking notification in the bottom-right corner. */
export function toast(message: string, kind: "info" | "error" | "success" = "info", ms = 3200): void {
  container ??= document.body.appendChild(h("div", { class: "toasts", role: "status", "aria-live": "polite" }));
  const el = h("div", { class: `toast toast-${kind}` }, message);
  container.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, kind === "error" ? Math.max(ms, 6000) : ms);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
