//! Tauri commands exposed to the webview.
//!
//! `sidecar_request` is the only IPC entry for engine calls; everything else the
//! UI needs from the host process must go through here so we keep one auditable
//! boundary (ADR 0008 + security invariant #4).
//!
//! `open_external` is a narrow allowlist-only opener used for OAuth flows that
//! cannot complete inside the webview.

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
