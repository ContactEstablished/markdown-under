# Chrome Web Store listing kit

Everything needed to fill in the Chrome Web Store developer dashboard for Markdown Under.
Copy the text blocks as-is; the store description field is plain text (no Markdown).

## Store listing tab

**Category:** Developer Tools (Productivity is a reasonable alternative; most Markdown
viewers list under Developer Tools).
**Language:** English

### Description

```text
Markdown Under turns Markdown files into clean, readable pages, right inside Chrome.

Open a README, your notes or any .md file and, instead of a wall of plain text, you get proper headings, tables, highlighted code, math and diagrams, with an outline of the document alongside. Nothing to click, no account, no uploads. Your files never leave your computer.

WHAT IT RENDERS
• Everything in GitHub-flavoured Markdown: headings, lists, tables, task lists, links, images, blockquotes and footnotes
• GitHub-style alerts: Note, Tip, Important, Warning and Caution boxes
• Syntax highlighting for 200+ programming languages, with a copy button on every code block
• Math written in LaTeX ($...$ inline and $$...$$ blocks), beautifully typeset with KaTeX
• Mermaid diagrams: flowcharts, sequence, class and state diagrams, Gantt charts and more
• Emoji shortcodes like :kangaroo:, highlighted and inserted text, subscript, superscript, abbreviations and definition lists
• YAML front matter, shown as a tidy collapsible table
• [[_TOC_]] or [TOC] to drop a table of contents into the page

MADE FOR READING
• An outline sidebar that follows your scroll and jumps to any heading
• Live reload: edit a file on your computer in your favourite editor and the page updates within a second, keeping your place
• Links between Markdown files just work, including links to a heading in another file
• Light, dark or match-your-system theme
• Choose sans-serif or serif text, text size and page width
• View the original Markdown source with one click
• Print or save as PDF with a clean, print-friendly layout

WORKS WITH
• Markdown files on your computer
• Raw Markdown files on the web, such as raw.githubusercontent.com links
• Files ending in .md, .markdown, .mdx, .mkd, .mdown and .mkdn

PRIVATE BY DESIGN
Markdown Under collects no data, has no analytics and makes no network requests of its own. Your settings are kept in Chrome's own storage. Documents are cleaned before they are shown, so scripts hidden inside a Markdown file can't run. (Images that a document links to on the web load just as they would on any web page.)

GETTING STARTED
1. Add Markdown Under to Chrome.
2. To read files on your computer, open chrome://extensions, click Details under Markdown Under and turn on "Allow access to file URLs". Chrome asks you to switch this on yourself.
3. Drag a .md file into Chrome, or press Ctrl+O (Cmd+O on a Mac) and open one.
4. Click the Markdown Under icon in the toolbar to change the theme, font and other settings.

WANT TO EDIT TOO? GET THE DESKTOP APP
Markdown Under also comes as a free desktop app for Windows that does everything this extension does, plus:
• A side-by-side editor: write Markdown on the left and see the formatted page on the right as you type
• A folder sidebar for browsing all your notes, with search across every file
• Clickable checklists that update the file
• Export to a standalone HTML page
Get it here: https://github.com/ContactEstablished/markdown-under

WHY "MARKDOWN UNDER"?
Because Markdown should look good everywhere, even Down Under. The icon is two boomerangs making an M, and like a good boomerang, your files always come back looking better.

Markdown Under is free and open source: https://github.com/ContactEstablished/markdown-under
Feedback and bug reports are very welcome there.
```

### Graphic assets (all in `store/assets/`)

| Dashboard field | File | Size |
|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 (96px artwork + 16px transparent padding, per Google's guidelines) |
| Screenshot 1 | `screenshot-1-rendered.png` | 1280×800 |
| Screenshot 2 | `screenshot-2-code.png` | 1280×800 |
| Screenshot 3 | `screenshot-3-math-diagrams.png` | 1280×800 |
| Screenshot 4 | `screenshot-4-settings.png` | 1280×800 |
| Screenshot 5 | `screenshot-5-before-after.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile | `promo-marquee-1400x560.png` | 1400×560 |
| Global promo video | YouTube URL, see the video script below | |

Upload the screenshots in the order above; the first one is what people see first.
The screenshots use the demo documents in `store/demo/`.

**Official URL / homepage:** `https://github.com/ContactEstablished/markdown-under`
**Support URL:** `https://github.com/ContactEstablished/markdown-under/issues`

## Privacy tab

**Single purpose description**

```text
Markdown Under displays Markdown (.md) files as formatted, readable pages in Chrome, with an outline, themes and live reload.
```

**Permission justifications**

`storage`:
```text
Saves the user's display preferences (theme, font, text size, page width, outline, live reload and whether to format Markdown files on websites). No document content or personal data is stored.
```

Host permission (the content script runs on `.md` URLs):
```text
The content script only runs on URLs ending in .md, .markdown, .mdx, .mkd, .mdown or .mkdn, on the user's computer (file://) and on websites (http/https). It checks whether the page is a plain-text Markdown file and, if so, replaces it with a formatted view. It does not run on any other pages and does not read or send page content anywhere.
```

**Are you using remote code?** No, I am not using remote code.
```text
All scripts, styles and fonts are bundled in the extension package. Nothing is loaded from external servers.
```

**Data usage:** tick none of the data types. Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:**
`https://github.com/ContactEstablished/markdown-under/blob/main/PRIVACY.md`

## Test instructions tab (for the reviewer)

```text
No account or login is needed.

1. Open this raw Markdown file in a tab: https://raw.githubusercontent.com/ContactEstablished/markdown-under/main/store/demo/outback-road-trip.md
   It is shown as a formatted page with an outline on the left, a table, alerts, a task list, math and a diagram.
2. The toolbar in the top-right corner toggles the outline, cycles the theme (system/light/dark), shows the original source and opens print.
3. Click the extension's toolbar icon to open settings; changes apply to open pages immediately.
4. Optional, for local files: enable "Allow access to file URLs" for the extension, download the same file and open it from disk. Editing and saving the file updates the page within about a second (live reload).
```

---

## YouTube promo video script

**Length:** about 60 seconds. **Format:** 1920×1080, 30 fps. **Music:** an upbeat,
royalty-free acoustic or light electronic track (the YouTube Audio Library has plenty).
A didgeridoo or clapstick sting at the start and end is a fun "Down Under" touch.

AI video tools (Seedance, Sora, Veo, Runway and so on) are great for the cinematic intro
and outro, but they can't show the real extension accurately. Record the product scenes
with a screen recorder (Windows' Snipping Tool and Clipchamp both record and edit; OBS
Studio is free), and edit everything together in Clipchamp, CapCut or DaVinci Resolve.

**Scenes 2–9 are already recorded by script:** `npm run video:record` writes them to
`store/video/out/`. `store/video/CAPCUT.md` lists every caption, voice line and timing for
putting the video together in CapCut.

| # | Time | Visual | Voice-over | On-screen text |
|---|------|--------|------------|----------------|
| 1 | 0:00–0:05 | **AI clip.** Golden-hour outback: red earth, a boomerang spinning through the air towards the camera. | (music sting) | |
| 2 | 0:05–0:09 | **Motion graphic.** The boomerang becomes the two-boomerang "M" icon; the "Markdown Under" wordmark slides in. | "Meet Markdown Under." | Markdown Under |
| 3 | 0:09–0:15 | **Screen recording.** A raw `.md` file in Chrome: a grey wall of plain text with pipes, hashes and dollar signs. Scroll slowly. | "Markdown files are meant to be read, but in a browser they look like this." | |
| 4 | 0:15–0:22 | **Screen recording.** Same file, extension on: it snaps into a formatted page. (Record with the extension on, then cut the two clips together with a quick crossfade or a wipe.) | "Markdown Under turns them into clean, readable pages, automatically." | Nothing to click |
| 5 | 0:22–0:30 | **Screen recording.** Scroll `outback-road-trip.md`: table, Tip and Warning alerts, task list. Click "Fuel maths" in the outline to jump. | "Tables, checklists, alerts and an outline that follows you as you read…" | Outline that follows your scroll |
| 6 | 0:30–0:37 | **Screen recording.** Open `boomerang-api.md` in dark mode: highlighted TypeScript, then the sequence diagram. | "…code highlighting for over two hundred languages, plus math and diagrams, built in." | 200+ languages · Math · Diagrams |
| 7 | 0:37–0:45 | **Screen recording, split screen.** Left: a text editor (VS Code or Notepad) with the file. Right: Chrome. Type a new line and save; the page updates by itself. | "Editing locally? Save the file and the page updates instantly." | Live reload |
| 8 | 0:45–0:51 | **Screen recording.** Click the toolbar icon, switch the theme light ↔ dark, drag the text size slider. | "Light or dark, serif or sans, your page, your way." | |
| 9 | 0:51–0:56 | **Motion graphic.** Padlock icon over the page. | "And it's private. No accounts, no tracking. Your files never leave your computer." | Free · Private · Open source |
| 10 | 0:56–1:00 | **AI clip + end card.** Boomerang returns into a hand at sunset, cut to the icon and "Add to Chrome" button graphic. | "Markdown Under. Your Markdown always comes back looking better." | Available on the Chrome Web Store |

### AI video prompts (scenes 1 and 10)

Scene 1:
```text
Cinematic slow-motion shot in the Australian outback at golden hour. Red desert earth, spinifex grass and a distant rock formation on the horizon. A wooden boomerang decorated with ochre dot patterns spins through the air towards the camera, sunlight flaring through it. Warm orange and gold tones, shallow depth of field, smooth camera, no people, no text.
```

Scene 10:
```text
Cinematic slow motion at sunset in the Australian outback. A wooden boomerang with ochre and terracotta dot patterns curves through a deep blue and orange sky and is caught cleanly by an outstretched hand in the foreground. Silhouetted red rock formation on the horizon, warm lens flare, calm and satisfying. No text, no faces.
```

### Recording checklist

- Use the demo files in `store/demo/`, which match the screenshots.
- Use a clean Chrome profile: no bookmarks bar, no other extensions pinned, zoom at 100%.
- Record at 1920×1080. Before recording, drag the window to fill the screen and hide the Windows taskbar.
- Move the mouse slowly and pause for a beat after each action, so viewers can follow.
- Turn on "Allow access to file URLs" before recording the local-file and live-reload scenes.

### YouTube upload details

**Title:** Markdown Under: beautiful Markdown in Chrome
**Description:**
```text
Markdown Under is a free Chrome extension that turns Markdown (.md) files into clean, readable pages, with tables, code highlighting, math, diagrams, an outline sidebar and live reload. Private by design: no accounts, no tracking, your files never leave your computer.

Get it on the Chrome Web Store: <store link>
Source code: https://github.com/ContactEstablished/markdown-under
```
**Visibility:** Public or Unlisted. The Web Store only needs a working YouTube URL.
