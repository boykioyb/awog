# 0023 — SDK session resume + `/compact`

- **Trạng thái:** Proposed
- **Ngày:** 2026-06-03
- **Người quyết định:** Tech Lead (AWOG)

## Bối cảnh

Runner sidecar hiện **dựng lại toàn bộ transcript mỗi lượt** rồi gửi như một prompt đơn:

```ts
// apps/desktop/sidecar/src/sessions/runner.ts
const prompt = renderTranscript(args.history, args.pendingText) // "User: …\n\nAssistant: …\n\nUser: <pending>"
const q = query({ prompt, options })
```

Tức là AWOG **không dùng session continuity** của Claude Agent SDK. Hệ quả:

1. **Lãng phí token** — mỗi lượt gửi lại nguyên lịch sử thay vì chỉ message mới.
2. **Không có auto-compaction của SDK** — context cứ phình tới khi vỡ giới hạn model.
3. **`/compact` không thể hoạt động.** SDK chỉ xử lý `/compact` như lệnh nội bộ khi nó là **prompt đứng một mình**; ở AWOG nó bị chôn thành `User: /compact` giữa transcript nên model chỉ đọc như chữ thường.

Tham chiếu: [craft-agents-oss](https://github.com/craft-ai-agents/craft-agents-oss) (cùng dùng `@anthropic-ai/claude-agent-sdk`) xử lý đúng cách trong `packages/shared/src/agent/claude-agent.ts`:

```ts
const SDK_SLASH_COMMANDS = ['compact'] as const
// nếu message là slash command đã whitelist → gửi thẳng, không bọc context:
this.currentQuery = query({ prompt: '/compact', options }) // SDK tự compaction
// turn thường: dựa vào resume/continue của session SDK để có lịch sử + auto compaction
```

API SDK sẵn có (`@anthropic-ai/claude-agent-sdk@0.3.152`, đã cài):

| Option | Ý nghĩa |
|---|---|
| `resume?: string` | Session ID để resume — SDK nạp lại lịch sử hội thoại của session đó |
| `continue?: boolean` | Tiếp session gần nhất trong cwd (loại trừ lẫn nhau với `resume`) |
| `forkSession?: boolean` | Khi resume, fork sang session ID mới thay vì tiếp session cũ |
| `sessionId?: string` | Chỉ định UUID cụ thể (không dùng chung với continue/resume trừ khi forkSession) |

Mọi `SDKMessage` đều có trường `session_id: string` → đọc được id để persist.

Ràng buộc AWOG: local-first, 8 invariant bảo mật, **AWOG JSONL vẫn là source of truth** của lịch sử (file `sessions/<id>.jsonl`).

## Quyết định

### 0. Bật `persistSession` + cô lập `CLAUDE_CONFIG_DIR` (đảo quyết định cũ)

Runner hiện đặt `persistSession: false` (cố ý, để "AWOG tự sở hữu storage ở ~/.awog/sessions/"). Nhưng SDK ghi rõ: `persistSession: false` ⇒ *"Sessions … cannot be resumed later"*. **Resume bắt buộc `persistSession: true`** (default).

- Bật persist (bỏ `persistSession: false`).
- **Cô lập**: set `env.CLAUDE_CONFIG_DIR = ~/.awog/sdk-sessions/` để SDK ghi transcript của nó vào không gian AWOG, **không lẫn `~/.claude` thật của user** (tránh đọc/ghi nhầm dữ liệu Claude Code cá nhân của họ — vừa là isolation vừa là privacy).
- **AWOG JSONL ở ~/.awog/sessions/ vẫn là source of truth cho UI**; transcript SDK ở ~/.awog/sdk-sessions/ chỉ là *store resumable* (cache). Hai nơi, AWOG canonical.
- Bảo mật: transcript SDK chứa nội dung hội thoại trên đĩa (local-first, chấp nhận) nhưng nằm trong `~/.awog` (chmod 700) — không rò ra ngoài. Cần `sessions.purge` tương lai dọn transcript mồ côi.

### 1. Persist `sdkSessionId` cho mỗi AWOG session

Thêm field `sdkSessionId?: string` vào `Session` (sidecar `types/shared.ts` + UI `types/index.ts`), lưu trong metadata JSONL. Đây là **cache resumable**, không phải source of truth — AWOG JSONL mới là canonical.

### 2. Lượt đầu (chưa có `sdkSessionId`)

- Gửi **chỉ message mới**: `query({ prompt: pendingText, options })` (không `renderTranscript`).
- Bắt `session_id` từ message SDK đầu tiên (system `init` hoặc bất kỳ message nào) → trả về UI → persist vào session.

### 3. Lượt tiếp theo (đã có `sdkSessionId`)

- `query({ prompt: pendingText, options: { ...options, resume: sdkSessionId } })` — chỉ gửi message mới, SDK tự nạp lịch sử. **Bỏ `renderTranscript` ở nhánh resume.**
- `model` / `permissionMode` / tools vẫn truyền lại mỗi lượt (chúng là per-query option, resume không khoá chúng).

### 4. `/compact` — forward kiểu craft-agents

- Whitelist `SDK_SLASH_COMMANDS = ['compact']` trong runner.
- Khi `pendingText` (sau trim) **đúng** là `/compact` (regex `^/([a-z]+)(\s|$)` + nằm trong whitelist + không attachment) → gửi thẳng `query({ prompt: '/compact', options: { resume: sdkSessionId } })`, **không** bọc context/transcript. SDK kích hoạt compaction trên session đang resume.
- UI: handler `/compact` ở composer (đã có stub từ ADR-A) gọi đường gửi này thay vì notice "chưa khả dụng".

### 5. Branch/fork

`branchFromMessage` (UI) khi tạo session nhánh: lượt gửi đầu của nhánh dùng `{ resume: parentSdkSessionId, forkSession: true }` → SDK fork, bắt `session_id` mới làm `sdkSessionId` của nhánh. (craft-agents dùng đúng cơ chế `--fork-session` này.)

### 6. Xử lý resume thất bại (fallback — bắt buộc)

Session SDK có thể không còn (hết hạn, xoá, đổi máy, user sửa/xoá message trong AWOG khiến lệch). Nếu `query({ resume })` lỗi "session not found"/tương đương:

1. Log + clear `sdkSessionId`.
2. **Re-seed**: gửi lượt đó như **session SDK mới** với prompt = `renderTranscript(history, pendingText)` (giữ nguyên hành vi cũ làm bệ đỡ), bắt `session_id` mới.
3. Các lượt sau lại resume bình thường.

→ `renderTranscript` **không bị xoá**, giữ làm đường seed/fallback.

### Bất biến bảo mật (HARD — infosec review trước merge)

- `cwd = workspaceRoot` giữ nguyên; OAuth token chỉ ở `options` trong sidecar (invariant #1).
- `sdkSessionId` là **UUID opaque** — validate format (`/^[0-9a-f-]{36}$/i`) trước khi truyền vào `resume`/`sessionId` (input L2 từ store → re-validate ở biên). Không nội suy vào shell/path.
- Không log nội dung compaction ra event UI (chỉ trạng thái).

## Phương án đã cân nhắc

- **Giữ transcript-flattening + tự compaction app-side** (gọi model 1 lượt tóm tắt, thay history bằng summary). Ưu: không đổi kiến trúc, AWOG vẫn single-source. Nhược: tự viết lại compaction, vẫn lãng phí token mỗi lượt, `/compact` vẫn không phải SDK-native, lệch hành vi với reference. → từ chối làm giải pháp chính (giữ làm fallback seed).
- **Hybrid**: transcript cho turn thường, summarize app-side cho `/compact`. Đơn giản hơn nhưng không sửa được lãng phí token + không tận dụng SDK. → từ chối.
- **`continue: true` thay vì `resume: <id>`**: dựa vào "session gần nhất trong cwd". Mong manh khi nhiều session cùng project chạy song song (đụng cwd). → từ chối, dùng `resume` theo id tường minh.

## Hệ quả

**Tích cực:** tiết kiệm token (chỉ gửi message mới), có auto-compaction SDK, `/compact` chạy thật, branch dùng fork SDK (rẻ + đúng ngữ cảnh).

**Rủi ro / phải quản:**
- **Hai nguồn lịch sử** (AWOG JSONL canonical + transcript session SDK). Phải coi session SDK là cache resumable; mọi thao tác sửa/xoá message phía AWOG có thể làm lệch → invalidate `sdkSessionId` (clear → re-seed lượt kế).
- **Đổi model/mode giữa chừng**: vẫn truyền per-query nên OK, nhưng cần test resume không "đóng băng" option cũ.
- **Restart**: transcript SDK có thể còn (SDK ghi ra đĩa) hoặc không; fallback re-seed bảo đảm không vỡ.
- Cần migration: session cũ không có `sdkSessionId` → coi như "cần seed ở lần gửi kế" (đường lượt-đầu xử lý sẵn).

## Triển khai

**Đã làm (core — bước 0–4, 6):**

0. `persistSession: true` + `env.CLAUDE_CONFIG_DIR = ~/.awog/sdk-sessions/` (mkdir 0o700 best-effort trước query) — [runner.ts](../../apps/desktop/sidecar/src/sessions/runner.ts).
1. Schema `sdkSessionId?` ở `types/shared.ts` + UI `types/index.ts` + `SessionMetadataPatch` (fold qua `session.metadata.updated`).
2. Runner: `runOnce(resumeId)` tách nhánh `seed | resume | slash-command`; bắt `session_id` từ stream (`capturedSessionId`); trả `RunStreamResult.sdkSessionId`; validate UUID trước khi `resume`; **fallback** resume-fail → re-seed (chỉ khi chưa stream chunk nào).
3. `sessions.send-message.ts`: load `sdkSessionId` của session → truyền vào runner; persist lại nếu đổi (`updateSessionMetadata`).
4. `/compact`: RPC **riêng** `sessions.compact` (không qua sendMessage → không có bubble `/compact`); composer `onCommand` → `store.compactSession` → RPC; sidecar append system note + cập nhật `sdkSessionId`.
6. Fallback resume-fail: `isResumeFailure` heuristic → `runOnce(undefined)`.

**Hoãn (PR sau):**

5. Branch: `forkSession` ở lượt đầu của nhánh (cần wire `branchFromMessage` → truyền parent `sdkSessionId` + `forkSession`).
- Invalidate `sdkSessionId` khi user sửa/xoá message giữa session (hiện chỉ dựa vào fallback resume-fail).

**Chưa làm:** infosec review (chạm SDK/IPC/persist); **runtime test thật** (chưa chạy được vòng lặp SDK với account thật trong môi trường này) — cần verify: resume nạp đúng history, `/compact` chạy, transcript ghi vào `~/.awog/sdk-sessions/` (không lẫn `~/.claude`), fallback khi xoá session SDK.
```
