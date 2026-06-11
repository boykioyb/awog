# RTK Token Proxy — nén output lệnh shell cho agent

> Tích hợp [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) để nén output lệnh shell mà agent chạy, giảm token nạp vào context model. Quyết định kiến trúc: [ADR 0031](../decisions/0031-rtk-token-proxy.md).

## Mục tiêu

Khi agent (Pi runtime) gọi **Bash tool**, output thô (cap 64 KiB) đi thẳng vào prompt model. Các lệnh dev (`git diff`, `pnpm test`, `eslint`, `ls -R`…) cho output dài/lặp → đốt token. RTK nén 60–90% trước khi output tới model, trong suốt với người dùng.

## Phạm vi (v1)

- ✅ Wire RTK vào **Bash tool** của sidecar.
- ✅ Bundle binary rtk theo nền tảng vào app (không bắt user cài).
- ✅ Toggle bật/tắt ở Settings → Workspace, mặc định ON, hiệu lực ngay.
- ❌ KHÔNG áp cho Git Manager (`runGit`), terminal PTY, fs Read/Grep/Glob, MCP tools.
- ❌ KHÔNG làm analytics (`rtk gain`) — để v2.

## Hành vi

1. **Bật + binary OK:** lệnh `git status` chạy như `<rtkBin> git status` qua `sh -c`. RTK nén output, giữ exit code. Lệnh không hỗ trợ → pass-through nguyên bản.
2. **Trace fidelity:** UI/step hiển thị lệnh gốc (`git status`), không phải lệnh đã wrap.
3. **Tắt toggle:** lệnh chạy raw, không restart engine.
4. **Graceful fallback:** thiếu/lỗi binary trên nền tảng hiện tại → chạy raw, không lỗi; Settings hiện "binary not available on this platform".
5. **Compound command** (`a && b`): chỉ wrap phần đầu (giống hook upstream RTK) — chấp nhận.

## Kiến trúc / luồng

```
UI toggle (settings store, awog.rtk.v1)
  └─ useRtkSettings() → RPC settings.set-rtk { enabled }   (app.vue startup + on change)
        └─ sidecar setRtkEnabled() → trả { enabled, available, version }

Electron main spawn engine
  └─ env AWOG_RTK_BIN = rtkBinPath()  (paths.ts: packaged resourcesPath/rtk | dev resources/rtk)

Agent Bash tool execute()
  └─ wrapCommand(command)  (runtime/tools/rtk.ts: probe `<bin> --version` memoized; prepend nếu enabled+available)
        └─ spawn('sh', ['-c', wrapped])  + env DO_NOT_TRACK=1
```

## Files chính

| Lớp | File | Vai trò |
|---|---|---|
| Sidecar | [`runtime/tools/rtk.ts`](../../apps/desktop/sidecar/src/runtime/tools/rtk.ts) | probe binary + config enabled + `wrapCommand` |
| Sidecar | [`runtime/tools/bash-tool.ts`](../../apps/desktop/sidecar/src/runtime/tools/bash-tool.ts) | gọi `wrapCommand` trước spawn + `DO_NOT_TRACK=1` |
| Sidecar | [`methods/settings.set-rtk.ts`](../../apps/desktop/sidecar/src/methods/settings.set-rtk.ts) | RPC nhận toggle, trả status |
| Electron | [`src/paths.ts`](../../apps/desktop/electron/src/paths.ts) `rtkBinPath()` | resolve đường dẫn dev/packaged |
| Electron | [`src/engine.ts`](../../apps/desktop/electron/src/engine.ts) | truyền `AWOG_RTK_BIN` lúc spawn |
| Build | [`scripts/fetch-rtk.mjs`](../../apps/desktop/electron/scripts/fetch-rtk.mjs) | tải + verify SHA256 + giải nén binary (pin v0.42.3) |
| Build | [`electron-builder.yml`](../../apps/desktop/electron/electron-builder.yml) | `extraResources` ship binary |
| UI | [`stores/settings.ts`](../../apps/desktop/ui/stores/settings.ts) | `RtkSettings` + `rtkStatus` + actions |
| UI | [`composables/useRtkSettings.ts`](../../apps/desktop/ui/composables/useRtkSettings.ts) | persist + push xuống sidecar |
| UI | [`components/settings/SettingsWorkspaceSection.vue`](../../apps/desktop/ui/components/settings/SettingsWorkspaceSection.vue) | toggle + dòng trạng thái |

## Acceptance Criteria

- **AC1** — Bật toggle + binary có: agent chạy `git status`/`ls -la` qua Bash → output trong trace đã nén, token usage giảm; exit code lệnh fail vẫn đúng (`(exit code N)`).
- **AC2** — Tắt toggle (không restart): bash kế tiếp chạy raw; bật lại → nén lại.
- **AC3** — Graceful fallback: xoá binary khỏi `resources/rtk/` → bash chạy raw, không lỗi; Settings hiện "not available".
- **AC4** — Ranh giới: Git Manager (status/diff/log) parse chuẩn, KHÔNG bị đụng; Terminal tab tương tác bình thường.
- **AC5** — Supply-chain: `fetch-rtk.mjs` fail build nếu SHA256 lệch.
- **AC6** — Invariant: không secret nào lọt vào lệnh rtk (env allowlist giữ nguyên); `DO_NOT_TRACK=1` set; không telemetry.

## Edge cases

- Binary thiếu cho nền tảng (vd CI chưa map arch): `fetch-rtk.mjs` exit 1 → build fail rõ ràng; runtime probe trả `available:false` → fallback raw.
- Engine chưa sẵn sàng lúc app start: push toggle best-effort, swallow lỗi; sidecar mặc định ON; re-push khi mở Settings.
- Đường dẫn binary có khoảng trắng: `wrapCommand` POSIX single-quote.

## Out of scope (v1)

Analytics `rtk gain`; cờ `--ultra-compact`; RTK cho terminal/MCP; exclude theo lệnh phía AWOG (dùng `~/.config/rtk/config.toml` của RTK).
