//! Sidecar process bridge.
//!
//! Spawns the bundled Node.js sidecar binary (`binaries/awog-sidecar`) and exchanges
//! NDJSON-framed JSON-RPC 2.0 messages with it over stdin/stdout. See ADR 0008.
//!
//! Responsibilities:
//! - Spawn child via `tauri-plugin-shell`'s sidecar API.
//! - Writer task: drain outgoing requests, assign monotonically increasing ids,
//!   serialize as a single NDJSON line, write to child stdin, park the
//!   `oneshot::Sender` in the pending-requests map.
//! - Reader task: re-frame stdout chunks on `\n`, parse JSON; dispatch responses
//!   by id, forward notifications (`method == "event"`) to the webview via
//!   `app.emit("sidecar.event", payload)`.
//! - Stderr task: log every line at `info` (sidecar's structured log channel).
//! - Termination: log exit code; restart policy deferred to a later milestone.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::{
    process::{CommandEvent, CommandChild},
    ShellExt,
};
use tokio::{
    sync::{mpsc, oneshot, Mutex},
    time::timeout,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_CHANNEL_CAPACITY: usize = 64;
const SIDECAR_BINARY: &str = "awog-sidecar";
const EVENT_NAME: &str = "sidecar.event";

/// Serializable JSON-RPC error returned to the webview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub fn timeout() -> Self {
        Self {
            code: -32001,
            message: format!("sidecar request timed out after {:?}", REQUEST_TIMEOUT),
            data: None,
        }
    }

    pub fn transport(msg: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: msg.into(),
            data: None,
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for RpcError {}

/// Internal type carried over the request mpsc channel.
struct OutgoingRequest {
    method: String,
    params: Value,
    response: oneshot::Sender<Result<Value, RpcError>>,
}

/// Handle stored as Tauri-managed state.
///
/// Cloning is cheap: only the mpsc `Sender` is cloned; the spawned child + tasks
/// live independently for the process lifetime.
#[derive(Clone)]
pub struct SidecarHandle {
    request_tx: mpsc::Sender<OutgoingRequest>,
}

impl SidecarHandle {
    pub async fn request(&self, method: String, params: Value) -> Result<Value, RpcError> {
        let (tx, rx) = oneshot::channel();
        let req = OutgoingRequest {
            method,
            params,
            response: tx,
        };

        if self.request_tx.send(req).await.is_err() {
            return Err(RpcError::transport("sidecar writer channel closed"));
        }

        match timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RpcError::transport("response channel dropped")),
            Err(_) => Err(RpcError::timeout()),
        }
    }
}

/// Pending requests indexed by id. Shared between writer and reader tasks.
type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>>>;

/// Spawn the sidecar child plus its writer/reader/stderr tasks.
///
/// Returns the handle (mpsc Sender) that commands use to dispatch requests.
pub fn spawn(app: AppHandle) -> Result<SidecarHandle> {
    let command = app
        .shell()
        .sidecar(SIDECAR_BINARY)
        .map_err(|e| anyhow!("failed to locate sidecar binary `{SIDECAR_BINARY}`: {e}"))?;

    let (mut events, child) = command
        .spawn()
        .map_err(|e| anyhow!("failed to spawn sidecar: {e}"))?;

    let (request_tx, request_rx) = mpsc::channel::<OutgoingRequest>(REQUEST_CHANNEL_CAPACITY);
    let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(AtomicU64::new(1));

    // Writer task: takes requests, assigns ids, writes NDJSON to child stdin.
    let pending_writer = pending.clone();
    let next_id_writer = next_id.clone();
    tauri::async_runtime::spawn(async move {
        writer_loop(child, request_rx, pending_writer, next_id_writer).await;
    });

    // Reader task: drains stdout/stderr/terminated events.
    let pending_reader = pending.clone();
    let app_for_reader = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stdout_buf: Vec<u8> = Vec::with_capacity(8 * 1024);
        let mut stderr_buf: Vec<u8> = Vec::with_capacity(4 * 1024);

        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(chunk) => {
                    stdout_buf.extend_from_slice(&chunk);
                    drain_lines(&mut stdout_buf, |line| {
                        handle_stdout_line(line, &pending_reader, &app_for_reader);
                    });
                }
                CommandEvent::Stderr(chunk) => {
                    stderr_buf.extend_from_slice(&chunk);
                    drain_lines(&mut stderr_buf, |line| {
                        // Sidecar uses stderr for structured logs; surface verbatim.
                        if let Ok(text) = std::str::from_utf8(line) {
                            tracing::info!(target: "sidecar", "{}", text);
                        }
                    });
                }
                CommandEvent::Terminated(payload) => {
                    tracing::warn!(
                        code = ?payload.code,
                        signal = ?payload.signal,
                        "sidecar terminated"
                    );
                    // Drain any partial stderr leftover.
                    if !stderr_buf.is_empty() {
                        if let Ok(text) = std::str::from_utf8(&stderr_buf) {
                            tracing::info!(target: "sidecar", "{}", text);
                        }
                    }
                    // Reject every still-pending request so callers unblock fast.
                    let mut map = pending_reader.lock().await;
                    for (_, sender) in map.drain() {
                        let _ = sender.send(Err(RpcError::transport("sidecar terminated")));
                    }
                    // TODO(M2.5+): supervisor restart policy.
                    break;
                }
                CommandEvent::Error(err) => {
                    tracing::error!("sidecar IO error: {err}");
                }
                _ => {}
            }
        }
    });

    Ok(SidecarHandle { request_tx })
}

/// Pull bytes from `buf` up to (and excluding) every `\n`, invoking `f` per line.
/// Keeps any trailing partial line in `buf` for the next chunk.
fn drain_lines(buf: &mut Vec<u8>, mut f: impl FnMut(&[u8])) {
    let mut start = 0usize;
    for i in 0..buf.len() {
        if buf[i] == b'\n' {
            let line = &buf[start..i];
            if !line.is_empty() {
                f(line);
            }
            start = i + 1;
        }
    }
    if start > 0 {
        buf.drain(..start);
    }
}

#[derive(Debug, Deserialize)]
struct InboundEnvelope {
    #[allow(dead_code)]
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<RpcError>,
}

fn handle_stdout_line(line: &[u8], pending: &PendingMap, app: &AppHandle) {
    let env: InboundEnvelope = match serde_json::from_slice(line) {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!(
                "discarding malformed line from sidecar stdout: {err} ({})",
                String::from_utf8_lossy(line)
            );
            return;
        }
    };

    if let Some(id) = env.id {
        // Response path.
        let pending = pending.clone();
        tauri::async_runtime::spawn(async move {
            let sender = pending.lock().await.remove(&id);
            if let Some(sender) = sender {
                let payload = if let Some(err) = env.error {
                    Err(err)
                } else {
                    Ok(env.result.unwrap_or(Value::Null))
                };
                let _ = sender.send(payload);
            } else {
                tracing::warn!("received response for unknown id {id}");
            }
        });
    } else if env.method.as_deref() == Some("event") {
        // Notification path: bubble up to the webview verbatim.
        let payload = env.params.unwrap_or(Value::Null);
        if let Err(err) = app.emit(EVENT_NAME, payload) {
            tracing::warn!("failed to emit `{EVENT_NAME}`: {err}");
        }
    } else {
        tracing::warn!(
            "unrecognized message from sidecar (no id, method={:?})",
            env.method
        );
    }
}

#[derive(Debug, Serialize)]
struct OutboundEnvelope<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: &'a Value,
}

async fn writer_loop(
    mut child: CommandChild,
    mut request_rx: mpsc::Receiver<OutgoingRequest>,
    pending: PendingMap,
    next_id: Arc<AtomicU64>,
) {
    while let Some(req) = request_rx.recv().await {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        let envelope = OutboundEnvelope {
            jsonrpc: "2.0",
            id,
            method: &req.method,
            params: &req.params,
        };

        let mut payload = match serde_json::to_vec(&envelope) {
            Ok(v) => v,
            Err(err) => {
                let _ = req
                    .response
                    .send(Err(RpcError::transport(format!("serialize failed: {err}"))));
                continue;
            }
        };
        payload.push(b'\n');

        // Park the responder before writing so the reader can never observe
        // a response without finding its sender.
        pending.lock().await.insert(id, req.response);

        if let Err(err) = child.write(&payload) {
            tracing::error!("stdin write failed: {err}");
            if let Some(sender) = pending.lock().await.remove(&id) {
                let _ = sender.send(Err(RpcError::transport(format!("stdin write: {err}"))));
            }
            // Subsequent writes will also fail; stop the loop and let the reader
            // observe `Terminated` to drain remaining pending entries.
            break;
        }
    }
}
