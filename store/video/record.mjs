// Records the product scenes (2-9) of the promo video, frame by frame, with Playwright.
// Usage: npm run ext:build && node store/video/record.mjs [scene numbers...]
// Output: store/video/out/scene-N-*.mp4 (1920x1080, 30 fps) and all-scenes.mp4.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(HERE, "out");
const WORK = path.join(HERE, "work");
const EXT = path.join(ROOT, "extension/dist");
const FPS = 30;
const DSF = 1.25;
const CHROME = process.env.CHROME || path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright/chromium-1243/chrome-win64/chrome.exe");
const SHOWN_DIR = "C:/Notes/";
const DEFAULTS = { theme: "system", fontSize: 16, contentWidth: 860, fontFamily: "sans", showOutline: true, liveReload: true, renderRemote: true };
const ONE = { x: 160, y: 46, w: 1600, h: 900 };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (name) => pathToFileURL(path.join(WORK, name)).href;

class Clip {
  constructor(name) {
    this.file = path.join(OUT, `${name}.mp4`);
    this.frames = 0;
    this.ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", this.file], { stdio: ["pipe", "inherit", "inherit"] });
    this.done = new Promise((res, rej) => this.ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  }
  async write(buf, n = 1) {
    for (let i = 0; i < n; i++) {
      this.frames++;
      if (!this.ff.stdin.write(buf)) await once(this.ff.stdin, "drain");
    }
  }
  async close() {
    this.ff.stdin.end();
    await this.done;
    console.log(`  ${path.basename(this.file)}: ${this.frames} frames (${(this.frames / FPS).toFixed(2)} s)`);
  }
}

// ---------- browser setup ----------
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
for (const f of ["outback-road-trip.md", "boomerang-api.md"]) fs.copyFileSync(path.join(ROOT, "store/demo", f), path.join(WORK, f));
// Chrome shows a .txt file as plain text, which is exactly what a .md file looks like without the extension.
fs.copyFileSync(path.join(ROOT, "store/demo/outback-road-trip.md"), path.join(WORK, "outback-road-trip.txt"));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mu-video-"));
const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--hide-scrollbars", "--font-render-hinting=none"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;

const setup = await ctx.newPage();
await setup.goto(`chrome://extensions/?id=${extId}`);
await setup.evaluate((id) => new Promise((r) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, fileAccess: true }, r)), extId);
await setup.close();

const stage = ctx.pages()[0] ?? (await ctx.newPage());
const stageCdp = await ctx.newCDPSession(stage);
const doc = await ctx.newPage();
const docCdp = await ctx.newCDPSession(doc);
const pop = await ctx.newPage();
const popCdp = await ctx.newCDPSession(pop);

async function metrics(cdp, w, h) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: DSF, mobile: false });
}
async function grab(cdp) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  return `data:image/png;base64,${r.data}`;
}
async function settings(patch = {}) {
  await sw.evaluate((s) => chrome.storage.sync.set(s), { ...DEFAULTS, ...patch });
  await sleep(300);
}
async function openDoc(name, { mermaid = false } = {}) {
  await doc.goto(fileUrl(name));
  if (name.endsWith(".md")) {
    await doc.waitForSelector(".markdown-body h1", { timeout: 15000 });
    if (mermaid) await doc.waitForSelector(".markdown-body svg[id^=mermaid], .mermaid-block svg", { timeout: 15000 }).catch(() => console.warn("  (no mermaid svg found)"));
  }
  await doc.evaluate(() => document.fonts.ready);
  await sleep(800);
}
const SCROLLER = ".preview-scroll";
const scrollTo = (v, sel = SCROLLER) => doc.evaluate(([v, sel]) => { const el = document.querySelector(sel) ?? document.scrollingElement; el.scrollTop = v; }, [v, sel]);
const scrollPos = (sel = SCROLLER) => doc.evaluate((sel) => (document.querySelector(sel) ?? document.scrollingElement).scrollTop, sel);
const headingTop = (text) => doc.evaluate((text) => {
  const s = document.querySelector(".preview-scroll");
  const h = [...document.querySelectorAll(".markdown-body h1,.markdown-body h2,.markdown-body h3")].find((e) => e.textContent.includes(text));
  return h.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop;
}, text);

// ---------- frame helpers ----------
let clip, layout, cursor, live, popupAt;
const set = (p) => stage.evaluate((p) => window.S.set(p), p);

async function frame(n = 1) {
  if (live.doc) await stage.evaluate((u) => window.S.layer("layerA", u), await grab(docCdp));
  if (live.pop) await stage.evaluate((u) => window.S.layer("popupImg", u), await grab(popCdp));
  const r = await stageCdp.send("Page.captureScreenshot", { format: "png" });
  await clip.write(Buffer.from(r.data, "base64"), n);
}
async function hold(n, { still = false } = {}) {
  if (still) return frame(n);
  for (let i = 0; i < n; i++) await frame();
}
async function beginScene(name, cfg) {
  clip = new Clip(name);
  await stage.goto(pathToFileURL(path.join(HERE, cfg.page ?? "stage.html")).href);
  await stage.evaluate(() => document.fonts.ready);
  live = { doc: !!cfg.browser, pop: false };
  layout = cfg.page ? null : await stage.evaluate((c) => window.S.setup(c), cfg);
  cursor = { x: 1200, y: 640, show: false };
  popupAt = null;
}
const inContent = (x, y) => layout?.content && x >= layout.content.x && y >= layout.content.y && x < layout.content.x + layout.content.w && y < layout.content.y + layout.content.h;
const toDoc = (x, y) => ({ x: (x - layout.content.x) / DSF, y: (y - layout.content.y) / DSF });
const fromDoc = (box, fx = 0.5, fy = 0.5) => ({ x: layout.content.x + (box.x + box.width * fx) * DSF, y: layout.content.y + (box.y + box.height * fy) * DSF });
const fromPop = (box, fx = 0.5, fy = 0.5) => ({ x: popupAt.x + (box.x + box.width * fx) * DSF, y: popupAt.y + (box.y + box.height * fy) * DSF });
const inPop = (x, y) => popupAt && x >= popupAt.x && y >= popupAt.y && x < popupAt.x + popupAt.w && y < popupAt.y + popupAt.h;

async function showCursor(x, y) {
  cursor = { x, y, show: true };
  await set({ cursor });
}
async function hover() {
  if (inContent(cursor.x, cursor.y)) { const p = toDoc(cursor.x, cursor.y); await doc.mouse.move(p.x, p.y); }
  if (inPop(cursor.x, cursor.y)) await pop.mouse.move((cursor.x - popupAt.x) / DSF, (cursor.y - popupAt.y) / DSF);
}
async function moveTo(to, n, each) {
  const from = { ...cursor };
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    // A slight arc looks more like a real hand than a straight line.
    const arc = Math.sin(Math.PI * t) * Math.min(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.08);
    cursor = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - arc, show: true };
    await set({ cursor });
    await hover();
    if (each) await each(t);
    await frame();
  }
}
async function click(action, frames = 9) {
  for (let i = 0; i < frames; i++) {
    await set({ cursor: { ...cursor, down: i < 3 }, ripple: i < 8 ? { x: cursor.x, y: cursor.y, t: i / 8 } : null });
    if (i === 1 && action) await action();
    await frame();
  }
  await set({ ripple: null, cursor });
}
async function scrollTween(from, to, n, sel) {
  for (let i = 1; i <= n; i++) {
    await scrollTo(lerp(from, to, ease(i / n)), sel);
    await frame();
  }
}

// ---------- scenes ----------
const scenes = {
  async 2() {
    await beginScene("scene-2-logo", { page: "intro.html" });
    for (let i = 0; i < 4 * FPS; i++) {
      await stage.evaluate((ms) => window.seek(ms), (i * 1000) / FPS);
      await frame();
    }
  },

  async 3() {
    await settings();
    await metrics(docCdp, 1280, 720);
    await openDoc("outback-road-trip.txt");
    await beginScene("scene-3-plain-text", { browser: ONE });
    await set({ title: "outback-road-trip.md", url: `${SHOWN_DIR}outback-road-trip.md` });
    await scrollTo(0);
    await hold(24);
    const max = await doc.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    await scrollTween(0, Math.min(max, 640), 132);
    await hold(24);
  },

  async 4() {
    await settings();
    await metrics(docCdp, 1280, 720);
    await openDoc("outback-road-trip.txt");
    await scrollTo(Math.min(640, await doc.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)));
    const raw = await grab(docCdp);
    await openDoc("outback-road-trip.md", { mermaid: true });
    await scrollTo(0);
    await beginScene("scene-4-formatted", { browser: ONE });
    await set({ title: "outback-road-trip.md", url: `${SHOWN_DIR}outback-road-trip.md` });
    live.doc = false;
    await stage.evaluate((u) => window.S.layer("layerA", u), raw);
    await stage.evaluate((u) => window.S.layer("layerB", u), await grab(docCdp));
    await hold(15, { still: true });
    for (let i = 1; i <= 26; i++) {
      await set({ wipe: ease(i / 26), ...(i === 13 ? { title: "Outback Road Trip: Sydney to Uluru" } : {}) });
      await frame();
    }
    await set({ wipe: null });
    live.doc = true;
    await hold(40);
    await scrollTween(0, 150, 129);
  },

  async 5() {
    await settings();
    await metrics(docCdp, 1280, 720);
    await openDoc("outback-road-trip.md", { mermaid: true });
    await scrollTo(150);
    await beginScene("scene-5-reading", { browser: ONE });
    await set({ title: "Outback Road Trip: Sydney to Uluru", url: `${SHOWN_DIR}outback-road-trip.md` });
    await showCursor(1500, 760);
    await hover();
    await hold(10);
    const packing = await headingTop("Packing list");
    await scrollTween(150, packing - 330, 84);
    await hold(14);
    const item = await doc.locator(".mu-outline-item", { hasText: "Fuel maths" }).boundingBox();
    await moveTo(fromDoc(item, 0.35), 30);
    await hold(8);
    const from = await scrollPos();
    const max = await doc.evaluate((sel) => { const s = document.querySelector(sel); return s.scrollHeight - s.clientHeight; }, SCROLLER);
    const to = Math.min(max, (await headingTop("Fuel maths")) - 12);
    await click(async () => {
      await doc.mouse.click(item.x + item.width * 0.35, item.y + item.height / 2);
      // The real click scrolls smoothly in wall-clock time; let it settle, then replay the jump frame by frame.
      await sleep(900);
      await scrollTo(from);
    }, 3);
    await scrollTween(from, to, 26);
    await hold(65);
  },

  async 6() {
    await settings({ theme: "dark" });
    await metrics(docCdp, 1280, 720);
    await openDoc("boomerang-api.md", { mermaid: true });
    await scrollTo(0);
    await beginScene("scene-6-code-diagrams", { browser: { ...ONE, dark: true } });
    await set({ title: "Boomerang API", url: `${SHOWN_DIR}boomerang-api.md` });
    await showCursor(1500, 800);
    await hover();
    await hold(20);
    const quick = await headingTop("Quick start");
    await scrollTween(0, quick - 20, 40);
    const code = await doc.locator("pre", { hasText: "createClient" }).first().boundingBox();
    await moveTo(fromDoc(code, 0.62, 0.42), 28);
    await hold(26);
    await moveTo({ x: 1560, y: 820 }, 14);
    const diagram = await headingTop("How retries work");
    const now = await scrollPos();
    await scrollTween(now, diagram - 20, 52);
    await hold(30);
  },

  async 7() {
    await settings({ showOutline: false });
    const bw = 1050, ew = 750;
    await metrics(docCdp, bw / DSF, 900 / DSF);
    await openDoc("outback-road-trip.md");
    const packing = await headingTop("Packing list");
    await scrollTo(packing - 30);
    await beginScene("scene-7-live-reload", { browser: { x: 830, y: 46, w: bw, h: 900 }, editor: { x: 40, y: 46, w: ew, h: 896 } });
    await set({ title: "Outback Road Trip: Sydney to Uluru", url: `${SHOWN_DIR}outback-road-trip.md` });

    const lines = fs.readFileSync(path.join(WORK, "outback-road-trip.md"), "utf8").replace(/\r/g, "").split("\n");
    const top = lines.findIndex((l) => l.startsWith("## Packing list")) - 3;
    const target = lines.findIndex((l) => l.includes("Park pass"));
    const ed = { name: "outback-road-trip.md", lines, top, caretLine: target, caretCol: 0, caretOn: false, dirty: false, saved: "" };
    const blink = (i) => (ed.caretOn = Math.floor(i / 16) % 2 === 0);
    const charW = await stage.evaluate(() => {
      const s = document.createElement("span");
      s.style.font = '15.5px "Cascadia Mono", Consolas, monospace';
      s.textContent = "x".repeat(100);
      document.body.append(s);
      const w = s.getBoundingClientRect().width / 100;
      s.remove();
      return w;
    });
    const body = layout.edBody;
    const at = (line, col) => ({ x: body.x + 56 + col * charW, y: body.y + (line - ed.top) * 26 + 13 });
    await set({ editor: ed });
    await showCursor(560, 760);
    await hold(14);
    await moveTo(at(target, lines[target].length + 2), 22);
    await click(async () => {
      ed.caretCol = lines[target].length;
      ed.caretOn = true;
      await set({ editor: ed });
    });
    await set({ cursor: { ...cursor, show: false } });
    await hold(6);
    ed.lines.splice(target + 1, 0, "");
    ed.caretLine = target + 1;
    ed.caretCol = 0;
    ed.dirty = true;
    await set({ editor: ed });
    await hold(6);
    const typed = "- [ ] Tim Tams for the road :cookie:";
    for (let i = 1; i <= typed.length; i++) {
      ed.lines[target + 1] = typed.slice(0, i);
      ed.caretCol = i;
      ed.caretOn = true;
      await set({ editor: ed });
      await frame(i % 3 === 0 ? 2 : 1);
    }
    await hold(10);
    const keys = { x: 40 + ew / 2 - 110, y: 46 + 896 - 40 };
    for (let i = 0; i < 46; i++) {
      blink(i);
      const t = i < 5 ? i / 5 : i > 39 ? (46 - i) / 6 : 1;
      if (i === 8) {
        ed.dirty = false;
        ed.saved = "Saved";
        fs.writeFileSync(path.join(WORK, "outback-road-trip.md"), ed.lines.join("\n"));
        live.doc = false; // keep the old page for a beat, then wait for the extension's live reload
      }
      if (i === 18) {
        await doc.waitForFunction(() => document.body.innerText.includes("Tim Tams"), null, { timeout: 10000 });
        await sleep(300);
        live.doc = true;
      }
      await set({ editor: ed, keys: { ...keys, t } });
      await frame();
    }
    await set({ keys: null });
    for (let i = 0; i < 84; i++) {
      blink(i);
      await set({ editor: ed });
      await frame();
    }
    fs.copyFileSync(path.join(ROOT, "store/demo/outback-road-trip.md"), path.join(WORK, "outback-road-trip.md"));
  },

  async 8() {
    await settings();
    await metrics(docCdp, 1280, 720);
    await metrics(popCdp, 320, 400);
    await pop.goto(`chrome-extension://${extId}/options.html`);
    await pop.waitForSelector("#theme");
    await sleep(400);
    const popH = await pop.evaluate(() => document.querySelector(".opts").getBoundingClientRect().height);
    await metrics(popCdp, 320, Math.ceil(popH));
    await openDoc("outback-road-trip.md", { mermaid: true });
    await scrollTo(0);
    await beginScene("scene-8-settings", { browser: ONE });
    await set({ title: "Outback Road Trip: Sydney to Uluru", url: `${SHOWN_DIR}outback-road-trip.md` });
    const pw = 320 * DSF, ph = Math.ceil(popH) * DSF;
    popupAt = { x: layout.extBtn.x + layout.extBtn.w + 8 - pw, y: ONE.y + 88 - 4, w: pw, h: ph };

    await showCursor(1180, 620);
    await hold(10);
    await moveTo({ x: layout.extBtn.x + layout.extBtn.w / 2, y: layout.extBtn.y + layout.extBtn.h / 2 }, 26);
    await click();
    live.pop = true;
    for (let i = 1; i <= 7; i++) {
      await set({ popup: { ...popupAt, t: ease(i / 7) } });
      await frame();
    }
    await hold(4);

    const dropdown = async (id, items, choose, dark) => {
      const box = await pop.locator(`#${id}`).boundingBox();
      const p = fromPop(box, 0.5, 0.5);
      await moveTo({ x: p.x + 40, y: p.y }, 20);
      let current = await pop.locator(`#${id}`).evaluate((s) => s.selectedIndex);
      const menu = { x: popupAt.x + box.x * DSF, y: popupAt.y + (box.y + box.height) * DSF + 2, w: box.width * DSF, items, dark };
      await click(() => set({ dropdown: { ...menu, hi: current } }), 6);
      await hold(6);
      const row = { x: menu.x + menu.w * 0.45, y: menu.y + 4 + choose * 30 + 15 };
      await moveTo(row, 12, (t) => set({ dropdown: { ...menu, hi: t > 0.6 ? choose : current } }));
      await hold(4);
      await click(async () => {
        await set({ dropdown: null });
        await pop.selectOption(`#${id}`, { index: choose });
      }, 6);
    };

    await dropdown("theme", ["Match system", "Light", "Dark"], 2, false);
    await hold(16);

    const range = await pop.locator("#fontSize").boundingBox();
    const thumb = (v) => ({ x: range.x + 8 + ((v - 12) / 12) * (range.width - 16), y: range.y + range.height / 2 });
    const start = thumb(16);
    await moveTo(fromPop({ x: start.x, y: start.y, width: 0, height: 0 }), 18);
    await pop.mouse.move(start.x, start.y);
    await pop.mouse.down();
    await set({ cursor: { ...cursor, down: true } });
    await frame(2);
    const end = thumb(19.4);
    for (let i = 1; i <= 30; i++) {
      const x = lerp(start.x, end.x, ease(i / 30));
      await pop.mouse.move(x, start.y);
      cursor = { ...fromPop({ x, y: start.y, width: 0, height: 0 }), show: true, down: true };
      await set({ cursor });
      await sleep(40);
      await frame();
    }
    await pop.mouse.up();
    cursor.down = false;
    await set({ cursor });
    await hold(10);

    await dropdown("fontFamily", ["Sans-serif", "Serif"], 1, true);
    await hold(30);
  },

  async 9() {
    // Background: the formatted page in its browser window, blurred behind the padlock.
    await settings();
    await metrics(docCdp, 1280, 720);
    await openDoc("outback-road-trip.md", { mermaid: true });
    await scrollTo(150);
    await beginScene("scene-9-private", { browser: ONE });
    await set({ title: "Outback Road Trip: Sydney to Uluru", url: `${SHOWN_DIR}outback-road-trip.md` });
    await stage.evaluate((u) => window.S.layer("layerA", u), await grab(docCdp));
    const bg = `data:image/png;base64,${(await stageCdp.send("Page.captureScreenshot", { format: "png" })).data}`;
    await stage.goto(pathToFileURL(path.join(HERE, "private.html")).href);
    await stage.evaluate((u) => window.setBg(u), bg);
    live = { doc: false, pop: false };
    for (let i = 0; i < 5 * FPS; i++) {
      await stage.evaluate((ms) => window.seek(ms), (i * 1000) / FPS);
      await frame();
    }
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenes);
try {
  for (const id of wanted) {
    const t0 = Date.now();
    console.log(`Scene ${id}...`);
    await scenes[id]();
    await clip.close();
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  const all = fs.readdirSync(OUT).filter((f) => /^scene-\d-.*\.mp4$/.test(f)).sort();
  fs.writeFileSync(path.join(OUT, "list.txt"), all.map((f) => `file '${f}'`).join("\n"));
  await new Promise((res, rej) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(OUT, "list.txt"), "-c", "copy", path.join(OUT, "all-scenes.mp4")], { stdio: "inherit" })
    .on("close", (c) => (c === 0 ? res() : rej(new Error(`concat failed ${c}`)))));
  fs.rmSync(path.join(OUT, "list.txt"));
  console.log("Wrote all-scenes.mp4");
} finally {
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
