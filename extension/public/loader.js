// Classic content script: Chrome shows a plain-text file as <body><pre>…</pre></body>.
// If that's what we have, hand the text to the viewer module (an ES module, so it can lazy-load chunks).
(() => {
  if (window.__markdownUnder) return;
  window.__markdownUnder = true;
  const type = document.contentType || "";
  if (!/^text\/(plain|markdown|x-markdown)$/i.test(type)) return;
  const pre = document.body && document.body.querySelector(":scope > pre");
  if (!pre) return;
  import(chrome.runtime.getURL("viewer.js"))
    .then((m) => m.start(pre.textContent || ""))
    .catch((err) => console.error("[Markdown Under]", err));
})();
