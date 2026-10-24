import { describe, expect, it } from "vitest";
import { basename, dirname, extname, hasUrlScheme, isAbsolutePath, isInside, isMarkdownPath, relativeTo, resolvePath, samePath, splitHash } from "../src/lib/paths";
import { countWords, toggleTaskAt } from "../src/lib/text";

describe("paths", () => {
  it("splits names on both separators", () => {
    expect(basename("C:\\docs\\a.md")).toBe("a.md");
    expect(basename("/home/u/a.md")).toBe("a.md");
    expect(dirname("C:\\docs\\a.md")).toBe("C:\\docs");
    expect(dirname("C:\\a.md")).toBe("C:\\");
    expect(dirname("/a.md")).toBe("/");
    expect(extname("README.MD")).toBe("md");
    expect(extname(".gitignore")).toBe("");
  });

  it("detects markdown, absolute paths and URL schemes", () => {
    expect(isMarkdownPath("x/notes.markdown")).toBe(true);
    expect(isMarkdownPath("x/pic.png")).toBe(false);
    expect(isAbsolutePath("C:/x")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("docs/x.md")).toBe(false);
    expect(hasUrlScheme("https://x.y")).toBe(true);
    expect(hasUrlScheme("mailto:a@b")).toBe(true);
    expect(hasUrlScheme("C:\\x")).toBe(false);
    expect(hasUrlScheme("docs/a.md")).toBe(false);
  });

  it("resolves relative links on Windows paths", () => {
    expect(resolvePath("C:\\docs\\guide", "../README.md")).toBe("C:\\docs\\README.md");
    expect(resolvePath("C:\\docs", "./img/a%20b.png")).toBe("C:\\docs\\img\\a b.png");
    expect(resolvePath("C:\\docs", "../../../x.md")).toBe("C:\\x.md");
    expect(resolvePath("C:\\docs", "D:/other/x.md")).toBe("D:\\other\\x.md");
    expect(resolvePath("\\\\nas\\share\\docs", "../a.md")).toBe("\\\\nas\\share\\a.md");
  });

  it("resolves relative links on POSIX paths", () => {
    expect(resolvePath("/demo/guide", "../README.md")).toBe("/demo/README.md");
    expect(resolvePath("/demo", "notes/ideas.md")).toBe("/demo/notes/ideas.md");
    expect(resolvePath("/demo", "../../x.md")).toBe("/x.md");
    expect(resolvePath("/demo", "file:///etc/x.md")).toBe("/etc/x.md");
  });

  it("splits hashes and compares paths loosely on Windows", () => {
    expect(splitHash("a.md#b")).toEqual(["a.md", "b"]);
    expect(splitHash("a.md")).toEqual(["a.md", ""]);
    expect(samePath("C:\\Docs\\A.md", "c:/docs/a.md")).toBe(true);
    expect(samePath("/a/B.md", "/a/b.md")).toBe(false);
    expect(isInside("C:\\docs\\x\\a.md", "c:\\docs")).toBe(true);
    expect(isInside("C:\\docs2\\a.md", "C:\\docs")).toBe(false);
    expect(relativeTo("C:\\docs\\x\\a.md", "C:\\docs")).toBe("x/a.md");
  });
});

describe("text", () => {
  it("counts prose words, skipping front matter and code", () => {
    const src = "---\ntitle: x y z\n---\n# Hello world\n\nSome **bold** text [link](http://a.b).\n\n```js\nconst ignored = 1;\n```\n";
    expect(countWords(src)).toBe(6);
  });

  it("toggles task checkboxes in place", () => {
    const src = "- [ ] one\n- [x] two\n  1. [ ] nested\n> - [ ] quoted\nplain";
    expect(toggleTaskAt(src, 0, true)).toBe(src.replace("- [ ] one", "- [x] one"));
    expect(toggleTaskAt(src, 1, false)).toBe(src.replace("- [x] two", "- [ ] two"));
    expect(toggleTaskAt(src, 2, true)).toContain("1. [x] nested");
    expect(toggleTaskAt(src, 3, true)).toContain("> - [x] quoted");
    expect(toggleTaskAt(src, 4, true)).toBeNull();
  });

  it("keeps CRLF line endings when toggling", () => {
    expect(toggleTaskAt("- [ ] a\r\n- [ ] b\r\n", 1, true)).toBe("- [ ] a\r\n- [x] b\r\n");
  });
});
