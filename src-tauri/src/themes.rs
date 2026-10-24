use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const EXAMPLE_THEME: &str = r#"/*
  Markdown Under custom theme example.

  Every .css file in this folder appears under Settings -> Custom theme.
  Rules are applied on top of the built-in light/dark styles. Scope them to
  .markdown-body to style only the rendered document.
*/

.markdown-body {
  /* font-family: "Georgia", serif; */
  /* --mu-accent: #b0428a; */
}

.markdown-body h1,
.markdown-body h2 {
  /* border-bottom-color: var(--mu-accent); */
}
"#;

/// `<app config dir>/themes`, created (and seeded with an example) on first use.
pub fn themes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config directory: {e}"))?
        .join("themes");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        let _ = fs::write(dir.join("example.css"), EXAMPLE_THEME);
    }
    Ok(dir)
}

pub fn list_themes(app: &AppHandle) -> Result<Vec<String>, String> {
    let dir = themes_dir(app)?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("Could not read {}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("css")))
        .filter_map(|p| p.file_stem().map(|s| s.to_string_lossy().into_owned()))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

pub fn read_theme(app: &AppHandle, name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err(format!("Invalid theme name: {name}"));
    }
    let path = themes_dir(app)?.join(format!("{name}.css"));
    fs::read_to_string(&path).map_err(|e| format!("Could not read theme {}: {e}", path.display()))
}
