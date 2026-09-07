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
| 13 style **built-in cố định** (read-only) | ~~User tự tạo/sửa style (CRUD, 2-tier như Rules)~~ → đã làm ở **WP11**, xem [Style do người dùng tự viết](#style-do-người-dùng-tự-viết-wp11) |
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

## Style do người dùng tự viết (WP11)

21 style dựng sẵn là **map hard-code trong sidecar**. Muốn thêm một giọng văn riêng, trước WP11 người dùng phải sửa source rồi build lại app. WP11 mở ra một tầng thứ hai: style viết bằng **file Markdown**, đọc từ đĩa mỗi lượt.

### Bố cục file (2 tier, đúng mô hình Rules)

Style là dữ liệu **AWOG-only** nên nằm dưới `.awog` (ADR 0070 — `.claude` chỉ dành cho skills/agents/commands dùng chung với Claude Code):

```
~/.awog/styles/<id>.md              # global — áp cho mọi project
{project}/.awog/styles/<id>.md      # project — đi theo repo
```

Mỗi file:

```markdown
---
name: Haiku
description: Trả lời bằng haiku ba dòng
---

Answer in haiku. Exactly three lines. Technical accuracy intact; code unchanged.
```

- **`id` = tên file** (không có phần `.md`). Hợp lệ: `^[a-z0-9][a-z0-9._-]{0,63}$`.
- **Body = directive**, chính là đoạn được append vào system prompt. Frontmatter chỉ để hiển thị.
- `source`/`projectId` **suy ra từ vị trí file**, không ghi vào file — style project commit vào repo không được mang id project vốn chỉ đúng trên một máy.
- **Id dành riêng:** `auto` (meta-style), `default`, `normal` (sentinel "không style" của UI). RPC từ chối 3 id này.

### Hợp nhất với style dựng sẵn

Thứ tự ưu tiên khi build prompt (`resolveDirective` trong [styles.ts](../../apps/desktop/sidecar/src/style/styles.ts)):

1. Style **project** cùng id (khi lượt chat biết `projectId`)
2. Style **global** của người dùng
3. Style **dựng sẵn**

Nghĩa là: 21 style dựng sẵn **luôn còn**, style người dùng **bổ sung** vào danh sách; **trùng id thì bản người dùng thắng**. Settings → Phong cách nói rõ điều này bằng nhãn "Đè bản dựng sẵn" / "Đang bị bản của bạn đè" trên đúng hai hàng liên quan. Xoá style của mình ⇒ bản dựng sẵn cùng id tự hiện lại.

`auto` giữ nguyên hành vi cũ: menu Auto vẫn chỉ gồm `AUTO_CANDIDATES` (style dựng sẵn "nghiêm túc"), **không** nạp style người dùng — Auto là lựa chọn tự động cho task thật, không phải nơi thử giọng mới. `responseStyleNoMarkdown` cũng không đổi: vẫn stack lên bất kỳ style nào, kể cả style tự viết.

### Không degrade im lặng

Trước WP11, một `styleId` sidecar không biết bị bỏ qua **không một lời nào** — người dùng thấy chip Style sáng đèn mà giọng văn không đổi, không cách nào phân biệt với "model phớt lờ chỉ dẫn". Nay mỗi lượt không resolve được style sẽ log:

```
{"lvl":"warn","msg":"styles: unresolved style id — this turn runs with NO style directive",
 "styleId":"…","projectId":"…","hint":"expected a built-in id or a style file at ~/.awog/styles/<id>.md …"}
```

Xem log ở **Settings → Workspace → Diagnostics**. Lượt chat **vẫn chạy** (fail-safe giữ nguyên), chỉ là không im lặng nữa. File hỏng (frontmatter sai schema, body rỗng, > 64 KB) cũng log riêng một dòng nêu đường dẫn file rồi bị bỏ qua — không làm sập sidecar, không chặn lượt.

### RPC

| Method | Params | Trả về |
|---|---|---|
| `styles.list` | `{ projectIds?: string[] }` | `{ builtIn: {id, directive}[], autoStyleId, styles: UserStyle[], reports }` |
| `styles.upsert` | `{ style: {id, name, description, body, source?, projectId?}, mode: 'create'\|'update' }` | `{ style }` |
| `styles.delete` | `{ id, source?, projectId? }` | `{ ok: true }` |

Validate zod ở biên, ghi atomic (`.tmp.<pid>` + `rename`) + `chmod 600`, đúng pattern `methods/rules.*.ts`. Cap: file ≤ **64 KB**, directive ≤ **8 000 ký tự** (nó đi kèm *mọi* lượt — mỗi ký tự đều tính tiền token).

### Đọc đĩa mỗi lượt, không cache

`buildStylePrompt` vẫn **đồng bộ** và đọc thẳng file khi id không phải style dựng sẵn (tối đa 2 file nhỏ/lượt, trong khi lượt chat tốn vài giây gọi model). Đổi lại: không cache ⇒ **không cần watcher**, sửa file bằng editor ngoài là lượt kế tiếp thấy ngay. Thư mục `styles` hiện **không** nằm trong danh sách watch của [watcher.ts](../../apps/desktop/sidecar/src/watcher.ts) — chỉ ảnh hưởng việc UI tự refresh khi sửa file ngoài app, không ảnh hưởng prompt.

### Bề mặt tin cậy

Body của style **đi thẳng vào system prompt**. Đây là bề mặt tin cậy **do chính người dùng viết** — cùng hạng với Rules (ADR 0033) và `CLAUDE.md`, không phải nội dung do model hay payload UI cung cấp. Hai hệ quả phải nói rõ:

- **Tier project đến từ repo.** `{project}/.awog/styles/*.md` được commit, nên **người khác trong đội có thể thêm/sửa** file đó và nội dung sẽ chạy trên máy bạn ngay khi bạn chọn style đó. Mở một repo lạ = tin repo đó ở mức tương đương `CLAUDE.md`/`.awog/rules` của nó. Style **chỉ đổi giọng văn**, nhưng nó vẫn là chỉ dẫn cho model — hãy đọc trước khi chọn (Settings → Phong cách xem trước được toàn bộ directive).
- **Style không phải cơ chế quyền.** Guardrail "chỉ đổi tone/format" nằm trong khối `<response-style>` bao quanh, nhưng nó là *prompt*, không phải sandbox: quyền thực thi vẫn do permission engine quyết, không do style.

### Chọn trong picker (WP12)

Style tự viết hiện **ngay trong chip Style / lệnh `/style`**, thành **nhóm riêng "Phong cách của tôi"** đặt ngay dưới nhóm mặc định (Normal/Auto) và **trước** các nhóm dựng sẵn — thứ người dùng tự viết là thứ họ với tay tới trước.

- **Trùng id ⇒ chỉ MỘT hàng.** Hàng dựng sẵn bị ẩn khỏi menu, hàng của người dùng mang nhãn **"Đè bản dựng sẵn"** (dùng lại đúng chuỗi của Settings → Phong cách). Hai hàng nhìn giống hệt nhau mà chỉ một hàng có tác dụng là cái bẫy tệ nhất ở đây.
- **Tier project scope theo ĐÚNG project của phiên.** `stylesForProject(projectId)` chỉ trả tier global + tier của project đang mở; style trong repo của project A không bao giờ hiện khi đang ở project B (chọn cũng vô nghĩa: lượt chat sẽ không resolve được). Trùng id giữa hai tier ⇒ bản project thắng, khớp `resolveDirective`.
- **Danh sách về muộn thì không nhấp nháy, không chặn.** `styles.list` là RPC bất đồng bộ trong khi catalog dựng sẵn là hằng đồng bộ: menu render **ngay** với 21 style dựng sẵn, nhóm của người dùng ghép vào khi danh sách về. `useOutputStyles` giữ state ở module-level + `ensureStylesLoaded(projectIds)` (dedupe theo tập project đã quét, gộp một lần bay) nên chip Style hâm nóng danh sách ngay lúc session lên màn hình — mở popover là đã đủ. Mọi lần nạp thêm đều là **hợp** của các project đã quét: `styles.list` trả về toàn bộ danh sách (không cộng dồn), nạp cho project B mà quên A sẽ xoá style của A khỏi state đang mở ở Settings.
- **Tạo/xoá ở Settings có hiệu lực ngay** trong picker (cùng state module-level, không phải nạp lại). Sửa file bằng editor ngoài thì vẫn phải mở lại Settings → Phong cách để làm tươi (thư mục `styles` không có watcher — xem trên).

**`normalizeStyleSlug` (UI) chấp nhận id của người dùng.** Thứ tự: sentinel `Default/Normal` → **id style người dùng (kiểm tra TRƯỚC)** → slug đã gỡ khỏi catalog (`git-log`) về `Default` → slug dựng sẵn → nhãn hiển thị cũ → passthrough. Đặt bước "style người dùng" lên đầu là điều kiện đủ để một file tên `git-log.md` không bị quy về `Default` sau lưng người dùng; ngược lại id đã xoá vẫn degrade sạch như cũ. Chip hiển thị **tên trong frontmatter**, và khi đã quét đúng project mà vẫn không thấy id thì nói thẳng *"`<id>` — không còn trên đĩa"* thay vì hiện id trần trông như một lựa chọn đang chạy.

**Chưa làm (follow-up):**

- Picker style trong **Session defaults per-project** (`ProjectLlmDefaultsModal` / `useProjectLlmDefaults`) vẫn liệt kê catalog dựng sẵn — chưa nạp style tự viết.
- Không tự làm tươi khi file bị sửa **ngoài app** (không watcher; Settings → Phong cách là chỗ làm tươi).

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
- **AC10 — Style tự viết chọn được (WP12):** Given có `~/.awog/styles/haiku.md`, When mở chip Style, Then hàng "Haiku" nằm trong nhóm **"Phong cách của tôi"** (tách khỏi nhóm dựng sẵn); When chọn, Then `session.settings.responseStyle === 'haiku'` và chip hiện **tên trong frontmatter**, lượt sau trả lời theo directive trong file.
- **AC11 — Đè bản dựng sẵn:** Given có style của người dùng id `pirate`, When mở picker, Then chỉ **một** hàng `pirate` (bản của người dùng, có nhãn "Đè bản dựng sẵn"), hàng dựng sẵn không hiện.
- **AC12 — Scope tier project:** Given style `x` chỉ nằm ở `{projectA}/.awog/styles`, When mở session thuộc project B, Then hàng `x` KHÔNG hiện trong picker của B; mở session thuộc A thì có.
- **AC13 — Danh sách về muộn:** Given `styles.list` chưa trả về, When mở chip Style, Then 21 style dựng sẵn chọn được ngay (không spinner, không disable), và nhóm của người dùng ghép vào khi danh sách về — không đổi thứ tự các nhóm dựng sẵn.
- **AC14 — Id đã xoá:** Given session lưu `responseStyle` của một style đã bị xoá khỏi đĩa, When quét xong đúng project đó, Then chip hiện "`<id>` — không còn trên đĩa" (không im lặng đổi sang Normal, cũng không hiện id trần như một lựa chọn đang chạy).

## Edge case

- Style id lạ (UI mới hơn sidecar, hoặc JSONL hỏng) → `buildStylePrompt` trả `undefined` (no style), không chặn lượt. **Fail-safe** — nhưng từ WP11 có **log `warn` mỗi lượt** nêu id + gợi ý đường dẫn file, không im lặng nữa.
- File style của người dùng hỏng (frontmatter sai, body rỗng, quá 64 KB) → bỏ qua file đó + log; nếu id đó trùng một style dựng sẵn thì bản dựng sẵn được dùng.
- Không chọn style nhưng bật `no markdown` → vẫn inject directive plain-text độc lập.
- Style directive **luôn là augment** (append sau prompt agent + rules), không thay thế identity của agent (ADR 0015) hay rules (ADR 0033).
- Thứ tự inject: `systemPromptAppend(MCP) → rules → response-style → VERIFY → …` (response-style sau rules, trước VERIFY).

## Default (session + project)

- **App-level:** `DEFAULT_SETTINGS` (stores/sessions.ts) khai báo tường minh `responseStyleNoMarkdown: false`; không set `responseStyle` ⇒ session mới mặc định **Normal**.
- **Per-project:** `ProjectLlmDefaults` (UI + sidecar) thêm `responseStyle` + `responseStyleNoMarkdown` — mỗi project chọn style mặc định riêng qua modal **"Session defaults"** (ProjectLlmDefaultsModal). `settingsForProject()` merge style của project vào session mới (omit = Normal). Persist qua `projects.upsert` (LlmDefaultsSchema). Session vẫn override được bằng chip/`/style` sau khi tạo.

## Tích hợp

- **Sidecar:** `src/style/styles.ts` (directive map + `AUTO_CANDIDATES` + `buildStylePrompt` — nhánh `auto` build menu từ chính directive map), `src/style/store.ts` (CRUD 2 tier cho style người dùng) + `src/style/resolve.ts` (tra cứu đồng bộ trên đường nóng) + `methods/styles.{list,upsert,delete}.ts`, inject ở `runtime/run-stream.ts`. `SessionSettings` + `ProjectLlmDefaults` (shared.ts) + schema/`toSessionSettings` ở `sessions.send-message.ts`, `sessions.upsert.ts`, `projects.upsert.ts`.
- **UI:** `composables/useOutputStyles.ts` (3 RPC + hợp nhất hiển thị + `stylesForProject`/`ensureStylesLoaded`/`isUserStyleId` cho picker) + `components/settings/SettingsStyles.vue` (Settings → Phong cách: liệt kê, tạo/sửa/xoá, xem trước directive), `composables/useSessionModelConfig.ts` (catalog dựng sẵn + `styleGroups` ghép nhóm của người dùng + `normalizeStyleSlug`), `components/shell/StatusConfig.vue` (chip Style + popover), `utils/session-catalog.ts` (`/style` command), `SessionComposer.vue` (render + dispatch), `useProjectLlmDefaults.ts` + `ProjectLlmDefaultsModal.vue` (default per-project). Persist per-session qua `store.updateSettings(sessionId, { responseStyle, responseStyleNoMarkdown })` (không mirror sang session khác).

## Bảo mật

- Directive là **hằng số hardcode** trong sidecar → không có bề mặt prompt-injection từ file/UI (khác Rules đọc file). UI chỉ gửi `responseStyle` (id) + `responseStyleNoMarkdown` (boolean); sidecar tự resolve directive. Đúng invariant "UI không inject prompt thô".
