use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use walkdir::{DirEntry, WalkDir};

pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdx", "mkd", "mdown", "mkdn"];

/// Directories that are never interesting for a docs tree and are often huge.
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", "dist", "bin", "obj", "__pycache__"];

const MAX_TREE_DEPTH: usize = 12;
const MAX_TREE_ENTRIES: usize = 20_000;
const MAX_SEARCH_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_SNIPPET_CHARS: usize = 240;

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| MARKDOWN_EXTENSIONS.iter().any(|m| m.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// True for a directory name we should not descend into (hidden or known build output).
pub fn is_skipped_dir_name(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(name))
}

/// True when any component of `path` is a skipped directory (used to filter watcher noise).
pub fn has_skipped_component(path: &Path) -> bool {
    path.components().any(|c| match c {
        std::path::Component::Normal(s) => s.to_str().map(is_skipped_dir_name).unwrap_or(false),
        _ => false,
    })
}

pub fn read_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(text.strip_prefix('\u{feff}').map(str::to_owned).unwrap_or(text))
}

/// Writes via a temp file in the same directory and renames over the target, so a crash
/// mid-write never leaves a truncated document behind.
pub fn write_text(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("Invalid path: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid file name: {}", path.display()))?;
    let tmp = dir.join(format!(".{file_name}.mu-tmp"));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Could not save {}: {e}", path.display()));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

/// Builds a tree of markdown files under `root`, pruning directories that contain none.
pub fn list_tree(root: &Path) -> Result<TreeNode, String> {
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", root.display()));
    }
    let mut budget = MAX_TREE_ENTRIES;
    let children = build_children(root, 0, &mut budget);
    Ok(TreeNode {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.display().to_string()),
        path: root.display().to_string(),
        is_dir: true,
        children,
    })
}

fn build_children(dir: &Path, depth: usize, budget: &mut usize) -> Vec<TreeNode> {
    if depth >= MAX_TREE_DEPTH || *budget == 0 {
        return Vec::new();
    }
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<_> = read.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());

    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in entries {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if is_skipped_dir_name(&name) {
                continue;
            }
            let children = build_children(&path, depth + 1, budget);
            if !children.is_empty() {
                dirs.push(TreeNode { name, path: path.display().to_string(), is_dir: true, children });
            }
        } else if is_markdown(&path) {
            files.push(TreeNode { name, path: path.display().to_string(), is_dir: false, children: Vec::new() });
        }
    }
    dirs.extend(files);
    dirs
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    /// 1-based line number.
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
    pub files_searched: usize,
}

fn walk_filter(entry: &DirEntry) -> bool {
    entry.depth() == 0
        || !entry.file_type().is_dir()
        || !is_skipped_dir_name(&entry.file_name().to_string_lossy())
}

/// Plain-text, line-based search across every markdown file under `root`.
pub fn search(root: &Path, query: &str, case_sensitive: bool, max_hits: usize) -> Result<SearchResult, String> {
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", root.display()));
    }
    let mut result = SearchResult { hits: Vec::new(), truncated: false, files_searched: 0 };
    if query.is_empty() {
        return Ok(result);
    }
    let needle = if case_sensitive { query.to_owned() } else { query.to_lowercase() };

    for entry in WalkDir::new(root).max_depth(MAX_TREE_DEPTH).into_iter().filter_entry(walk_filter) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() || !is_markdown(entry.path()) {
            continue;
        }
        if entry.metadata().map(|m| m.len() > MAX_SEARCH_FILE_BYTES).unwrap_or(true) {
            continue;
        }
        let Ok(text) = read_text(entry.path()) else { continue };
        result.files_searched += 1;
        for (idx, line) in text.lines().enumerate() {
            let haystack = if case_sensitive { line.to_owned() } else { line.to_lowercase() };
            if let Some(pos) = haystack.find(&needle) {
                result.hits.push(SearchHit {
                    path: entry.path().display().to_string(),
                    line: idx + 1,
                    text: snippet(line, &haystack, pos),
                });
                if result.hits.len() >= max_hits {
                    result.truncated = true;
                    return Ok(result);
                }
            }
        }
    }
    Ok(result)
}

/// Trims a long line to a window around the match. `pos` is a byte offset into `haystack`,
/// which may differ in length from `line` after lowercasing, so we map via char counts.
fn snippet(line: &str, haystack: &str, pos: usize) -> String {
    let trimmed_len = line.chars().count();
    if trimmed_len <= MAX_SNIPPET_CHARS {
        return line.trim().to_owned();
    }
    let match_char = haystack[..pos].chars().count().min(trimmed_len);
    let start = match_char.saturating_sub(MAX_SNIPPET_CHARS / 3);
    let body: String = line.chars().skip(start).take(MAX_SNIPPET_CHARS).collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if start + MAX_SNIPPET_CHARS < trimmed_len { "…" } else { "" };
    format!("{prefix}{}{suffix}", body.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_markdown_extensions() {
        assert!(is_markdown(Path::new("a/README.md")));
        assert!(is_markdown(Path::new("notes.MARKDOWN")));
        assert!(!is_markdown(Path::new("image.png")));
        assert!(!is_markdown(Path::new("Makefile")));
    }

    #[test]
    fn write_then_read_round_trips_and_strips_bom() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("doc.md");
        write_text(&p, "\u{feff}# Hi\n").unwrap();
        assert_eq!(read_text(&p).unwrap(), "# Hi\n");
        assert!(!dir.path().join(".doc.md.mu-tmp").exists());
    }

    #[test]
    fn tree_prunes_folders_without_markdown_and_skips_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("docs/deep")).unwrap();
        fs::create_dir_all(root.join("empty")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("README.md"), "x").unwrap();
        fs::write(root.join("docs/deep/guide.md"), "x").unwrap();
        fs::write(root.join("empty/data.txt"), "x").unwrap();
        fs::write(root.join(".git/notes.md"), "x").unwrap();
        fs::write(root.join("node_modules/pkg/README.md"), "x").unwrap();

        let tree = list_tree(root).unwrap();
        let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["docs", "README.md"]);
        assert_eq!(tree.children[0].children[0].children[0].name, "guide.md");
    }

    #[test]
    fn search_finds_case_insensitive_lines() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "first\nHello World\nlast").unwrap();
        fs::write(dir.path().join("b.txt"), "hello world").unwrap();
        let res = search(dir.path(), "hello", false, 100).unwrap();
        assert_eq!(res.hits.len(), 1);
        assert_eq!(res.hits[0].line, 2);
        assert_eq!(res.hits[0].text, "Hello World");
        assert_eq!(search(dir.path(), "hello", true, 100).unwrap().hits.len(), 0);
    }

    #[test]
    fn search_truncates_at_max_hits() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "x\nx\nx\nx").unwrap();
        let res = search(dir.path(), "x", false, 2).unwrap();
        assert_eq!(res.hits.len(), 2);
        assert!(res.truncated);
    }

    #[test]
    fn snippet_windows_long_lines() {
        let line = format!("{}needle{}", "a".repeat(400), "b".repeat(400));
        let s = snippet(&line, &line, 400);
        assert!(s.contains("needle"));
        assert!(s.starts_with('…') && s.ends_with('…'));
    }

    #[test]
    fn skipped_components_detected() {
        assert!(has_skipped_component(Path::new("/a/node_modules/b.md")));
        assert!(has_skipped_component(Path::new("/a/.git/HEAD")));
        assert!(!has_skipped_component(Path::new("/a/docs/b.md")));
    }
}
