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
| Chip picker trong composer + lệnh `/style` mở menu | ~~Style tự đổi theo ngữ cảnh (auto-detect)~~ → đã thêm **Auto** (xem [Auto](#auto-tự-chọn-style-theo-ngữ-cảnh)) |
| Persist per-session (`SessionSettings`) | Đồng bộ style giữa các session (mỗi session độc lập) |

## Bộ style

**💬 Normal — mặc định:** không inject directive nào (`responseStyle === undefined`). Đây là trạng thái khởi tạo của mọi session; chọn "Normal" = gỡ style đang dùng.

13 style built-in, nhóm theo mục đích (id là contract giữa UI ↔ sidecar):

**⚡ Khi cần nhanh, gọn:** `military`, `caveman`, `reality-check`, `step-by-step`, `socratic`, `bluf`
**😄 Cho vui:** `yoda`, `pirate`, `hacker-80s`, `dad-joke`
**🧠 Khi cần hiểu thật sự:** `rubber-duck`, `feynman`, `first-principles`

Mỗi style có 1 directive ngắn (system-prompt). Modifier `plain text (no markdown)` strip toàn bộ markdown khỏi output (chồng lên style, hoặc dùng độc lập — orthogonal với Normal).

## Auto — tự chọn style theo ngữ cảnh

**✨ Auto** (slug `auto`) là **meta-style**: thay vì 1 directive cố định, model tự chọn **1 style hợp nhất cho mỗi lượt** dựa trên message + bản chất task, và lựa chọn có thể đổi giữa các lượt.

- **Pure prompt, không router.** `buildStylePrompt('auto', …)` trả về khối `<response-style>` chứa: chỉ dẫn self-select per-turn + menu compact tái dùng **verbatim** `STYLE_DIRECTIVES` (một nguồn sự thật). Không gọi model phụ → không tốn thêm token/latency (khối nằm trong system prompt đã prompt-cache).
- **Chỉ style "nghiêm túc".** Menu Auto = `AUTO_CANDIDATES` (nhóm fast + deep, 13 style), **loại** nhóm fun (pirate/yoda/dad-joke/noir/speedrun/corporate) + `caveman` — giọng đùa không bao giờ tự áp vào task thật. Normal là fallback ngầm ("nếu không style nào hợp → trả lời bình thường").
- **Không tự khai.** Model KHÔNG announce style đã chọn, chỉ trả lời theo giọng đó. Guardrail giữ nguyên: chỉ đổi tone/format, không đổi tính đúng đắn / nội dung code block.
- **Stack với no-markdown** như mọi style khác.
- Persist như style thường (`session.settings.responseStyle === 'auto'`), restart-safe, per-session.

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
- **AC9 — Auto:** Given chọn style `auto`, Then `session.settings.responseStyle === 'auto'` và mỗi lượt trợ lý trả lời theo style tự chọn hợp ngữ cảnh (không announce style), KHÔNG bao giờ dùng nhóm fun/`caveman`; đổi task giữa các lượt có thể đổi style.

## Edge case

- Style id lạ (UI mới hơn sidecar, hoặc JSONL hỏng) → `buildStylePrompt` trả `undefined` (no style), không chặn lượt. **Fail-safe.**
- Không chọn style nhưng bật `no markdown` → vẫn inject directive plain-text độc lập.
- Style directive **luôn là augment** (append sau prompt agent + rules), không thay thế identity của agent (ADR 0015) hay rules (ADR 0033).
- Thứ tự inject: `systemPromptAppend(MCP) → rules → response-style → VERIFY → …` (response-style sau rules, trước VERIFY).

## Default (session + project)

- **App-level:** `DEFAULT_SETTINGS` (stores/sessions.ts) khai báo tường minh `responseStyleNoMarkdown: false`; không set `responseStyle` ⇒ session mới mặc định **Normal**.
- **Per-project:** `ProjectLlmDefaults` (UI + sidecar) thêm `responseStyle` + `responseStyleNoMarkdown` — mỗi project chọn style mặc định riêng qua modal **"Session defaults"** (ProjectLlmDefaultsModal). `settingsForProject()` merge style của project vào session mới (omit = Normal). Persist qua `projects.upsert` (LlmDefaultsSchema). Session vẫn override được bằng chip/`/style` sau khi tạo.

## Tích hợp

- **Sidecar:** `src/style/styles.ts` (directive map + `AUTO_CANDIDATES` + `buildStylePrompt` — nhánh `auto` build menu từ chính directive map), inject ở `runtime/run-stream.ts`. `SessionSettings` + `ProjectLlmDefaults` (shared.ts) + schema/`toSessionSettings` ở `sessions.send-message.ts`, `sessions.upsert.ts`, `projects.upsert.ts`.
- **UI:** `utils/response-styles.ts` (catalog hiển thị), `components/session/SessionStylePicker.vue` (chip + popover), `utils/session-catalog.ts` (`/style` command), `SessionComposer.vue` (render + dispatch), `useProjectLlmDefaults.ts` + `ProjectLlmDefaultsModal.vue` (default per-project). Persist per-session qua `store.updateSettings(sessionId, { responseStyle, responseStyleNoMarkdown })` (không mirror sang session khác).

## Bảo mật

- Directive là **hằng số hardcode** trong sidecar → không có bề mặt prompt-injection từ file/UI (khác Rules đọc file). UI chỉ gửi `responseStyle` (id) + `responseStyleNoMarkdown` (boolean); sidecar tự resolve directive. Đúng invariant "UI không inject prompt thô".
