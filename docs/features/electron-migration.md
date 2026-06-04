# Migrate shell desktop: Tauri → Electron

> **Trạng thái:** Spec (bước 1 — khảo sát + thiết kế). Quyết định gốc: [ADR 0027](../decisions/0027-tauri-vs-electron-revisit.md) (Accepted, Option B).
> **Nhánh thực thi:** `feat/electron-migration` (giữ Tauri chạy song song tới khi Electron OK).
> **Phạm vi:** thay lớp shell + IPC + pipeline build/release. **KHÔNG** đụng logic UI/engine.

## 1. Mục tiêu & nguyên tắc

Thay shell **Tauri (Rust)** bằng **Electron (Node)** vì engine AWOG vĩnh viễn là Node (`@anthropic-ai/claude-agent-sdk` + spawn Claude CLI native). Electron khớp tự nhiên: Node là main process, không cần bundle Node riêng, không sidecar stdio fragile, render UI nhất quán (một Chromium).

| Lớp | Quyết định | Lý do |
|---|---|---|
| `apps/desktop/ui` (Nuxt SPA) | **TÁI DÙNG nguyên vẹn** | Chỉ đổi 3 file chạm IPC (xem §3). |
| `apps/desktop/sidecar` (engine TS) | **TÁI DÙNG ~nguyên vẹn** | Giữ `rpc.ts` dispatch + 115 method. Chỉ thêm 1 transport mới (§5). |
| `apps/desktop/src-tauri` (Rust shell) | **VIẾT LẠI** → `apps/desktop/electron/` | Main process + preload + IPC bridge. |
| `sidecar/scripts/build.mjs` (phần Node-runtime/launcher) | **BỎ** | Electron mang sẵn Node. Giữ phần `tsc` + flatten deps. |
| `.github/workflows/release.yml` + `docs/release.md` | **VIẾT LẠI** | `electron-builder` thay `tauri-action`. |

**Bất biến bảo mật giữ nguyên** ([.claude/rules/security.md](../../.claude/rules/security.md)): API key/OAuth token **chỉ ở engine process**, không vào renderer. Engine chạy process riêng (`utilityProcess.fork`); renderer bật `contextIsolation` + `sandbox`, tắt `nodeIntegration`; mọi IPC qua `contextBridge`.

## 2. Kiến trúc đích

```
┌─────────────────────────────────────────────────────────────┐
│ Electron Main process (Node)        apps/desktop/electron/   │
│  • BrowserWindow → load Nuxt SPA                             │
│    - dev:  http://localhost:3030                            │
│    - prod: app://bundle  (custom protocol → .output/public) │
│  • Tray + native notification + single-instance + lifecycle │
│  • utilityProcess.fork(engine)  ← giữ API key TRONG engine  │
│  • IPC router: renderer ⇄ engine (relay JSON-RPC envelope)  │
│  • shell ops: openExternal(allowlist)/revealPath/openPath   │
│  • dialog: pickFolder / saveFile                            │
└───────────────┬──────────────────────────┬──────────────────┘
                │ parentPort MessagePort    │ contextBridge (preload, isolated+sandbox)
                │ (JSON-RPC shape giữ nguyên)│ window.awog.{request,onEvent,...}
        ┌───────▼────────┐          ┌────────▼─────────────────┐
        │ Engine (utility│          │ Renderer (Chromium)       │
        │ process, Node) │          │ Nuxt SPA — useSidecar.ts  │
        │ rpc.ts dispatch│          │ (tái dùng, đổi nội bộ)    │
        │ 115 methods    │          └───────────────────────────┘
        │ SDK + Claude   │
        │ CLI subprocess │
        └────────────────┘
```

So với Tauri hiện tại: Rust `sidecar.rs` (spawn + NDJSON stdio bridge) → Electron main `engine.ts` (`utilityProcess.fork` + `postMessage` relay); Rust `commands.rs` (`sidecar_request`/`open_external`/`reveal_path`/`open_path`) → Electron `ipcMain.handle` + preload bridge; Tauri `app.emit("sidecar-event")` → Electron `webContents.send('engine:event')`.

## 3. Seam IPC — mapping cũ → mới

### 3.1 Phía UI (renderer) — chỉ 3 file đổi

| File | Hôm nay (Tauri) | Sau (Electron) |
|---|---|---|
| [composables/useSidecar.ts](../../apps/desktop/ui/composables/useSidecar.ts) | `invoke('sidecar_request')`, `listen('sidecar-event')`, `invoke('open_external'/'reveal_path'/'open_path')`; detect `'__TAURI_INTERNALS__' in window` | Bọc mỏng `window.awog.*` (xem §4); detect `!!window.awog`. **Giữ nguyên public API** (`available/request/onEvent/openExternal/revealPath/openPath`) → mọi call-site khác KHÔNG đổi. |
| [composables/useFolderPicker.ts](../../apps/desktop/ui/composables/useFolderPicker.ts) | lazy `import('@tauri-apps/plugin-dialog').open` | `window.awog.pickFolder(opts)` |
| [components/git/GitHistoryTable.vue](../../apps/desktop/ui/components/git/GitHistoryTable.vue) | lazy `import('@tauri-apps/plugin-dialog').save` (export patch) | `window.awog.saveFile(opts)` |

> Các file chỉ `import type { UnlistenFn } from '@tauri-apps/api/event'` ([useProjectWorkspace.ts](../../apps/desktop/ui/composables/useProjectWorkspace.ts), `CodeSourceControl.vue`, `WorkspaceTerminalInstance.vue`) → đổi sang type nội bộ `type UnlistenFn = () => void` (đã export sẵn từ `useSidecar`).

> **`available`:** hôm nay là giá trị tĩnh tính 1 lần (`isTauri()`). Trong Electron giữ ngữ nghĩa: `true` khi `window.awog` tồn tại, `false` khi chạy `pnpm dev` thuần browser → **mọi mock fallback hiện có vẫn hoạt động không sửa** (stores `workspace`/`tasks`/`sessions`/`git` đã check `sidecar.available`).

### 3.2 Lệnh shell (Rust `commands.rs` → Electron main)

| Lệnh cũ (Tauri command) | Electron tương đương | Ghi chú bảo mật giữ nguyên |
|---|---|---|
| `sidecar_request(method, params)` | `ipcMain.handle('engine:request')` → relay vào engine, trả result/error | Một boundary duy nhất (invariant #4). |
| `open_external(url)` | `ipcMain.handle('shell:openExternal')` → allowlist regex `^https://claude\.ai/oauth/authorize\?` rồi `shell.openExternal` | Giữ allowlist (chống mở URL tùy ý). |
| `reveal_path(workspaceRoot, path)` | `ipcMain.handle('shell:revealPath')` → `resolveInsideWorkspace` (canonicalize + `startsWith`) rồi `shell.showItemInFolder` | **Port nguyên logic `resolve_inside_workspace`** sang TS (invariant #2). |
| `open_path(workspaceRoot, path)` | `ipcMain.handle('shell:openPath')` → cùng validate rồi `shell.openPath` | nt. |
| (mới — gộp từ plugin-dialog) | `ipcMain.handle('dialog:pickFolder')` → `dialog.showOpenDialog({properties:['openDirectory']})` | |
| (mới — gộp từ plugin-dialog) | `ipcMain.handle('dialog:saveFile')` → `dialog.showSaveDialog` + ghi file | |

### 3.3 Sự kiện engine → UI

Tauri: engine `emit(type, payload)` → stdout `{method:'event', params:{type,payload}}` → Rust `app.emit('sidecar-event', payload)` → `listen('sidecar-event')`.

Electron: engine `postMessage({method:'event', params:{type,payload}})` → main nhận trên `child.on('message')`, nếu `method==='event'` thì `mainWindow.webContents.send('engine:event', params)` → preload `ipcRenderer.on('engine:event', (_e, payload) => handler(payload))`.

**Payload `{type, payload}` giữ y nguyên** → tất cả store subscribe (`task.*`, `mcp.status`, `*.fs-changed`, `session.chunk`, `git:status:changed`, `fs:changed`, terminal output…) **không phải sửa**.

### 3.4 RPC methods — không đổi

115 method ở [sidecar/src/methods/](../../apps/desktop/sidecar/src/methods/) (namespace: `auth` 2, `accounts`+`account.usage` 5, `sessions` 7, `projects` 5, `skills` 5, `mcp` 9, `agents` 5, `workflows` 4, `tasks` 11, `git` 38, `fs` 11, `terminal` 5, `ping` 1) — **giữ nguyên hoàn toàn**. Chỉ carrier (stdio → MessagePort) đổi; envelope JSON-RPC + `dispatch()` giữ nguyên.

## 4. Bridge `window.awog` (preload + contextBridge)

`preload.ts` (chạy sandboxed, chỉ dùng `ipcRenderer` + `contextBridge`):

```ts
// hình dạng API — khớp 1-1 với public API hiện tại của useSidecar
contextBridge.exposeInMainWorld('awog', {
  request: (method, params) => ipcRenderer.invoke('engine:request', { method, params: params ?? null }),
  onEvent: (handler) => {
    const listener = (_e, payload) => handler(payload)          // payload = {type, payload}
    ipcRenderer.on('engine:event', listener)
    return () => ipcRenderer.removeListener('engine:event', listener)   // UnlistenFn
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  revealPath: (root, path) => ipcRenderer.invoke('shell:revealPath', { root, path }),
  openPath: (root, path) => ipcRenderer.invoke('shell:openPath', { root, path }),
  pickFolder: (opts) => ipcRenderer.invoke('dialog:pickFolder', opts),
  saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
})
```

`ipcMain.handle('engine:request')` trả về `Promise` — lỗi engine ném ra reject → `ipcRenderer.invoke` reject → `useSidecar` bắt và bọc thành `SidecarError` (giữ `code`/`message`/`data`). Cần thống nhất shape lỗi: main serialize `{code,message,data}` (giống Rust hôm nay).

## 5. Engine launch + transport (đã pivot sau khi thử nghiệm)

> **Cập nhật 2026-06-04:** D2 ban đầu chốt `utilityProcess.fork` + `parentPort`, nhưng **thử nghiệm thực tế cho thấy `utilityProcess` KHÔNG nạp được engine**. Đã pivot sang `child_process.spawn` + `ELECTRON_RUN_AS_NODE` + giữ nguyên transport stdio. Xem §14.

**Vì sao bỏ `utilityProcess`:** `utilityProcess.fork(<engine>)` crash khi link ESM graph của engine:
```
TypeError: Cannot read properties of undefined (reading 'exports')
  at cjsPreparseModuleExports (node:internal/modules/esm/translators:379)
```
Electron's `utilityProcess` dùng **ESM loader đã vá**, vỡ khi một dependency CJS trong graph của engine bị cjs-preparse. (Engine nạp bình thường dưới `node` thuần / `ELECTRON_RUN_AS_NODE`.) Đây là giới hạn đã biết của `utilityProcess` với ESM. Thêm nữa, `utilityProcess` cũng **cấm pipe stdin** (`stdio[0]==='ignore'`), nên kể cả không crash cũng không tái dùng được stdio.

**Quyết định hiện tại:** `child_process.spawn(process.execPath, [enginePath], { env: { …, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe','pipe','pipe'] })`.
- `process.execPath` = binary Electron; `ELECTRON_RUN_AS_NODE=1` chạy nó như **Node thuần** → dùng **ESM loader chuẩn của Node** (engine nạp OK, đã verify ping round-trip).
- **Giữ nguyên transport stdio JSON-RPC hiện có** → **engine KHÔNG đổi một dòng nào** (tốt hơn cả kế hoạch). `engine.ts` (Electron main) reframe NDJSON + ghi stdin, đúng như Rust `sidecar.rs` cũ.
- Token vẫn ở engine process (invariant #1). Lifecycle: `before-quit → engine.stop()` (`child.kill()`); engine cũng tự `exit(0)` khi stdin đóng.

**Cạm bẫy `ELECTRON_RUN_AS_NODE`:**
- **Main process** TUYỆT ĐỐI không được set biến này, nếu không nó chạy như Node thuần (mất API `app`/`BrowserWindow`). Một số shell/CI export biến này global → `dev.mjs` **strip** nó khỏi env khi spawn Electron; engine child tự **thêm lại**.
- Bản đóng gói: **giữ fuse `runAsNode` BẬT** (mặc định) để `ELECTRON_RUN_AS_NODE` hoạt động trong packaged app.

> **Đã verify (headless):** real Electron main (`process.type=browser`) → `engine.start()` (spawn) → `ping` → `{pong:true}` qua stdio. ✅

**Module path:** `enginePath()` → dev `apps/desktop/sidecar/dist/lib/src/index.js`; prod `<resources>/sidecar/lib/src/index.js`.

## 6. Native modules (ABI Electron)

| Package | Loại | Cần rebuild theo Electron? |
|---|---|---|
| `@napi-rs/keyring` | N-API (node-api) | **Không** — N-API ABI ổn định xuyên Node/Electron. |
| `node-pty` | Native addon (node-gyp) | **Có** — phải khớp ABI của Electron. Dùng `@electron/rebuild` (hoặc prebuild đúng ABI) trong bước install/pack. |
| `chokidar`, `readdirp`, `zod` | Pure JS | Không. |
| `@anthropic-ai/claude-agent-sdk` | Pure JS + spawn CLI subprocess | Không (CLI là executable độc lập — xem §7). |

→ Thêm `@electron/rebuild` vào pipeline (postinstall/pack) cho `node-pty`. Engine chạy trong `utilityProcess` = runtime Node của Electron, nên ABI phải là ABI Electron, KHÔNG phải Node hệ thống.

## 7. ⚠️ Bundling Claude CLI native binary (bug đang làm bản Tauri lỗi)

**Triệu chứng:** runtime "native CLI binary for darwin-arm64 not found (--omit=optional)". **Nguyên nhân:** SDK ship CLI native qua `optionalDependencies` THEO platform (`@anthropic-ai/claude-agent-sdk-<os>-<arch>`, mỗi package chứa binary `claude`). Cách bundle Tauri (cp symlink pnpm có `dereference`) làm **rớt** package optional khi node_modules dạng pnpm isolated (package optional chỉ nằm trong `.pnpm`, không reachable từ top-level).

**Yêu cầu cho Electron:**
1. **`node-linker=hoisted`** cho engine (đặt `.npmrc` ở pnpm workspace root) → node_modules phẳng, `@anthropic-ai/claude-agent-sdk-<os>-<arch>` nằm top-level → flatten/copy không rớt.
2. **KHÔNG `--omit=optional`.** Đảm bảo install có platform package đúng host.
3. node_modules engine để **NGOÀI asar** hoặc `asarUnpack` package CLI (binary cần quyền `+x`, không chạy được từ trong asar).
4. **Build native per-OS** (matrix CI) — mỗi bản chứa đúng platform CLI.
5. **Fallback:** nếu vẫn khó resolve, set `options.pathToClaudeCodeExecutable` (option của SDK) trỏ binary tự bundle.

> Tái dùng được phần `compileTs` + `copyProductionDeps` (cp dereference) của `build.mjs` để tạo `dist/lib` + `dist/node_modules` phẳng → điểm vào cho `electron-builder`. **Bỏ** `copyNodeRuntime` + `writeLauncher` + `mirrorIntoTauri`.

## 8. Đóng gói (electron-builder)

Cấu hình `electron-builder` (khuyến nghị thay Forge — multi-target trong một config, khớp matrix đa-OS sẵn có):
- `files`: code main/preload + `apps/desktop/ui/.output/public` (SPA build).
- `extraResources`/`asarUnpack`: `sidecar/dist/{lib,node_modules}` — engine ngoài asar (CLI cần `+x`; native `.node` load nhanh hơn ngoài asar).
- `mac`: `dmg` + `zip`, `target.arch=arm64` (universal sau nếu cần). `nsis` (win) + `appImage`/`deb` (linux).
- `protocol`/`appId`: `guild.awog.desktop`.
- Bỏ `externalBin`/`resources` của Tauri.
- Load SPA prod qua custom protocol `app://` (đăng ký `protocol.handle`) thay `file://` — tránh lỗi đường dẫn tuyệt đối/asset của SPA Nuxt; dev trỏ `http://localhost:3030`.

## 9. CI / release (viết lại `release.yml`)

- Bỏ toolchain Rust + `tauri-action` + deps GTK/webkit Linux đặc thù Tauri.
- Matrix: macOS arm64 (`macos-14`), Linux x64 (`ubuntu-22.04`), Windows x64 (`windows-latest`).
- Mỗi runner: `pnpm install` (hoisted) → `@electron/rebuild` (node-pty) → `pnpm --filter @awog/sidecar build` (tsc + flatten deps, KHÔNG node-runtime) → `nuxt generate` (giữ `NODE_OPTIONS=--max-old-space-size=4096` chống OOM) → `electron-builder --publish` → draft GitHub Release.
- Verify version: đổi nguồn chân lý từ `tauri.conf.json` sang `package.json` (root) khớp tag.
- Code signing/notarize macOS: để **optional** qua secrets (giống workflow Tauri cũ) — unsigned vẫn build được cho test nội bộ.

## 10. Dọn Tauri + cập nhật docs (bước cuối, SAU khi Electron xanh)

- Xóa `apps/desktop/src-tauri/`, `@tauri-apps/cli` (root devDep), `@tauri-apps/api` + `@tauri-apps/plugin-dialog` (ui deps), script `tauri`/`tauri:dev` (root `package.json`), phần node-runtime/launcher trong `build.mjs`.
- Cập nhật: [ADR 0006](../decisions/0006-tauri-shell-for-nuxt.md)/[0007](../decisions/0007-bundle-nodejs-runtime.md)/[0008](../decisions/0008-stdio-ipc-for-sidecar.md) → **Superseded** (một phần) bởi 0027; [tech-stack.md](../architecture/tech-stack.md), [system-overview.md](../architecture/system-overview.md), `CLAUDE.md` (bảng stack + lệnh), `docs/release.md` (version sync: bỏ Cargo, nguồn = package.json).

## 11. Cạm bẫy đã biết

- **macOS unsigned + Gatekeeper quarantine** có thể chặn binary nhúng (CLI) khi TẢI VỀ → test: `xattr -dr com.apple.quarantine <App>`. Fix tận gốc = codesign + notarize (optional qua secrets). Build local không bị.
- **`nuxt generate` OOM** trên CI → giữ `NODE_OPTIONS=--max-old-space-size=4096`.
- **WKWebView quirks** (vd `<select>` bỏ padding → tự viết `AppSelect`) HẾT trên Chromium → có thể đơn giản hoá SAU (không bắt buộc trong migrate này).
- **Version sync**: nhiều file `version` (root + ui + sidecar `package.json`); bỏ `Cargo.toml`/`tauri.conf.json`.
- **`node-linker=hoisted`** đổi layout node_modules toàn workspace → chạy lại `pnpm install` + verify UI/engine vẫn typecheck/lint sau khi đổi.

## 12. Định nghĩa hoàn thành (DoD)

- `pnpm dev` mở app Electron, UI Nuxt chạy, gọi engine OK; **chat chạy được** (SDK spawn Claude CLI thành công — chính bug đang lỗi).
- Token **KHÔNG** lộ ra renderer (kiểm tra DevTools — không có token trong `window`/event/IPC payload).
- Bản đóng gói (dmg/nsis/AppImage/deb) chạy KHÔNG cần Node hệ thống; verify trong bundle có `@anthropic-ai/claude-agent-sdk-<os>-<arch>/…/claude` (binary +x) + chat OK (ít nhất macOS local; CI cho Linux/Windows).
- `typecheck` + `lint` sạch (UI + engine). ADR/docs cập nhật.

## 13. Task breakdown (commit nhỏ, một mục đích — nhánh `feat/electron-migration`)

1. **(spec)** Tài liệu này. ✅
2. **electron main shell** — `apps/desktop/electron/{main,preload}.ts` + `tsconfig` + scripts dev; BrowserWindow load `localhost:3030`, single-instance, tray, notification, lifecycle. (Chưa wire engine.)
3. **engine transport** — `transport/parentport.ts` + refactor `index.ts` (`handleMessage`); giữ `stdio.ts` cho dev standalone. Engine vẫn chạy được cả 2 chế độ.
4. **wire engine + IPC bridge** — `utilityProcess.fork` trong main; `ipcMain.handle('engine:request')` relay; `engine:event` forward; preload `window.awog`; sửa `useSidecar.ts` + `useFolderPicker.ts` + `GitHistoryTable.vue`. ✅ chat chạy dev.
5. **shell ops + dialog** — `openExternal`(allowlist)/`revealPath`/`openPath`(port `resolveInsideWorkspace`)/`pickFolder`/`saveFile`.
6. **packaging** — `electron-builder` config; `build.mjs` rút gọn (bỏ node-runtime/launcher); `@electron/rebuild` node-pty; `app://` protocol; verify CLI binary trong bundle + chat OK (macOS local).
7. **CI/release** — viết lại `release.yml` (matrix, electron-builder, version từ package.json); cập nhật `docs/release.md`.
8. **dọn Tauri** — xóa `src-tauri`, deps Tauri, scripts; cập nhật ADR 0006/0007/0008 + tech-stack + system-overview + CLAUDE.md.

## 14. Quyết định đã chốt với user (2026-06-04)

| # | Quyết định | Chốt |
|---|---|---|
| D1 | Công cụ đóng gói | ✅ **electron-builder** (một config ra đủ dmg/nsis/AppImage/deb, khớp matrix đa-OS). |
| D2 | Engine launch + transport | ⚠️ Ban đầu chốt `utilityProcess.fork` + `parentPort`, nhưng `utilityProcess` crash khi nạp ESM engine (§5). **Pivot → `child_process.spawn(process.execPath, ELECTRON_RUN_AS_NODE=1)` + transport stdio cũ** → engine KHÔNG đổi. Đã verify ping round-trip. |
