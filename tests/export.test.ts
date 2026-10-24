import { describe, expect, it, vi } from "vitest";

vi.mock("../src/styles/tokens.css?inline", () => ({ default: "" }));
vi.mock("../src/styles/markdown.css?inline", () => ({ default: "" }));
vi.mock("katex/dist/katex.min.css?inline", () => ({ default: "" }));

const { rewriteKatexFonts } = await import("../src/ui/export");

describe("rewriteKatexFonts", () => {
  it("handles original, dev and hashed build URLs", () => {
    const css = [
      "src:url(fonts/KaTeX_AMS-Regular.woff2) format('woff2')",
      'src:url("/node_modules/katex/dist/fonts/KaTeX_Main-Bold.woff")',
      "src:url(/assets/KaTeX_Size1-Regular-B9fS1x-_.ttf)",
    ].join(";");
    const out = rewriteKatexFonts(css);
    expect(out).toContain("/dist/fonts/KaTeX_AMS-Regular.woff2)");
    expect(out).toContain('/dist/fonts/KaTeX_Main-Bold.woff")');
    expect(out).toContain("/dist/fonts/KaTeX_Size1-Regular.ttf)");
    expect(out).not.toContain("/assets/");
    expect(out).not.toContain("/node_modules/");
    expect(out.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[\d.]+\/dist\/fonts\//g)).toHaveLength(3);
  });
});
