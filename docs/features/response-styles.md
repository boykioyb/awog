# Feature: Response Styles (phong cách trả lời cho Session)

> ADR liên quan: [0046-session-response-styles](../decisions/0046-session-response-styles.md). Mô hình tham chiếu: [Rules](./rules.md) (inject `systemPromptAppend`) + [Slash Commands](./slash-commands.md) (composer `/command`).

## Vấn đề

Người dùng muốn điều khiển **giọng văn + định dạng** câu trả lời của trợ lý trong một Session (ví dụ: ngắn gọn kiểu quân đội, Socratic để học sâu, BLUF khi cần kết luận trước) mà **không** phải gõ lại chỉ dẫn mỗi lượt. Chỉ dẫn này cần:

- Áp dụng cho **mọi lượt trả lời sau** trong session, cho tới khi đổi/tắt.
- **Sống qua restart** (persist theo session).
- Chỉ đổi **cách trình bày**, **không** đổi tính đúng đắn kỹ thuật và **không** đổi nội dung code block.

## Phạm vi (v1)

| Trong scope | Ngoài scope (v1) |
|---|---|
| 13 style **built-in cố định** (read-only) | User tự tạo/sửa style (CRUD, 2-tier như Rules) |
| Modifier `plain text (no markdown)` chồng lên style | Style theo từng agent / từng project |
| Áp dụng cho **Sessions** | Áp dụng cho **Tasks** (node/workflow) |
| Chip picker trong composer + lệnh `/style` mở menu | Style tự đổi theo ngữ cảnh (auto-detect) |
| Persist per-session (`SessionSettings`) | Đồng bộ style giữa các session (mỗi session độc lập) |

## Bộ style

**💬 Normal — mặc định:** không inject directive nào (`responseStyle === undefined`). Đây là trạng thái khởi tạo của mọi session; chọn "Normal" = gỡ style đang dùng.

13 style built-in, nhóm theo mục đích (id là contract giữa UI ↔ sidecar):

**⚡ Khi cần nhanh, gọn:** `military`, `caveman`, `reality-check`, `step-by-step`, `socratic`, `bluf`
**😄 Cho vui:** `yoda`, `pirate`, `hacker-80s`, `dad-joke`
**🧠 Khi cần hiểu thật sự:** `rubber-duck`, `feynman`, `first-principles`

Mỗi style có 1 directive ngắn (system-prompt). Modifier `plain text (no markdown)` strip toàn bộ markdown khỏi output (chồng lên style, hoặc dùng độc lập — orthogonal với Normal).

## Luồng người dùng

1. Trong composer, người dùng bấm chip **Style** (cạnh chip account/model) → popover liệt kê 13 style theo nhóm + toggle "Plain text" + nút "No style".
2. Hoặc gõ `/style` trong ô soạn → cùng popover bật lên (lệnh là *hành động*, không chèn text).
3. Chọn 1 style → lưu vào `session.settings.responseStyle`, chip hiển thị tên style.
4. Từ lượt kế tiếp, sidecar inject directive vào `systemPromptAppend` → trợ lý trả lời theo style.
5. Đổi style/bật-tắt `no markdown`/chọn "No style" bất kỳ lúc nào; có hiệu lực ngay ở lượt sau.

## Acceptance Criteria

- **AC1 — Chọn style:** Given session bất kỳ, When chọn style `bluf` qua chip, Then lượt trả lời tiếp theo bắt đầu bằng "BLUF: …" và `session.settings.responseStyle === 'bluf'`.
- **AC2 — Persist:** Given đã chọn style, When restart app, Then chip vẫn hiển thị style đã chọn (đọc từ JSONL).
- **AC3 — `/style`:** Given composer trống, When gõ `/style` rồi chọn từ autocomplete, Then popover style mở ra, text `/style` bị xoá khỏi ô soạn, KHÔNG gửi message.
- **AC4 — Normal (default):** Given session mới, Then chip hiển thị "Normal" và "Normal" được check trong popover (`responseStyle === undefined`, không inject directive). When đang có style và bấm "Normal", Then `responseStyle` về `undefined` và lượt sau trả lời như mặc định.
- **AC5 — No-markdown:** Given bật toggle "Plain text", When trả lời, Then output không có markdown (không bold/bullet/header).
- **AC6 — Per-session:** Given session A chọn `yoda`, When mở session B, Then session B KHÔNG bị áp `yoda` (mỗi session độc lập — khác `mode`).
- **AC7 — Không phá code:** Given style `pirate`/`yoda`, When trả lời có code block, Then nội dung code block giữ nguyên (chỉ prose đổi giọng).
- **AC8 — Tasks không đổi:** Given một Task chạy, Then output Task KHÔNG bị áp response style (chỉ Sessions).

## Edge case

- Style id lạ (UI mới hơn sidecar, hoặc JSONL hỏng) → `buildStylePrompt` trả `undefined` (no style), không chặn lượt. **Fail-safe.**
- Không chọn style nhưng bật `no markdown` → vẫn inject directive plain-text độc lập.
- Style directive **luôn là augment** (append sau prompt agent + rules), không thay thế identity của agent (ADR 0015) hay rules (ADR 0033).
- Thứ tự inject: `systemPromptAppend(MCP) → rules → response-style → VERIFY → …` (response-style sau rules, trước VERIFY).

## Default (session + project)

- **App-level:** `DEFAULT_SETTINGS` (stores/sessions.ts) khai báo tường minh `responseStyleNoMarkdown: false`; không set `responseStyle` ⇒ session mới mặc định **Normal**.
- **Per-project:** `ProjectLlmDefaults` (UI + sidecar) thêm `responseStyle` + `responseStyleNoMarkdown` — mỗi project chọn style mặc định riêng qua modal **"Session defaults"** (ProjectLlmDefaultsModal). `settingsForProject()` merge style của project vào session mới (omit = Normal). Persist qua `projects.upsert` (LlmDefaultsSchema). Session vẫn override được bằng chip/`/style` sau khi tạo.

## Tích hợp

- **Sidecar:** `src/style/styles.ts` (directive map + `buildStylePrompt`), inject ở `runtime/run-stream.ts`. `SessionSettings` + `ProjectLlmDefaults` (shared.ts) + schema/`toSessionSettings` ở `sessions.send-message.ts`, `sessions.upsert.ts`, `projects.upsert.ts`.
- **UI:** `utils/response-styles.ts` (catalog hiển thị), `components/session/SessionStylePicker.vue` (chip + popover), `utils/session-catalog.ts` (`/style` command), `SessionComposer.vue` (render + dispatch), `useProjectLlmDefaults.ts` + `ProjectLlmDefaultsModal.vue` (default per-project). Persist per-session qua `store.updateSettings(sessionId, { responseStyle, responseStyleNoMarkdown })` (không mirror sang session khác).

## Bảo mật

- Directive là **hằng số hardcode** trong sidecar → không có bề mặt prompt-injection từ file/UI (khác Rules đọc file). UI chỉ gửi `responseStyle` (id) + `responseStyleNoMarkdown` (boolean); sidecar tự resolve directive. Đúng invariant "UI không inject prompt thô".
