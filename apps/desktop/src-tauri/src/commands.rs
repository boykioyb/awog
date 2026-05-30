//! Tauri commands exposed to the webview.
//!
//! `sidecar_request` is the only IPC entry for engine calls; everything else the
//! UI needs from the host process must go through here so we keep one auditable
//! boundary (ADR 0008 + security invariant #4).
//!
//! `open_external` is a narrow allowlist-only opener used for OAuth flows that
//! cannot complete inside the webview.

use std::path::{Path, PathBuf};
use std::process::Command;

use regex::Regex;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

use crate::sidecar::SidecarHandle;

/// Forward an RPC method call to the sidecar.
///
/// Errors are stringified as JSON so the frontend can `JSON.parse` and access
/// `code` / `message` / `data` uniformly without a second round-trip type.
#[tauri::command]
pub async fn sidecar_request(
    handle: State<'_, SidecarHandle>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    handle
        .request(method, params.unwrap_or(Value::Null))
        .await
        .map_err(|err| {
            serde_json::to_string(&err).unwrap_or_else(|_| format!("{}", err))
        })
}

/// Open an external URL in the user's default browser.
///
/// Allowlisted to Anthropic's OAuth authorize endpoint for now. Extend the
/// allowlist (or refactor to a config-driven list) when adding more providers.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    // Compiled inline because the allowlist is one entry today; promote to a
    // `once_cell::Lazy` if this grows past ~3.
    let allow = Regex::new(r"^https://claude\.ai/oauth/authorize\?")
        .expect("static regex must compile");

    if !allow.is_match(&url) {
        return Err(format!("URL not allowlisted: {url}"));
    }

    // `Shell::open` is deprecated in favor of `tauri-plugin-opener`. Switching adds
    // another plugin + permission surface; defer until an opener-related ADR.
    #[allow(deprecated)]
    app.shell().open(&url, None).map_err(|e| e.to_string())
}

/// Validate that `rel_path` resolves to a real file/dir inside `workspace_root`.
/// Returns the canonicalized absolute path on success.
///
/// Security: canonicalize both sides → reject if the result is not a descendant
/// of the workspace root (defends against `..` traversal and symlinks pointing
/// outside the workspace). Mirrors the sidecar's `assertInsideWorkspace`
/// invariant on the Rust side so the file-open commands can't be tricked into
/// touching arbitrary paths.
fn resolve_inside_workspace(workspace_root: &str, rel_path: &str) -> Result<PathBuf, String> {
    if workspace_root.is_empty() {
        return Err("workspace_root is empty".to_string());
    }
    if rel_path.is_empty() {
        return Err("path is empty".to_string());
    }
    let root_canon = Path::new(workspace_root)
        .canonicalize()
        .map_err(|e| format!("workspace_root not found: {e}"))?;
    let candidate = root_canon.join(rel_path);
    let target_canon = candidate
        .canonicalize()
        .map_err(|e| format!("path not found: {e}"))?;
    if !target_canon.starts_with(&root_canon) {
        return Err(format!(
            "path escapes workspace: {}",
            target_canon.display()
        ));
    }
    Ok(target_canon)
}

/// Reveal a file or directory in the OS file manager (Finder / Explorer /
/// default file manager). Path must resolve inside `workspace_root`.
#[tauri::command]
pub async fn reveal_path(workspace_root: String, path: String) -> Result<(), String> {
    let target = resolve_inside_workspace(&workspace_root, &path)?;
    spawn_reveal(&target)
}

/// Open a file with the OS default handler, or a directory in the file
/// manager. Path must resolve inside `workspace_root`.
#[tauri::command]
pub async fn open_path(workspace_root: String, path: String) -> Result<(), String> {
    let target = resolve_inside_workspace(&workspace_root, &path)?;
    spawn_open(&target)
}

#[cfg(target_os = "macos")]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    // `-R` reveals in Finder with the file selected. Always pass via arg array,
    // never a shell string.
    Command::new("open")
        .arg("-R")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    // `/select,<path>` opens Explorer with the file highlighted. No space after
    // the comma — Windows is picky here.
    Command::new("explorer")
        .arg(format!("/select,{}", target.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_reveal(target: &Path) -> Result<(), String> {
    // Most Linux file managers don't support reveal-with-selection through a
    // standard CLI flag, so fall back to opening the parent directory. The
    // file is at least visible at the top of the listing.
    let dir = target.parent().unwrap_or(target);
    Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn spawn_open(target: &Path) -> Result<(), String> {
    Command::new("open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn spawn_open(target: &Path) -> Result<(), String> {
    // `cmd /C start "" <path>` is the canonical way to open a file with its
    // default handler on Windows. The empty title argument is required.
    Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_open(target: &Path) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
