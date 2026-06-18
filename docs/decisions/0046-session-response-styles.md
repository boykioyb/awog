# 0046 — Response Styles cho Session (system-prompt inject, built-in cố định)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-18
- **Người quyết định:** Product Owner (user chốt 3 lựa chọn thiết kế) + Tech Lead

## Bối cảnh

User muốn chọn **phong cách trả lời** (giọng văn + định dạng) cho trợ lý trong một Session — ví dụ Military (ngắn, fact-only), BLUF (kết luận trước), Socratic (hỏi để học), Yoda/Pirate (cho vui) — dựa trên một "Style Switcher" skill có sẵn 13 style + modifier `terminal CLI / no markdown`. Yêu cầu: chọn một lần, áp cho **mọi lượt sau** trong session, sống qua restart, đổi/tắt bất kỳ lúc nào.

Hai feature gần nhất đã có:
- **Rules** ([ADR 0033](./0033-rules-system-prompt-injection.md)): inject `<workspace-rules>` vào `systemPromptAppend` (augment, không replace), 2-tier file, áp cho Sessions + Tasks.
- **Slash Commands** ([ADR 0034](./0034-slash-commands-markdown.md)): composer `/name` bung client-side, không auto-apply.

Response style là lai giữa hai: **auto-apply per-turn** như Rules, nhưng **chọn từ menu cố định** + có lối tắt `/style` như Commands.

## Quyết định

User chốt cả 3 (đề xuất "Recommended"):

1. **13 style built-in cố định** (read-only, hardcode trong sidecar) — KHÔNG CRUD/2-tier như Rules. UI gửi `responseStyle` (id) + `responseStyleNoMarkdown` (boolean); **sidecar tự resolve directive** → không có bề mặt prompt-injection từ file/UI.
2. **Chỉ Sessions.** Inject ở `runtime/run-stream.ts`; **KHÔNG** đụng `runtime/invoke.ts` (Tasks). Style là khái niệm hội thoại; style đùa (Yoda/Pirate) vô nghĩa cho task tự động.
3. **Chip picker + `/style`.** Chip trong composer (cạnh account/model) mở popover; `/style` là session-command (`SessionCommandAction` type `style`) dispatch mở cùng popover (hành động, không chèn text — như `/mode`). Popover có **"Normal" là mặc định** (option đầu, check sẵn): `responseStyle === undefined` = không inject directive — đúng trạng thái app trước feature này. Chọn "Normal" = gỡ style. Chip hiển thị "Normal" khi chưa chọn style nào.

Inject như Rules — **augment, không replace** — wrap trong `<response-style>`, đặt **sau rules, trước VERIFY_PROMPT** trong `appendParts`. Directive chỉ đổi tone/format, có guardrail "không đổi tính đúng đắn, không đổi nội dung code block".

Persist trong `SessionSettings.responseStyle` + `responseStyleNoMarkdown` (per-session JSONL, restart-safe). Dùng `store.updateSettings` sẵn có — **KHÔNG mirror** sang session khác (khác `mode`).

## Phương án đã cân nhắc

- **Style set — built-in cố định (CHỌN) vs 2-tier editable như Rules:** built-in khớp đúng 13 style user dán, KISS/YAGNI (không storage/watcher/trang quản lý/RPC CRUD), và bịt prompt-injection. Editable mạnh hơn nhưng = clone nguyên feature Rules cho nhu cầu chưa tồn tại.
- **Scope — Sessions-only (CHỌN) vs Sessions+Tasks:** style là hội thoại; áp vào Tasks rộng nhưng đa số style vô nghĩa cho output máy. Có thể mở rộng sau (inject point ở `invoke.ts` đã sẵn).
- **UI — chip + `/style` (CHỌN) vs `/style` chat-menu round-trip:** chip persisted/state rõ, native như model picker; chat-menu trung thành skill gốc nhưng tốn token mỗi lần đổi và không có state hiển thị.
- **Vị trí directive vs chỉ dẫn:** đặt sau rules để rules (chỉ dẫn workspace) vẫn ưu tiên ngữ nghĩa; style chỉ phủ lên tone/format.

## Hệ quả

**Tích cực:** đơn giản, restart-safe, fail-safe (id lạ → no style), không bề mặt bảo mật mới, tái dùng hạ tầng `systemPromptAppend` + `updateSettings`.

**Đánh đổi / nợ:** id style phải đồng bộ thủ công giữa `sidecar/src/style/styles.ts` (directive) và `ui/utils/response-styles.ts` (hiển thị) — lệch thì sidecar trả undefined (an toàn, mất style âm thầm). Style label/hint giữ hằng số tiếng Anh trong catalog (mirror `MODE_OPTIONS`/`SESSION_COMMANDS` — bề mặt composer hiện chưa i18n), khác quy ước i18n chung; migrate sang i18n khi i18n-hoá toàn bộ composer.

## Tham chiếu

- Spec: [docs/features/response-styles.md](../features/response-styles.md)
- [ADR 0033 — Rules inject](./0033-rules-system-prompt-injection.md), [ADR 0034 — Slash Commands](./0034-slash-commands-markdown.md), [ADR 0015 — Agent systemPrompt identity](./0015-agents-persisted-runtime-systemprompt.md)
