import DOMPurify from "dompurify";

// Documents may contain raw HTML. It is sanitized before it reaches the DOM so a hostile
// .md file can't run script with access to the app's file APIs. <style> and <link> are
// dropped too, since they could restyle or reach outside the document.

const CONFIG = {
  ADD_ATTR: ["target", "data-line", "data-lang"],
  FORBID_TAGS: ["style", "link", "iframe", "object", "embed", "form", "base", "meta"],
  FORBID_ATTR: ["srcset"],
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as string;
}
