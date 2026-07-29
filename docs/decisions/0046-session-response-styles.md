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

## Cập nhật

- **2026-07-15 — +8 style + info-popover.** Bổ sung 8 style built-in vào đúng 3 nhóm hiện có (không tạo nhóm mới): **fast** — `checklist`, `code-first`; **deep** — `devils-advocate`, `mentor`, `pair`; **fun** — `noir`, `speedrun`, `corporate`. Nâng tổng lên **21 style**. Directive vẫn CHỈ sống ở `sidecar/src/style/styles.ts`; UI (`ui-next`) chỉ gửi slug + cờ `noMarkdown`; slug lạ vẫn degrade "no style". Catalog hiển thị đồng bộ ở `ui-next/composables/useSessionModelConfig.ts` (thay cho `ui/utils/response-styles.ts` — build cũ, không cập nhật). Label/hint/desc đã i18n-hoá (`en/vi` `sessions-composer.json`), khác ghi chú "chưa i18n" ở phần Hệ quả (đã migrate cho bề mặt style picker mới ở status bar).
- Kèm **info-popover mô tả**: mỗi row style trong `StatusConfig.vue` có nút `info` (icon `i-info`) mở card mô tả (title = name, body = key mới `.desc`), chỉ 1 card mở tại một thời điểm, đóng bằng bấm lại / Esc / chọn style / đóng menu. Card neo BÊN TRÁI menu style (ngoài vùng `overflow-y:auto` của menu) để không bị clip / tràn mép phải. A11y: nút `type=button` + `aria-label` (`sessions.style.infoLabel`) + `aria-expanded`; card `role=dialog` + `aria-labelledby`/`aria-describedby`.
- **2026-07-29 — +Auto (meta-style tự chọn theo ngữ cảnh).** Đảo mục "Style tự đổi theo ngữ cảnh (auto-detect)" từ ngoài-scope-v1 thành **có** qua slug `auto`. Phương án chốt: **pure prompt self-select, KHÔNG router** — `buildStylePrompt('auto', …)` build 1 khối `<response-style>` gồm chỉ dẫn "mỗi lượt tự chọn 1 style hợp nhất" + menu compact tái dùng verbatim `STYLE_DIRECTIVES`. Không gọi model phụ → 0 token/latency thêm (khối trong system prompt đã prompt-cache), giữ đúng invariant "directive là hằng số sidecar, UI chỉ gửi slug". Loại router-classifier vì tốn tiền/latency mỗi lượt + phức tạp hot path (ngược KISS + budget guard). Menu = `AUTO_CANDIDATES` (13 style nhóm fast+deep), **loại** nhóm fun + `caveman` (giọng đùa không tự áp task thật); Normal là fallback ngầm. UI: thêm row `Auto` (slug `auto`, icon `sparkles`) vào nhóm `default` cạnh Normal + i18n `sessions.style.auto.{name,hint,desc}` (en/vi). Xem [spec §Auto](../features/response-styles.md#auto--tự-chọn-style-theo-ngữ-cảnh).

## Tham chiếu

- Spec: [docs/features/response-styles.md](../features/response-styles.md)
- [ADR 0033 — Rules inject](./0033-rules-system-prompt-injection.md), [ADR 0034 — Slash Commands](./0034-slash-commands-markdown.md), [ADR 0015 — Agent systemPrompt identity](./0015-agents-persisted-runtime-systemprompt.md)
