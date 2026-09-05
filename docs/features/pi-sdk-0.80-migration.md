# Migration Pi SDK 0.79.x → 0.80.x (hồ sơ lịch sử — ĐÃ XONG)

> **⚠ Tài liệu này đã lạc hậu, giữ lại làm hồ sơ.** Nó viết khi repo còn ở `^0.79.9` và mô tả 0.80 như task hoãn. Thực tế 0.80 đã làm từ lâu; repo đi tiếp qua 0.84.2 rồi lên **`^0.85.1`** (2026-09-05, xem [Track C của plan 0.3.260](./claude-agent-sdk-0.3.260-upgrade.md)). Phần còn giá trị của tài liệu này là **phương pháp**, không phải con số: bump Pi thì trial-upgrade + `tsc --noEmit` trước, đọc diff bề mặt type, rồi mới quyết định là *bump* hay *migration*. Mục "Lưu ý môi trường" ở cuối vẫn đúng.

Task **hoãn** (deferred): nâng `@earendil-works/pi-ai` + `@earendil-works/pi-agent-core` từ **0.79.9** lên **0.80.x** (latest 0.80.2 tại 2026-06-30). Liên quan [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (Pi là runtime LLM duy nhất).

## Vì sao hoãn (không làm ngay)

- **Breaking thật** — đã trial upgrade + `tsc --noEmit`: **6 lỗi / 6 file** (xem bảng dưới). Đây là migration, không phải bump.
- **0 lợi ích cho AWOG** — toàn refactor nội bộ Pi; **không** có commit nào về confab/tool-calling/feature AWOG cần (đã đọc commit GitHub `earendil-works/pi` trong cửa sổ 0.79.9→0.80.2).
- Vừa ship confab fix trên 0.79.9 đang ổn định → tránh thêm churn.
- An toàn sẵn: pin `^0.79.9` = `>=0.79.9 <0.80.0` → `pnpm install` chỉ tự lên tối đa 0.79.x, **không** tự nhảy 0.80.

## Khi nào nên làm (trigger)

Có driver cụ thể: cần provider/feature mới chỉ có ở 0.80.x, hoặc một bug fix của Pi mà AWOG đụng. Lúc đó mở task này thành nhánh `chore/pi-sdk-0.80` riêng, QA parity rồi mới cutover.

## 0.80.x đổi gì (đã verify)

| Nhóm | Nội dung | Ảnh hưởng |
|---|---|---|
| `feat(ai): complete models runtime migration` | `getModel`/`getModels`/`completeSimple` (free function) → gom vào aggregate **`Models`**; `generateSummary` đổi chữ ký nhận **`Models`** thay vì `Model<Api>` | 🔴 Breaking |
| `remove legacy raw API subpaths` | Bỏ export `./base` + subpath per-provider (`./anthropic`…), thêm `./compat` + `./providers/*` + `./api/*` | 🟡 AWOG chỉ import `.` + `/oauth` (cả hai còn) → **không vỡ import** |
| OAuth / cache / Claude-Code prepend | Giữ nguyên hành vi, chỉ **dời** `providers/anthropic.js` → `api/anthropic-messages.js` (`sk-ant-oat`, `"You are Claude Code…"`, `cache_control` đủ cả) | ✅ Nền tảng ADR 0029 an toàn |
| pi-agent-core public API | `runAgentLoop`/`runAgentLoopContinue`/`AgentLoopConfig` + hook (`getFollowUpMessages`/`getSteeringMessages`/`shouldStopAfterTurn`) **tên không đổi**; chỉ tinh chỉnh type `StreamFn` nội bộ | ✅ Confab guard wiring không bị động |

## Điểm vỡ cần sửa (typecheck trên 0.80.2)

| File | Lỗi |
|---|---|
| [runtime/model-resolver.ts](../../apps/desktop/sidecar/src/runtime/model-resolver.ts) | `getModel` không còn export |
| [runtime/complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts) | `completeSimple` không còn export |
| [runtime/run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts) (đường `/compact`) | `generateSummary` nhận `Models`, không nhận `Model<Api>` |
| [auth/openai-codex-oauth.ts](../../apps/desktop/sidecar/src/auth/openai-codex-oauth.ts) | `getModels` không còn export |
| [methods/auth.start-oauth-codex.ts](../../apps/desktop/sidecar/src/methods/auth.start-oauth-codex.ts) | `getModels` không còn export |
| [methods/accounts.test.ts](../../apps/desktop/sidecar/src/methods/accounts.test.ts) | `completeSimple` không còn export |

(+ các lỗi `implicitly any` ở callback là hệ quả khi function trên degrade về `any`.)

## Task checklist

- [ ] Tra API mới của `Models` runtime trong `@earendil-works/pi-ai@0.80.x` (`Models.getModel`/`getModels` + thay `completeSimple`); xác định cách lấy instance `Models`.
- [ ] Sửa [model-resolver.ts](../../apps/desktop/sidecar/src/runtime/model-resolver.ts): `getModel` → API `Models`.
- [ ] Sửa [complete.ts](../../apps/desktop/sidecar/src/runtime/complete.ts) + [accounts.test.ts](../../apps/desktop/sidecar/src/methods/accounts.test.ts): thay `completeSimple`.
- [ ] Sửa [run-stream.ts](../../apps/desktop/sidecar/src/runtime/run-stream.ts) `runCompact`: `generateSummary` truyền `Models`.
- [ ] Sửa codex OAuth: [openai-codex-oauth.ts](../../apps/desktop/sidecar/src/auth/openai-codex-oauth.ts) + [auth.start-oauth-codex.ts](../../apps/desktop/sidecar/src/methods/auth.start-oauth-codex.ts): `getModels` → API `Models`.
- [ ] `pnpm typecheck` xanh.
- [ ] QA parity (chạy app, account OAuth Anthropic): stream + 4 permission mode + MCP + resume + `/compact` + abort + prompt-cache token không lệch. Thêm OpenAI/Google nếu đang dùng.
- [ ] Cập nhật pin `^0.80.x` + lockfile; cập nhật [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (ghi version + API `Models`).

## Lưu ý môi trường

- Upgrade trong home-switcher này: `pnpm add`/`install` báo `ERR_PNPM_UNEXPECTED_STORE` → truyền `--store-dir <store đang link>` lấy từ chính message lỗi (xem `reference_pnpm_store_dir_mismatch`).
- Sửa code sidecar phải `tsc -p tsconfig.build.json` (rebuild `dist/lib`) + **restart app** — dev chạy từ `dist`, không watch.
