# Slack threads — theo dõi, đọc, trả lời thread Slack ngay trong AWOG

> Trạng thái: **in progress** (2026-10-16). Quyết định kiến trúc: [ADR 0107](../decisions/0107-slack-threads-via-web-api.md).
> Liên quan: [connections-sources-model](connections-sources-model.md) (nguồn Slack + OAuth), [github-notifications](github-notifications.md) (mẫu poll + bookkeeping đã đọc), [logtime](logtime.md) (mẫu "agent soạn, người đẩy").

## Vấn đề

Trao đổi với khách (Malme) nằm trong vài chục thread Slack rải trên nhiều kênh. Theo dõi thread nào có reply mới, đọc bản dịch, rồi chuyển ngữ cảnh sang phiên AI để xử lý đang phải nhảy qua lại giữa Slack, trình dịch và AWOG.

## Phạm vi

- **Đọc:** thêm thread bằng permalink; cây Workspace → kênh → thread; tìm; lọc project; chấm chưa đọc; thời gian tương đối; render mrkdwn, mention chip, emoji (chuẩn + tuỳ chỉnh), reaction; gộp tin liên tiếp cùng người; mở thread chỉ tải tin gốc + 5 reply mới nhất, nút "Tải reply cũ hơn" thêm 10 tin mỗi lần. Ô chọn project + menu "…" nằm trên header thread (không có thanh dưới).
- **Dịch theo yêu cầu, không tự dịch:** vào thread luôn hiện **bản gốc**; "Dịch toàn bộ" ở header dịch thread đang xem (không nhớ sang thread khác / lần mở sau), nút 🌐 trên từng tin dịch riêng tin đó. Prompt riêng cho trao đổi với khách Nhật (`sidecar/src/slack/translate-prompt.ts`): giữ tên riêng + hậu tố gốc (矢作様, 藤根さん), thuật ngữ nghiệp vụ dịch nghĩa kèm chữ Nhật trong ngoặc, câu xã giao dịch theo chức năng (お疲れ様です ≠ "mệt"), 弊社/御社 đúng phía; chiều gửi sang tiếng Nhật viết kính ngữ thương mại. Bảng thuật ngữ bắt buộc ở `~/.awog/slack/glossary.md` (mỗi dòng `日本語 = bản dịch`). Dịch theo dòng (mảng JSON) để mention/link đứng đúng chỗ như bản gốc.
- **Cài đặt dịch** (nút bánh răng ở đầu workspace ⇒ `SlackSettingsDialog`, lưu ở sidecar nên modal và cửa sổ riêng dùng chung): **model dịch** — "Dùng model dịch chung của app" (chuỗi cũ: model dịch chung đã ghim → `llmDefaults` của project → mặc định app; hiện dòng phụ model thực tế đang resolve) hoặc "Chọn riêng cho Slack" (provider · tài khoản · model); **phong cách** Chính xác (mặc định, bám câu gốc) / Cân bằng / Tự nhiên — cả ba không thêm/bớt ý, áp cho cả chiều đọc lẫn chiều gửi (chiều gửi sang tiếng Nhật luôn giữ kính ngữ thương mại); **ngôn ngữ** đọc (mặc định theo giao diện) và gửi (mặc định tiếng Nhật — nút composer thành "Dịch sang JA/VI/EN"); **thuật ngữ** — công tắc "Giữ thuật ngữ tiếng Nhật trong ngoặc" (tắt ⇒ chỉ dịch nghĩa, tên riêng vẫn giữ chữ gốc) + ô sửa `glossary.md` có nút Lưu. Đổi lựa chọn là lưu ngay; đổi model/phong cách/thuật ngữ thì bản dịch đang hiện (cả "Dịch toàn bộ" lẫn tin lật riêng) bị bỏ và dịch lại.
- **Viết (người bấm):** ô trả lời (Enter gửi, Shift+Enter xuống dòng, "Also send to #channel"), gợi ý `@user` + `:emoji:`, nút "Dịch sang JA" có xem trước, sửa/xoá tin của mình, thêm/bỏ reaction (picker: Gần đây · Chuẩn · Tuỳ chỉnh), click chip để react theo, hover chip thấy người react.
- **Attachment:** thumbnail ảnh/video, thẻ file, snippet, unfurl; xem trước qua `usePreview()` + PreviewModal; tải về (Save as… / Lưu vào project / Mở bằng app mặc định). Trần **200 MB/file**, cache giữ **30 ngày** không mở.
- **Session theo thread:** "Mở session" tạo phiên gắn thread (cwd theo project); "Đưa vào session" gửi phần reply mới — **thủ công, không tự wake**. Agent có tool `slack_draft_reply` chỉ đổ nháp vào composer, **không có tool gửi**. Phiên đã nhận nội dung Slack **không bao giờ có nguồn MCP Slack**, và ở **mọi lượt** không có `autoApprove`, mode `execute`/`accept-edits` bị kẹp về `ask` (xem mục Bảo mật).
- **Hai bề mặt, cùng nội dung (`components/slack/SlackWorkspace.vue`):**
  - **Modal trong cửa sổ chính** (~90vw × 88vh) — mở từ NavRail, route `/slack` (mở modal và ở lại trang đang đứng; lần nạp đầu thì về `/`) hoặc `useSlackModal().open(threadId?)`. Đầu modal: Làm mới · **Mở cửa sổ riêng** (mở cửa sổ ở thread đang xem rồi đóng modal) · Đóng. Esc / bấm nền thì đóng (Esc nhường cho popover, menu, hộp xác nhận đang mở). Modal nhớ thread đang chọn cho lần mở sau. "Mở session" từ modal đóng modal **trước** rồi mới điều hướng tới phiên.
  - **Cửa sổ riêng** (`/slack?window=1`) có ghim luôn-nằm-trên.
  - Cột danh sách thread đổi được bề rộng bằng tay kéo (min 240px, max 60% workspace, bấm đúp về 380px, ←/→ ±16px khi focus), nhớ ở localStorage `awog.slack.listWidth` — chung cho hai bề mặt.
  - Poll chỉ chạy khi bề mặt đang hiện (modal mở / cửa sổ riêng đang activate) và cửa sổ không ẩn: thread đang mở **nạp lại** mỗi 20s (thấy cả sửa/xoá/reaction của người khác), các thread khác `slack.poll` mỗi 60s; "Làm mới" ép poll mọi thread (`force: true`).
- **Nháp agent không đè chữ đang gõ:** ô trống thì đổ thẳng vào; ô đang có chữ thì nháp nằm chờ (giữ trong store, kể cả khi chưa mở thread đó) và composer hiện băng "Agent đã soạn nháp — Thay bằng nháp / Bỏ qua".
- **Sửa tin giữ nguyên token:** mention user thành `@Tên` (trùng tên hiển thị ⇒ `@Tên (tên thật)`); kênh, link, `@here`, ngày giữ nguyên dạng `<…>` trong ô sửa và đi lại y nguyên khi lưu. Chỉ đường sửa tin của chính mình được giữ mọi token: **nháp agent** chỉ giữ `<@U…>` (`<!channel>` thành chữ `@channel`, `<url|nhãn>` thành `nhãn (url)`); **bản dịch** chỉ giữ token đã có trong bản nháp trước khi dịch.
- **File:** HTML/Markdown từ Slack xem ở dạng mã nguồn (không render). File bên ngoài (`unavailable: 'external'`) hiện thẻ "File bên ngoài" + nút mở link sau khi xác nhận (qua bộ chọn mở link chung). "Mở bằng app mặc định" chỉ cho loại chỉ-xem; bị từ chối ⇒ toast gợi ý "Lưu thành…".
- **Ngoài phạm vi:** upload file, DM/kênh ngoài thread, realtime Socket Mode, tự dò thread có mention (P4).

## Scope Slack cần

Đã có trên token hiện tại (đo 2026-10-16): `channels:history groups:history im:history mpim:history channels:read groups:read users:read chat:write reactions:write`.
Phải bật thêm trong Slack app + kết nối lại nguồn: **`files:read`** (attachment). `emoji:read` (emoji tuỳ chỉnh) **không chọn được** ở User Token Scopes của Slack app (đo 2026-10-16) ⇒ tuỳ chọn: thiếu thì emoji tuỳ chỉnh hiện `:tên:` và picker không có tab Tuỳ chỉnh, không hiện banner. `reactions` đã có trong payload `conversations.replies` nên không cần `reactions:read`.
Token không có refresh token → hết hạn là `needs_auth`; UI hiện banner "Kết nối lại nguồn Slack". Scope thiếu đọc từ header `x-oauth-scopes` và trả về trong `SlackStatus.missingScopes`.

## Lưu trữ

Global (thread thuộc về người, không thuộc project — cùng lý do logtime D-4), dưới `~/.awog/slack/`:

| Đường dẫn | Nội dung |
|---|---|
| `threads.json` | `{ version: 1, threads: SlackThread[] }` |
| `settings.json` | `{ version: 1, translate: { llm, style, readLang, sendLangs, keepJapaneseTerms } }` (`sendLangs` 1–3 ngôn ngữ theo thứ tự, vd `["Japanese","English"]` = gửi song ngữ; file cũ có `sendLang` chuỗi tự chuyển thành danh sách) — field sai rơi về mặc định riêng field đó; JSON hỏng ⇒ cách ly + mặc định |
| `glossary.md` | bảng thuật ngữ (sửa trong bảng Cài đặt hoặc tay), ≤ 20 000 ký tự |
| `tainted-sessions.json` | `{ version: 1, sessionIds: string[] }` — phiên đã nhận nội dung Slack; chỉ thêm, không gỡ (mục Bảo mật) |
| `cache/<teamId>/directory.json` | user + emoji tuỳ chỉnh, TTL 6h |
| `cache/<teamId>/translations.json` | `{ [v3:ts:editedTs:lang:style:j\|t:sha1(glossary)[0..8]:sha1(text)[0..12]]: text }` — hash nội dung để renderer không ghi đè được bản dịch của tin thật bằng chữ bịa; phong cách + cờ giữ chữ Nhật + hash thuật ngữ để đổi cài đặt là dịch lại, không trả bản cũ |
| `cache/<teamId>/avatars/<userId>.<ext>` | avatar (URL avatar đổi ⇒ file cũ bị xoá ở lần làm mới danh bạ) |
| `cache/<teamId>/emoji/<sha256(url) 24 ký tự>.<ext>` | ảnh emoji tuỳ chỉnh (đặt tên theo URL: up lại cùng tên ⇒ file mới) |
| `files/<teamId>/<fileId>/<tên đã làm sạch>` | file gốc đã tải (trần 200 MB, dọn sau 30 ngày không mở) |
| `files/<teamId>/thumbs/<fileId>-<size>.<ext>` | thumbnail |

## Hợp đồng dữ liệu

Nguồn sự thật type: `apps/desktop/sidecar/src/slack/types.ts`; UI mirror trong `apps/desktop/ui-next/stores/slack.ts`. **Giữ hai bên trùng khớp.**

```ts
type SlackThread = {
  id: string              // `${teamId}:${channelId}:${threadTs}`
  sourceId: string        // id nguồn Slack trong Sources
  teamId: string
  teamName: string
  teamUrl: string         // https://malme.slack.com/
  channelId: string
  channelName: string     // không có '#'
  threadTs: string        // ts tin gốc
  title: string | null    // tiêu đề người dùng đặt; null ⇒ UI lấy dòng đầu tin gốc
  firstLine: string       // dòng đầu tin gốc (đã bỏ mrkdwn), ≤120 ký tự
  projectId: string | null
  sessionId: string | null      // engineId phiên gắn thread
  sessionSyncedTs: string | null // reply mới nhất đã đưa vào phiên
  lastReplyTs: string     // ts tin mới nhất trong thread
  lastSeenTs: string      // ts tin mới nhất người dùng đã xem
  replyCount: number
  addedAt: number
  error: 'not_found' | 'no_access' | null  // thread xoá / mất quyền kênh
}

type SlackFile = {
  id: string; name: string; title: string; mimetype: string; filetype: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'text' | 'snippet' | 'other'
  thumb: { size: 360 | 720; width: number; height: number } | null  // thumbnail sẵn có
  hasVideoPoster: boolean
  preview: string | null  // snippet/post: nội dung text (≤20k ký tự)
  permalink: string
  // 'external' = file liên kết dịch vụ ngoài (is_external / mode 'external' / filetype 'remote'):
  // không tải, không thumbnail
  unavailable: 'deleted' | 'no_access' | 'too_large' | 'external' | null
  externalUrl: string | null  // chỉ khác null khi unavailable === 'external' VÀ URL là https:
}

type SlackReaction = { name: string; count: number; users: string[]; mine: boolean }

type SlackUnfurl = { title: string | null; text: string | null; url: string | null; serviceName: string | null; imageUrl: string | null }

type SlackMessage = {
  ts: string
  userId: string | null    // null cho bot
  botName: string | null
  text: string             // mrkdwn thô của Slack
  editedTs: string | null
  reactions: SlackReaction[]
  files: SlackFile[]
  unfurls: SlackUnfurl[]
  isParent: boolean
  subtype: string | null
}

type SlackUser = { id: string; name: string; displayName: string; realName: string; avatar: string | null /* data URI */; isBot: boolean; deleted: boolean }

type SlackEmoji = { name: string; url: string | null /* data URI ảnh tuỳ chỉnh; luôn null ở slack.directory.emoji */; alias: string | null }

type SlackThreadDetail = {
  thread: SlackThread
  messages: SlackMessage[]  // tin gốc trước, rồi reply theo thời gian
  users: Record<string, SlackUser>  // mọi user xuất hiện (tác giả, mention, reaction)
  selfUserId: string
  channels: Record<string, string>  // id → name cho <#C…>
  customEmoji: Record<string, SlackEmoji>  // chỉ những emoji xuất hiện trong thread
}

type SlackStatus = {
  sources: Array<{ sourceId: string; teamId: string | null; teamName: string | null; connected: boolean; missingScopes: string[] }>
}
```

## RPC

Mọi method ở `apps/desktop/sidecar/src/methods/slack.*.ts`, register qua `register()`, import trong `src/index.ts`. Mọi tham số do renderer cấp được validate bằng zod + regex: `ts` `^\d{10}\.\d{6}$`, channel `^[CGD][A-Z0-9]{6,}$`, team `^T[A-Z0-9]{6,}$`, user `^[UW][A-Z0-9]{6,}$`, file `^F[A-Z0-9]{6,}$`, emoji `^[\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{1,100}(::skin-tone-[2-6])?$` (cờ `u` — tên emoji tuỳ chỉnh có thể là chữ Nhật như `:了解:`, reaction có tông da mang hậu tố `::skin-tone-N`), threadId = ghép 3 phần trên. **Không nhận URL từ renderer** (ngoại trừ permalink để parse ở `slack.threads.add`).

**Lỗi:** method core đi qua `registerSlack` (`src/slack/rpc.ts`): lỗi Slack ra renderer thành `RpcError` mã `-32040`, `data.slackCode` = mã Slack nguyên gốc (`missing_scope`, `not_in_channel`, `channel_not_found`, `ratelimited`, `invalid_auth`…) hoặc mã tự đặt: `not_connected` (nguồn hết hạn / chưa kết nối), `workspace_not_connected`, `source_not_found`, `invalid_link`, `thread_not_tracked`, `not_own_message`, `no_access` / `deleted` / `too_large` / `external` / `no_thumbnail` (file), `session_missing` / `thread_unavailable` (nối phiên), `blocked_host`, `network`. Khi thiếu scope có thêm `data.needed`. Tham số sai vẫn là `-32602` như mọi RPC.

| Method | Params | Trả về |
|---|---|---|
| `slack.status` | `{}` | `SlackStatus` |
| `slack.threads.list` | `{}` | `{ threads: SlackThread[] }` (đọc đĩa, không gọi Slack) |
| `slack.threads.add` | `{ url: string, projectId?: string }` | `{ thread: SlackThread }` — parse permalink (`/archives/<C>/p<16 số>` + `?thread_ts=`), gọi Slack lấy tin gốc; link vào reply ⇒ thread của reply đó; trùng ⇒ trả thread cũ |
| `slack.threads.remove` | `{ threadId }` | `{ ok: true }` |
| `slack.threads.update` | `{ threadId, title?: string\|null, projectId?: string\|null }` | `{ thread }` — pick đúng hai field này. `sessionId`/`sessionSyncedTs` chỉ `slack.session.open/push` ghi |
| `slack.thread.get` | `{ threadId, cursor?: string }` | `SlackThreadDetail & { nextCursor: string\|null }` — trang đầu là **reply mới nhất** (tối đa 200), `nextCursor` tải reply **cũ hơn** (đo 2026-10-16: Slack phân trang lùi, tin gốc có ở mọi trang). Thread bị xoá/mất quyền ⇒ trả `thread.error` + `messages: []`, không ném lỗi |
| `slack.thread.markSeen` | `{ threadId, ts }` | `{ thread }` |
| `slack.poll` | `{ threadIds?: string[], force?: boolean }` | `{ changed: string[] }` — `conversations.replies` với `oldest=lastReplyTs` (limit nhỏ), cập nhật `lastReplyTs/replyCount`; phát `slack.changed` nếu có đổi. Thread đã poll < 15s bị bỏ qua (hai cửa sổ cùng poll), trừ khi `force: true` (người bấm làm mới). `ts`/`latest_reply` lệch `^\d{10}\.\d{6}$` thì giữ giá trị cũ |
| `slack.reply` | `{ threadId, text, broadcast?: boolean }` | `{ ts }` — `text` đã ở dạng mrkdwn (UI đổi chip mention thành `<@U…>`); **không retry** (không idempotent). Sau khi `chat.postMessage` thành công luôn trả `{ ts }` — lỗi ghi sổ chỉ log |
| `slack.message.update` | `{ threadId, ts, text }` | `{ ok: true }` — chỉ tin của self |
| `slack.message.delete` | `{ threadId, ts }` | `{ ok: true }` — chỉ tin của self |
| `slack.reaction.add` / `slack.reaction.remove` | `{ threadId, ts, name }` | `{ ok: true }` |
| `slack.directory.users` | `{ teamId, query?: string, channelId?: string }` | `{ users: SlackUser[] }` (≤20, thành viên kênh xếp trước) |
| `slack.directory.emoji` | `{ teamId }` | `{ emoji: SlackEmoji[] }` — tuỳ chỉnh, **chỉ `name` + `alias`, `url` luôn `null`** (thiếu `emoji:read` ⇒ `[]`) |
| `slack.directory.emojiImages` | `{ teamId, names: string[] }` (≤64, mỗi tên qua regex emoji) | `{ images: Record<name, dataUri> }` — ảnh cho phần picker đang hiện; tên không có / alias tới emoji chuẩn / tải hỏng thì vắng. Dùng chung cache đĩa `cache/<teamId>/emoji/` |
| `slack.translate` | `{ threadId, items: Array<{ ts, editedTs: string\|null, text }>, targetLang: string, provider, modelId, accountId? }` | `{ texts: Record<ts, string> }` — cache theo `ts:editedTs:lang:<phong cách + thuật ngữ>:sha1(text)`; phong cách / giữ chữ Nhật / bảng thuật ngữ sidecar tự đọc từ cài đặt (renderer không gửi); `targetLang` qua `^[\p{L}\p{M} ()-]{2,40}$` (cờ `u`, vd `Japanese`); gọi `translateText(…, { preferCheap: true })` tối đa 3 song song; giữ nguyên `<@U…>`, `<#C…>`, `<url\|…>`, `:emoji:` |
| `slack.translateOutgoing` | `{ text, targetLang, provider, modelId, accountId? }` | `{ text }` — không cache; `targetLang` cùng regex với `slack.translate`; cùng phong cách/thuật ngữ như chiều đọc |
| `slack.settings.get` | `{}` | `SlackSettings` (`{ translate: { llm: { mode: 'inherit' } \| { mode: 'pinned', provider, modelId, accountId? }, style: 'precise'\|'balanced'\|'natural', readLang: string\|null, sendLangs: string[], keepJapaneseTerms: boolean } }`) |
| `slack.settings.set` | `{ translate: Partial<…> }` | `SlackSettings` — pick đúng 5 field, validate (lang qua regex `targetLang`, provider enum); có đổi ⇒ phát `slack.settings-changed` |
| `slack.glossary.get` | `{}` | `{ text, path }` — nguyên văn `glossary.md` (thiếu ⇒ `''`) |
| `slack.glossary.set` | `{ text ≤ 20000 }` | `{ ok: true }` — ghi atomic, đường dẫn cố định; có đổi ⇒ phát `slack.settings-changed` |
| `slack.file.thumb` | `{ teamId, fileId, size: 360\|720 }` | `{ dataUrl }` |
| `slack.file.fetch` | `{ teamId, fileId }` | `{ path: string, name: string, mimetype: string }` — path tuyệt đối trong `~/.awog/slack/files/` |
| `slack.file.saveToProject` | `{ teamId, fileId, projectId }` | `{ path }` — lưu vào **gốc** project (không nhận thư mục con từ renderer), qua `assertInsideWorkspace`, trùng tên thì đánh số. Tên trùng file chỉ dẫn agent (`CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.clinerules`, `copilot-instructions.md`, không phân biệt hoa thường) hoặc bắt đầu bằng `.` ⇒ thêm tiền tố `slack-` |
| `slack.session.open` | `{ threadId, settings: { provider, modelId, level?, mode?, accountId? } }` | `{ sessionId, created, thread }` — phiên gắn còn sống ⇒ trả lại nó; không ⇒ sidecar tạo phiên (projectId của thread, tiêu đề `Slack: <title\|firstLine>`, `mcpServerIds` = mặc định project trừ mọi nguồn Slack, mode `execute`/`accept-edits`/vắng ⇒ `ask`), phát `session.created`, gắn `sessionId` (mốc = null), đánh dấu phiên nhiễm, giao khối cả thread qua `session.inbox-message` (origin `external`), **rồi mới** ghi `sessionSyncedTs`. Làm ở sidecar vì cửa sổ Slack riêng không nhận `session.*`; UI phải bảo đảm cửa sổ chính sẵn sàng trước khi gọi (sidecar không biết cửa sổ nào nhận event) |
| `slack.session.push` | `{ threadId }` | `{ pushed, thread }` — đánh dấu phiên nhiễm, giao phần reply sau `sessionSyncedTs` vào phiên đã gắn (inbox, origin `external`) rồi mới dời mốc; không có gì mới ⇒ `pushed: false`. Phiên đã xoá/lưu trữ ⇒ lỗi `slackCode: 'session_missing'`; thread xoá/mất quyền ⇒ `thread_unavailable`. `open`/`push` cùng một thread chạy tuần tự (khoá theo thread), đọc lại thread bên trong khoá |

Event (sidecar → renderer):

| Event | Payload |
|---|---|
| `slack.changed` | `{ threadIds: string[] }` — phát sau poll có đổi, và sau MỌI thao tác sửa store (add/remove/update/markSeen/reply/sửa-xoá tin/reaction, `thread.get` đồng bộ ngược số reply) để cửa sổ chính và cửa sổ Slack riêng không lệch nhau |
| `slack.draft` | `{ threadId, text }` — do tool `slack_draft_reply` phát |
| `slack.settings-changed` | `{ settings: SlackSettings, reason: 'settings' \| 'glossary' }` — mọi bề mặt nạp bản mới, bỏ bản dịch đang hiện rồi dịch lại |

## Bảo mật

- Host gọi ra: `slack.com` **chỉ** cho Web API, URL dựng nội bộ trong `callSlackApi` (tên method qua regex). URL lấy từ payload Slack (`url_private*`, `thumb_*`, avatar `image_*`, URL emoji) là L1 và đi qua một luật riêng: `files.slack.com` + path khớp `^/files-(pri|tmb)/T…-F…(-<hash>)?/` và không chứa `%2f`/`%5c`/`%2e` ⇒ gắn Bearer; `files.slack.com` path khác và `*.slack-edge.com` ⇒ gọi không token; mọi host khác — **kể cả `slack.com`** — ⇒ chặn (`blocked_host`). Lý do: người ngoài có thể đặt `url_private = https://slack.com/api/conversations.invite?...`, tải nó kèm token là gọi Web API thay người dùng. **`redirect: 'manual'`**; mỗi bước redirect áp lại đúng luật trên.
- File liên kết ngoài (`is_external` / `mode: 'external'` / `filetype: 'remote'`) ⇒ `unavailable: 'external'`, không tải, không thumbnail; `externalUrl` chỉ trả khi là `https:`.
- File tải về (cache, bản chép vào project và bản "Lưu thành…" — `copyFile` làm rơi cờ nên gắn lại ở main, `electron/src/slack-files.ts`) được gắn cờ "tải từ Internet": macOS `com.apple.quarantine` (`xattr`, mảng tham số), Windows ADS `Zone.Identifier` (`ZoneId=3`); Linux bỏ qua. Lỗi gắn cờ chỉ log.
- Id user lấy từ payload qua `^[UW][A-Z0-9]{6,}$` trước khi thành tên file avatar hoặc vào `users.info`; id lệch bị bỏ.
- Token chỉ ở sidecar (`getFreshToken`), không vào RPC/log/event.
- Tên file làm sạch (bỏ `/`, `\`, `..`, ký tự điều khiển, cắt 120 ký tự); ghi `*.part` rồi rename.
- `media://` thêm một root cố định `~/.awog/slack/files` (khai ở main process, không đọc từ URL).
- Nội dung Slack vào session là L1: bọc `<slack-thread nonce="…">` với nonce 48 bit sinh lúc dựng khối (mẫu `github/pr-watch-block.ts`), `redactString`, trần 6000 ký tự. Tin của chính người dùng có tiền tố `[self] ` ở cột 0 — chỗ duy nhất thân tin không chạm tới được (dòng tiếp theo của tin bị thụt, đuôi bị cắt mở đầu bằng `…`); chuỗi `[self]` / `(the user)` trong tên hiển thị bị lọc.
- Ngắt dòng `\r`/CRLF/U+2028/U+2029/NEL/VT/FF trong thân tin đổi thành `\n` rồi thụt như mọi dòng tiếp theo; nhãn một dòng bỏ cả U+2028/U+2029. Id trong `<@…>`/`<#…>` và tên emoji chỉ tra khoá riêng (`Object.hasOwn`): `:constructor:`, `<#__proto__>` không làm hỏng khối/danh bạ.
- Không có tool agent nào gửi/react/sửa/xoá trên Slack. `slack_draft_reply` đổi `<!…>` và `<url|nhãn>` thành chữ trước khi phát `slack.draft`.
- **Phiên nhiễm Slack** (ADR 0107 D-4): `slack.session.open/push` ghi id phiên vào `tainted-sessions.json` TRƯỚC khi giao khối (ghi hỏng ⇒ không giao); cờ không bao giờ gỡ, fork thừa kế; phiên đang gắn thread cũng tính. `sessions.sendMessage` cho phiên nhiễm, MỌI lượt: loại mọi nguồn Slack (`provider === 'slack'`, host `*.slack.com`, server stdio có chữ `slack` trong command/args/tên env), bỏ `autoApprove`, kẹp `execute`/`accept-edits` về `ask` và SSH `auto` về `prompt`. Đọc cờ lỗi/file hỏng ⇒ coi như nhiễm.

## Phân file

| Lớp | File |
|---|---|
| Sidecar core | `src/slack/{types,client,permalink,store,directory,avatar,files,mrkdwn,translate,translate-prompt,settings,poll}.ts` + phụ trợ `src/slack/{session,params,payload,json-file,concurrency,rpc,threads,thread}.ts` (`thread.ts` giữ bản DUY NHẤT `loadFullThreadDetail` + `ThreadUnavailableError` cho lớp session), `src/methods/slack.*.ts`, test ở `src/slack/__tests__/`. Dọn cache file 30 ngày: `sweepSlackFileCache` chạy lúc engine khởi động + mỗi 24h (`src/index.ts`) |
| Sidecar session | `src/slack/thread-block.ts`, `src/slack/session-link.ts`, `src/slack/taint.ts`, `src/methods/slack.session.{open,push}.ts`, `src/runtime/tools/slack-tools.ts`, `src/runtime/claude-sdk/slack-sdk-server.ts` + wire 2 runtime |
| Electron | `electron/src/slack-window.ts`, IPC `slack:openWindow` / `slack:setAlwaysOnTop` / `slack:saveFileAs` / `slack:openPath`, preload, `media.ts` root |
| UI | `stores/slack.ts` (dữ liệu + RPC + nháp theo thread + ảnh emoji nạp lười), `composables/useSlackManager.ts` (controller, 2 chế độ `modal` / `window`) + `useSlackTree.ts` (cây, lọc) + `useSlackPolling.ts` (nhịp 20s/60s) + `useSlackModal.ts` (singleton modal) + `useSlackComposer.ts` + `useSlackMessageActions.ts` + `useSlackFiles.ts` + `useSlackTranslation.ts` + `useSlackSettingsPanel.ts` (bảng Cài đặt dịch) + `useSlackListResize.ts` (tay kéo cột danh sách) + `useSlackEmojiRecent.ts`, `useLlmPicker.ts` (chọn provider/tài khoản/model — chung với `useTranslateSettings`), `utils/slack-langs.ts`, `components/slack/SlackWorkspace.vue` (nội dung chung) + `SlackSettingsDialog.vue` + `SlackChoiceCard.vue` + `SlackModal.vue` (mount ở `AppGlobalHosts.vue`) + các component con, `pages/slack.vue` (chỉ còn cửa sổ riêng), `utils/slack-mrkdwn.ts`, `utils/slack-errors.ts`, `utils/slack-emoji.ts` (+ `assets/slack-emoji.json`), `i18n/locales/{en,vi}/slack.json`, NavRail (mở modal), `OVERLAYS` (modal dùng `.ovl.on` sẵn có) |
