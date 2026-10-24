import { resolve } from "node:path";
import { defineConfig } from "vite";

// Builds the Chrome extension into extension/dist (load that folder unpacked).
export default defineConfig({
  root: __dirname,
  base: "/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, "src/viewer.ts"),
        background: resolve(__dirname, "src/background.ts"),
        options: resolve(__dirname, "options.html"),
      },
      // viewer.js is imported by the content script, so it keeps its exports and a fixed name.
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: (chunk) => (chunk.name === "viewer" || chunk.name === "background" ? "[name].js" : "assets/[name]-[hash].js"),
      },
    },
  },
  // Chunks load into file:// and web pages, so their URLs must point at the extension itself.
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === "js") return { runtime: `chrome.runtime.getURL(${JSON.stringify(filename)})` };
      return { relative: true };
    },
  },
});
