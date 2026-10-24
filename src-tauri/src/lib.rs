mod fs_ops;
mod themes;
mod watcher;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use watcher::WatchState;

const MAX_SEARCH_HITS: usize = 1_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PathInfo {
    path: String,
    exists: bool,
    is_dir: bool,
}

fn path_info(path: &Path) -> PathInfo {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    PathInfo {
        path: absolute.display().to_string(),
        exists: absolute.exists(),
        is_dir: absolute.is_dir(),
    }
}

/// First non-flag argument after the executable, as passed by "Open with" or the CLI.
fn path_from_args<I: IntoIterator<Item = String>>(args: I, cwd: Option<&Path>) -> Option<PathInfo> {
    let arg = args.into_iter().skip(1).find(|a| !a.starts_with('-'))?;
    let p = PathBuf::from(&arg);
    let p = match cwd {
        Some(cwd) if p.is_relative() => cwd.join(p),
        _ => p,
    };
    Some(path_info(&p)).filter(|i| i.exists)
}

/// Path supplied at launch; taken once by the frontend on startup.
#[derive(Default)]
struct InitialPath(Mutex<Option<PathInfo>>);

#[tauri::command]
fn take_initial_path(state: State<'_, InitialPath>) -> Option<PathInfo> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
fn get_path_info(path: String) -> PathInfo {
    path_info(Path::new(&path))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs_ops::read_text(Path::new(&path))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs_ops::write_text(Path::new(&path), &contents)
}

#[tauri::command]
async fn list_markdown_tree(root: String) -> Result<fs_ops::TreeNode, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::list_tree(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_folder(root: String, query: String, case_sensitive: bool) -> Result<fs_ops::SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_ops::search(Path::new(&root), &query, case_sensitive, MAX_SEARCH_HITS)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_watches(app: AppHandle, state: State<'_, WatchState>, file: Option<String>, folder: Option<String>) -> Result<(), String> {
    watcher::set_watches(app, &state, file.map(PathBuf::from), folder.map(PathBuf::from))
}

#[tauri::command]
fn themes_dir(app: AppHandle) -> Result<String, String> {
    themes::themes_dir(&app).map(|p| p.display().to_string())
}

#[tauri::command]
fn list_themes(app: AppHandle) -> Result<Vec<String>, String> {
    themes::list_themes(&app)
}

#[tauri::command]
fn read_theme(app: AppHandle, name: String) -> Result<String, String> {
    themes::read_theme(&app, &name)
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Must be registered first: a second launch (e.g. double-clicking another .md file)
        // forwards its path to the running window instead of opening a new one.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(info) = path_from_args(argv, Some(Path::new(&cwd))) {
                let _ = app.emit("open-path", info);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatchState::default())
        .manage(InitialPath(Mutex::new(path_from_args(std::env::args(), None))))
        .invoke_handler(tauri::generate_handler![
            take_initial_path,
            get_path_info,
            read_text_file,
            write_text_file,
            list_markdown_tree,
            search_folder,
            set_watches,
            themes_dir,
            list_themes,
            read_theme,
            print_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Under");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_skip_exe_and_flags() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        std::fs::write(&file, "x").unwrap();
        let args = vec!["exe".into(), "--flag".into(), file.display().to_string()];
        let info = path_from_args(args, None).unwrap();
        assert!(!info.is_dir);
        assert!(path_from_args(vec!["exe".to_string()], None).is_none());
        assert!(path_from_args(vec!["exe".into(), "missing-file.md".into()], Some(dir.path())).is_none());
    }

    #[test]
    fn relative_args_resolve_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("rel.md"), "x").unwrap();
        let info = path_from_args(vec!["exe".into(), "rel.md".into()], Some(dir.path())).unwrap();
        assert!(info.exists);
        assert!(info.path.ends_with("rel.md"));
    }
}
