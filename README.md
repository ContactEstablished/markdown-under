# Markdown Under

A local, private Markdown reader **and** editor for Windows, built with Tauri 2.
It started as a personal replacement for the free tier of the
[Markdown Reader](https://md-reader.github.io/) browser extension, and adds the things
that extension doesn't do: folders, search, editing and export.

Nothing leaves your machine. There are no accounts, no telemetry and no network calls,
except for remote images that your documents link to.

## Features

| | Markdown Reader (free) | Markdown Under |
|---|---|---|
| Render `.md` / `.markdown` / `.mdx` | ✅ | ✅ |
| GFM tables, task lists, footnotes, emoji | ✅ | ✅ |
| KaTeX math, Mermaid diagrams | ✅ | ✅ |
| Syntax highlighting | ✅ | ✅ (Shiki, 200+ languages, loaded on demand) |
| GitHub alerts (`> [!NOTE]`) | ✅ | ✅ |
| Light / dark / custom CSS themes | ✅ | ✅ (themes folder) |
| Table of contents sidebar | ✅ | ✅ with scroll-spy, plus inline `[[_TOC_]]` |
| Live reload | polling interval | instant (OS file watcher), keeps scroll position |
| Folder browser + relative link navigation | — | ✅ with Back/Forward history |
| Full-text search across a folder | — | ✅ |
| Find in document | — | ✅ |
| Split-pane editor (source left, preview right) | — | ✅ with synced scrolling |
| Click task checkboxes to update the file | — | ✅ |
| Export to PDF and standalone HTML | — | ✅ |
| YAML front matter display | — | ✅ |
| Opens `.md` files from Explorer / command line | — | ✅ |
| Unsaved-change and external-change protection | — | ✅ |

Also supported: `==highlight==`, `++insert++`, `H~2~O`, `x^2^`, abbreviations,
definition lists, raw HTML (sanitized), copy buttons on code blocks.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open file / folder | `Ctrl+O` / `Ctrl+Shift+O` |
| New file | `Ctrl+N` |
| Save / Save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Read / Split / Edit mode | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| Toggle read ↔ split | `Ctrl+E` |
| Find in document | `Ctrl+F` (in the editor: find & replace) |
| Search folder | `Ctrl+Shift+F` |
| Toggle sidebar | `Ctrl+\` |
| Back / Forward | `Alt+←` / `Alt+→` (or mouse side buttons) |
| Zoom text | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Print / Save as PDF | `Ctrl+P` |
| Export HTML | `Ctrl+Shift+E` |
| Toggle light/dark | `Ctrl+Shift+L` |
| Reload from disk | `F5` / `Ctrl+R` |
| Settings | `Ctrl+,` |
| Editor: bold / italic / link / code / strike | `Ctrl+B` / `Ctrl+I` / `Ctrl+K` / ``Ctrl+` `` / `Ctrl+Shift+X` |

## Custom themes

Open **Settings → Themes folder**. Every `.css` file there shows up under
**Custom theme** and is layered over the built-in light/dark styles. An `example.css`
is created for you. Scope rules to `.markdown-body` to style only the document.

## Development

Prerequisites: Node 20+, Rust (stable), and WebView2 (preinstalled on Windows 11).

```powershell
npm install
npm run tauri dev      # desktop app with hot reload
npm run dev            # UI only, in a browser, on an in-memory demo folder (http://localhost:1420)
npm test               # frontend unit tests (vitest)
cd src-tauri; cargo test   # backend unit tests
npm run tauri build    # release build + installers in src-tauri/target/release/bundle
```

The browser mode (`npm run dev`) uses a fake in-memory file system with a few demo
documents, which makes UI work fast. Open `http://localhost:1420/?open=/demo/showcase.md`
to jump straight to the feature showcase. [`samples/showcase.md`](samples/showcase.md)
exercises every supported syntax feature.

### Layout

```
src/
  app.ts               App controller: documents, folders, modes, saving, watching, shortcuts
  backend/             Host abstraction: tauri.ts (desktop) and browser.ts (in-memory demo)
  render/              markdown-it pipeline, KaTeX plugin, Shiki highlighting, Mermaid, sanitizer
  ui/                  Preview, editor (CodeMirror 6), sidebar, find bar, settings, export
  lib/                 Path and text helpers (unit tested)
  styles/              tokens.css (theme colors), markdown.css (document), app.css (chrome)
src-tauri/src/
  lib.rs               Tauri commands and app setup (single instance, plugins)
  fs_ops.rs            Read/atomic write, Markdown tree, folder search
  watcher.rs           File/folder watching (notify) → "fs-change" events
  themes.rs            Custom theme folder
```

### Security notes

Documents can contain raw HTML, so rendered output is sanitized with DOMPurify before it
reaches the page (scripts, iframes, forms, `<style>` and `<link>` are removed), Mermaid
runs in `strict` mode, and the app ships with a restrictive Content Security Policy.
Local images load through Tauri's asset protocol.
