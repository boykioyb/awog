# 0031 — Bundle RTK (Rust Token Killer) làm bộ nén output cho Bash tool

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-11
- **Người quyết định:** tech-lead (theo yêu cầu user)

## Bối cảnh

Agent của AWOG chạy lệnh shell qua **Bash tool** của Pi runtime ([`runtime/tools/bash-tool.ts`](../../apps/desktop/sidecar/src/runtime/tools/bash-tool.ts)): `spawn('sh', ['-c', command])`, gom stdout/stderr (cap 64 KiB) rồi trả **nguyên văn** vào context model cho lượt kế tiếp. Output các lệnh như `git diff`, `pnpm test`, `eslint`, `ls -R` thường rất dài và lặp → đốt token vô ích.

[RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer, **MIT license**) là CLI proxy nén output lệnh dev **60–90%** trước khi vào context LLM, overhead <10ms, single binary zero-dependency. Cơ chế chuẩn của RTK với Claude Code là PreToolUse hook viết lại `git status` → `rtk git status`. Nhưng **AWOG không chạy qua Claude Code**, nên hook `rtk init -g` vô tác dụng — phải tự wire vào Bash tool.

Ràng buộc AWOG liên quan: invariant #1 (API key không rời sidecar), #5 (no telemetry), boundary IPC, và quy tắc "không thêm dependency lớn khi chưa có ADR".

## Quyết định

1. **Wire RTK vào DUY NHẤT Bash tool.** Khi bật + binary probe OK, Bash tool prepend đường dẫn binary vào command: `sh -c "<rtkBin> <command>"`. RTK chạy tool gốc, nén output, **giữ nguyên exit code**; lệnh không hỗ trợ pass-through. `details.command` giữ lệnh gốc để trace/UI hiển thị sạch.
2. **Bundle binary rtk theo từng nền tảng** (không bắt user tự cài, không dò PATH). [`scripts/fetch-rtk.mjs`](../../apps/desktop/electron/scripts/fetch-rtk.mjs) tải binary cho host từ GitHub releases (pin `v0.42.3`), verify SHA256, giải nén vào `electron/resources/rtk/`; electron-builder ship qua `extraResources`. Electron main truyền đường dẫn tuyệt đối qua env `AWOG_RTK_BIN` lúc spawn engine; sidecar đọc env này.
3. **Toggle ở Settings → Workspace**, mặc định ON (binary luôn có sẵn). UI push cờ xuống sidecar qua RPC `settings.set-rtk` (hiệu lực ngay, không restart). Graceful fallback: thiếu/lỗi binary hoặc toggle off → lệnh chạy raw như cũ.

**Ranh giới (bất biến):** KHÔNG wire vào `git/runner.ts` (output được parse thành record có cấu trúc, không vào LLM — RTK sẽ phá parser), KHÔNG wire vào terminal PTY (output stream ra UI cho người dùng, không vào LLM), KHÔNG đụng fs Read/Grep/Glob (tool TS native, không phải lệnh shell).

## Phương án đã cân nhắc

- **External + dò PATH (user tự cài rtk):** nhẹ nhất, không đụng build. Từ chối vì phụ thuộc máy user, hành vi không nhất quán, và user yêu cầu rõ "tích hợp vào AWOG luôn".
- **Reimplement filter của RTK bằng TS native:** không cần binary ngoài, full control. Từ chối vì công sức rất lớn (port 100+ command heuristic), khó giữ parity, là "reinvent the wheel" (vi phạm KISS/DRY).
- **Cài rtk qua npm dependency:** bất khả — RTK không phát hành gói npm (chỉ prebuilt binary / brew / `cargo install --git`; `cargo install rtk` còn cài nhầm "Rust Type Kit").

## Hệ quả

- **Tích cực:** tiết kiệm 60–90% token cho output lệnh shell của agent; trong suốt với người dùng (trace vẫn hiện lệnh gốc); "just works" sau cài đặt; tách bạch khỏi git manager/terminal nên không rủi ro parser.
- **Tiêu cở / Trade-off:**
  - Thêm ~7.4 MB binary mỗi nền tảng vào bản đóng gói.
  - Trở thành **redistributor** của binary bên thứ ba → cần kiểm soát supply-chain: pin version + verify SHA256 (fail build nếu lệch), commit bảng checksum trong `fetch-rtk.mjs`.
  - Compound command (`a && b`) chỉ wrap phần đầu — giống hành vi hook upstream của RTK; chấp nhận (KISS).
  - macOS: khi bật code-signing/notarize (hiện mặc định **unsigned** — `electron-builder.yml`), binary rtk trong `extraResources` phải được ký cùng app.
- **Việc cần làm tiếp:**
  - Khi bump version rtk: cập nhật `VERSION` + bảng `ASSETS`/SHA256 trong `fetch-rtk.mjs`.
  - Khi bật signing mac: bổ sung bước ký binary `extraResources`.
  - (v2) cân nhắc surface analytics tiết kiệm (`rtk gain`) và cờ `--ultra-compact`.

## Tham chiếu

- Feature spec: [docs/features/rtk-token-proxy.md](../features/rtk-token-proxy.md)
- [ADR 0029 — migrate LLM runtime to Pi SDK](0029-migrate-llm-runtime-to-pi-sdk.md) (Bash tool thuộc Pi runtime)
- [ADR 0019 — PTY terminal in sidecar](0019-pty-terminal-in-sidecar.md) (ranh giới: terminal không đụng)
- [ADR 0017 — Git Manager IPC contract](0017-git-manager-ipc-contract.md) (ranh giới: runGit không đụng)
- RTK upstream: https://github.com/rtk-ai/rtk (MIT)
