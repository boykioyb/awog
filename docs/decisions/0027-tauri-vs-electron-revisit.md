# 0027 — Shell desktop: Tauri vs Electron (revisit sau khi bundle Node)

- **Trạng thái:** Accepted — **Option B (migrate Electron)** (user/PO chốt 2026-06-04)
- **Ngày:** 2026-06-04
- **Người quyết định:** Tech Lead + user/PO
- **Revisits:** [0006](./0006-tauri-shell-for-nuxt.md) (Tauri shell), [0007](./0007-bundle-nodejs-runtime.md) (bundle Node)

## Bối cảnh

[ADR 0006](./0006-tauri-shell-for-nuxt.md) chọn Tauri **chủ yếu vì size**: *"binary ~10–20MB thay vì ~100MB (Electron)"*. [ADR 0007](./0007-bundle-nodejs-runtime.md) quyết bundle Node — nhưng mãi tới 2026-06-04 mới **thực sự** triển khai (download Node self-contained từ nodejs.org, ~136MB; xem lịch sử fix sidecar).

**Bằng chứng mới làm thay đổi cán cân:**

1. **App hiện ~250MB** (Node 136MB + node_modules 109MB + Rust shell ~15MB). → Lợi thế "binary nhỏ" — lý do *chính* chọn Tauri ở 0006 — **đã biến mất**.
2. **Engine bất khả-Rust:** lõi AWOG là `@anthropic-ai/claude-agent-sdk` (Node) + spawn Claude CLI (binary do SDK mang theo). Không thể viết lại sang Rust mà không phá hệ sinh thái SDK.
3. **Chi phí sidecar đã nếm thật:** vì Rust không chạy được engine Node, phải bundle Node riêng + chạy như **sidecar qua stdio** → saga packaging: PATH GUI app macOS không thấy `node`, dylib `@rpath/libnode`, externalBin + resources, launcher. Toàn bộ là hệ quả của việc ghép Rust-shell + Node-engine.
4. **WebView không đồng nhất:** Tauri dùng 3 engine (WKWebView/WebView2/WebKitGTK). Đã dính quirk thật — WKWebView bỏ qua `padding` của `<select>` native → phải tự viết `AppSelect`. Electron dùng một Chromium → render nhất quán.

Câu hỏi: với app mà **engine vĩnh viễn là Node**, Tauri có còn thắng Electron về dài hạn không?

## Quyết định (đề xuất)

> **Khuyến nghị: migrate sang Electron cho dài hạn** — vì AWOG là app Node-engine, Electron khớp tự nhiên hơn (Node là main process, không cần bundle Node riêng, không sidecar stdio, render UI nhất quán). **Trừ khi** RAM/footprint là NFR cứng *hoặc* không có băng thông migrate → khi đó **giữ Tauri** (đang chạy được).
>
> Vì pre-1.0 + codebase còn nhỏ → migrate **bây giờ rẻ nhất**; càng để lâu, mismatch Rust-shell↔Node-engine càng tốn.

Lưu ý: UI (Nuxt/Vue) + engine (TypeScript) **tái dùng gần như nguyên vẹn** ở cả hai — chỉ lớp shell + IPC + pipeline build là viết lại.

## Phương án đã cân nhắc

### So sánh (bối cảnh ĐÃ bundle Node)

| Tiêu chí | Tauri (hiện tại) | Electron |
|---|---|---|
| **Size** | ~250MB | ~250MB → **hoà** (lợi thế cũ của Tauri mất) |
| **RAM / startup** | ✅ thấp (native WebView) | ❌ cao hơn (Chromium) |
| **Khớp engine Node** | ❌ Node bundle riêng + sidecar stdio + packaging phức tạp | ✅ Node = main process, engine in-process/utility, IPC native |
| **Đồng nhất UI** | ❌ 3 webview, đã dính quirk WKWebView | ✅ một Chromium mọi OS |
| **Tray / notification / lifecycle** | ✅ (Rust plugin) | ✅ (native) → hoà |
| **Bảo mật shell** | ✅ Rust, surface nhỏ | ◑ ổn nếu contextIsolation + sandbox + utility process giữ key |
| **Maturity / ecosystem** | ◑ trẻ hơn | ✅ rất chín (VS Code, Slack…) |
| **Chi phí migrate** | 0 (đã xong + CI xanh) | ⚠️ một lần, đáng kể |

### Option A — Giữ Tauri (status quo)
- **Pros:** đã build + CI xanh; RAM thấp; bảo mật Rust shell.
- **Cons:** trả giá bundle Node + sidecar stdio mãi mãi; webview không đồng nhất; lý do size ban đầu không còn.
- **Hợp khi:** RAM/footprint là NFR cứng, hoặc cần ship ngay, không có băng thông migrate.

### Option B — Migrate sang Electron (KHUYẾN NGHỊ)
- **Pros:** Node first-class (engine chạy in-process hoặc forked utility, **không** bundle Node riêng, **không** mớ packaging vừa rồi); UI render nhất quán (bỏ được các workaround kiểu AppSelect); ecosystem chín.
- **Cons:** RAM cao hơn (Chromium); viết lại shell + IPC + pipeline; mất phần Tauri đã đầu tư.
- **Hợp khi:** ưu tiên đơn giản + nhất quán cho app Node-centric (đúng AWOG); chấp nhận chi phí migrate một lần khi còn sớm.

### Option C — Tauri + viết lại engine bằng Rust
- **Loại:** phá vỡ hệ SDK Anthropic/OpenAI (Node-only) + Claude CLI; chi phí khổng lồ. (Đã loại từ 0006.)

### Option D — Tauri nhưng KHÔNG bundle Node (dùng Node hệ thống)
- **Loại:** chính là bug "sidecar writer channel closed" vừa sửa — UX tệ (user phải tự cài Node, app GUI không thấy `node` trong PATH). Trái mục tiêu zero-dependency.

## Hệ quả

- **Nếu chọn B (Electron):**
  - **Việc cần làm (phác thảo migrate):**
    1. Electron **main process** thay Rust shell: cửa sổ, tray, notification, lifecycle, single-instance.
    2. Engine Node: chạy **utility process** (hoặc `child_process.fork`) để giữ invariant "API key không vào renderer". Có thể **tái dùng** JSON-RPC hiện tại nếu giữ engine là child process.
    3. IPC: renderer↔main qua `contextBridge`/`ipcRenderer` (contextIsolation + sandbox, **không** nodeIntegration).
    4. Đóng gói: `electron-builder`/`forge` → dmg/nsis/AppImage/deb; native deps + Claude CLI qua `asarUnpack`. Thay workflow `tauri-action`.
    5. UI Nuxt: gần như nguyên vẹn — chỉ đổi lớp gọi IPC; có thể bỏ bớt workaround webview (AppSelect → `<select>` native lại được).
  - **Ước lượng:** vài ngày → 1–2 tuần (engine + UI tái dùng; shell + IPC + pipeline viết lại + re-validate release).
  - Cập nhật ADR 0006/0007/0008 (superseded một phần), [tech-stack](../architecture/tech-stack.md), [system-overview](../architecture/system-overview.md).
- **Nếu chọn A (Tauri):** đóng ADR này là "giữ nguyên"; ghi nhận lý do size đã hết, lợi thế còn lại là RAM; tiếp tục đầu tư giảm footprint (lazy-load engine, prune node_modules).
- **Trade-off chung:** dù hướng nào, **footprint ~250MB là cố hữu** do engine Node + node_modules + Claude CLI — không nền tảng nào tránh được.

## Tham chiếu

- [0006](./0006-tauri-shell-for-nuxt.md) — chọn Tauri (lý do size, nay không còn).
- [0007](./0007-bundle-nodejs-runtime.md) — quyết bundle Node (vừa triển khai thật).
- [0008](./0008-stdio-ipc-for-sidecar.md) — stdio IPC sidecar (lớp sẽ thay nếu chọn Electron).
- [non-functional-requirements](../requirements/non-functional-requirements.md) — NFR footprint/RAM cần đối chiếu để chốt.
