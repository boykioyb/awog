mod commands;
mod sidecar;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub fn run() {
    // Prefer RUST_LOG when set; otherwise default to `info` so sidecar stderr is visible.
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = sidecar::spawn(app.handle().clone())?;
            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_request,
            commands::open_external,
            commands::reveal_path,
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
