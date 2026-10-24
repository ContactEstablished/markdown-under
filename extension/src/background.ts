// Content scripts can't read file:// URLs (they share the page's origin), but extension
// contexts with "Allow access to file URLs" can. Live reload asks us to re-read its own file.

interface ReadRequest {
  type: "read-file";
}

const withoutHash = (url: string) => url.split("#")[0];

chrome.runtime.onMessage.addListener((message: ReadRequest, sender, sendResponse) => {
  if (message?.type !== "read-file") return false;
  // Only ever read the file the asking tab is showing.
  const url = sender.url ? withoutHash(sender.url) : "";
  if (!url.startsWith("file:")) {
    sendResponse({ text: null });
    return false;
  }
  fetch(url, { cache: "no-store" })
    .then((res) => (res.ok ? res.text() : null))
    .catch(() => null)
    .then((text) => sendResponse({ text }));
  return true; // Responds asynchronously.
});
