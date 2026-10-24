use crate::fs_ops::{has_skipped_component, is_markdown};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Holds the active watcher; replacing it drops (and stops) the previous one.
#[derive(Default)]
pub struct WatchState(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub paths: Vec<String>,
}

/// Watches the open file (via its parent directory, so editors that save by
/// replace-and-rename are still caught) and, optionally, an open folder recursively.
pub fn set_watches(app: AppHandle, state: &WatchState, file: Option<PathBuf>, folder: Option<PathBuf>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "watch state poisoned".to_string())?;
    *guard = None;
    if file.is_none() && folder.is_none() {
        return Ok(());
    }

    let watched_file = file.clone();
    let watched_folder = folder.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter(|p| is_relevant(p, watched_file.as_deref(), watched_folder.as_deref()))
            .map(|p| p.display().to_string())
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("fs-change", FsChange { paths });
        }
    })
    .map_err(|e| format!("Could not start file watcher: {e}"))?;

    if let Some(parent) = file.as_deref().and_then(Path::parent) {
        watcher
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| format!("Could not watch {}: {e}", parent.display()))?;
    }
    if let Some(folder) = folder.as_deref() {
        watcher
            .watch(folder, RecursiveMode::Recursive)
            .map_err(|e| format!("Could not watch {}: {e}", folder.display()))?;
    }
    *guard = Some(watcher);
    Ok(())
}

fn is_relevant(path: &Path, file: Option<&Path>, folder: Option<&Path>) -> bool {
    if file.is_some_and(|f| same_path(f, path)) {
        return true;
    }
    let Some(folder) = folder else { return false };
    let Ok(rel) = path.strip_prefix(folder) else { return false };
    if has_skipped_component(rel) {
        return false;
    }
    // Markdown files, or extension-less entries that are likely directories.
    is_markdown(path) || path.extension().is_none()
}

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").to_lowercase();
        norm(a) == norm(b)
    } else {
        a == b
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevance_filters_noise() {
        let folder = Path::new("/notes");
        let file = Path::new("/elsewhere/open.md");
        assert!(is_relevant(Path::new("/elsewhere/open.md"), Some(file), Some(folder)));
        assert!(!is_relevant(Path::new("/elsewhere/other.md"), Some(file), Some(folder)));
        assert!(is_relevant(Path::new("/notes/a/b.md"), Some(file), Some(folder)));
        assert!(is_relevant(Path::new("/notes/newdir"), Some(file), Some(folder)));
        assert!(!is_relevant(Path::new("/notes/a/pic.png"), Some(file), Some(folder)));
        assert!(!is_relevant(Path::new("/notes/node_modules/x.md"), Some(file), Some(folder)));
    }

    #[test]
    fn hidden_root_is_not_filtered() {
        let folder = Path::new("/home/u/.notes");
        assert!(is_relevant(Path::new("/home/u/.notes/a.md"), None, Some(folder)));
    }
}
