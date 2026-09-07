# Vòng đời phiên: lưu trữ, xem log thô, xuất JSON

Ba thao tác vòng đời phiên ở tầng sidecar (WP2). Tất cả đều là **RPC** trên
`apps/desktop/sidecar/src/methods/sessions.*`; UI gọi qua IPC như mọi `sessions.*` khác.

| Việc | RPC | Trạng thái |
|---|---|---|
| Lưu trữ phiên (ẩn, không xoá) | `sessions.setArchived` (mới) + `sessions.list` (đổi hành vi) | Implemented |
| Xem log JSONL thô để debug | `sessions.listEvents` (mới) | Implemented |
| Xuất transcript dạng JSON | `sessions.save-export` format `'json'` (mở rộng) | Implemented |

## 1. Lưu trữ phiên (archive)

### Vấn đề

Trước WP2 chỉ có hai đầu mút: `pinned` (ghim lên đầu danh sách) và `sessions.delete`
(xoá vĩnh viễn cả thư mục `~/.awog/sessions/{id}/`). Không có bậc trung gian "tôi xong
việc với phiên này, cất đi, nhưng đừng xoá".

### Mô hình

`archived` là **metadata thuần của header**, đúng như `pinned`:

- `Session.archived?: boolean` + `Session.archivedAt?: string` (ISO-8601, chỉ có mặt
  khi `archived === true`).
- Persist ở **dòng 1** của `session.jsonl` (`SessionHeader extends Omit<Session,
  'messages'>` nên field mới chảy qua tự động — xem `sessions/jsonl.ts`).
- Chiếu lên `SessionSummary.archived` / `.archivedAt` để danh sách badge được mà không
  phải nạp transcript.

**Lưu trữ KHÔNG đụng tới bất cứ thứ gì khác**: transcript trên đĩa giữ nguyên, bookmark
không bị prune (khác 3 đường cắt của [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md)),
snapshot Rewind không bị xoá, attachments không bị xoá. Bỏ lưu trữ chỉ việc **xoá hẳn
hai field** — vì vậy nó nằm ở một hàm riêng (`sessionManager.setArchived`) chứ không đi
qua `updateMetadata`: patch kiểu spread không xoá được key, và `exactOptionalPropertyTypes`
cấm gán `undefined` vào field optional.

`updatedAt` **cố ý không bump** khi archive/unarchive: lưu trữ là thao tác dọn dẹp của
người dùng, không phải hoạt động của phiên. Bump sẽ ném một phiên vừa bỏ lưu trữ lên đầu
danh sách (sắp xếp theo `updatedAt`) dù nó đã im lặng nhiều tháng.

### Contract

```ts
// sessions.setArchived
params: { id: string; archived: boolean }
result: { ok: true }
// Lỗi: -32004 'Session not found' khi id không tồn tại;
//      -32602 'Invalid params' khi id sai charset (^[a-z0-9-]+$) hoặc thiếu field.
```

### ⚠ Đổi hành vi mặc định của `sessions.list`

```ts
// sessions.list
params: { includeArchived?: boolean }   // mặc định FALSE
result: { sessions: SessionSummary[] }
```

**Từ WP2, `sessions.list` KHÔNG trả về phiên đã lưu trữ trừ khi truyền
`includeArchived: true`.** Caller cũ gọi không tham số vẫn hợp lệ (params optional) —
nhưng sẽ thấy ít phiên hơn trước nếu người dùng có lưu trữ. Đây là thay đổi có chủ ý:
đó chính là điều "lưu trữ" nghĩa là gì với người dùng.

Chỗ đặt bộ lọc cũng có chủ ý: nó nằm ở **method**, không ở
`listSessionSummaries()` trong `sessions/store.ts`. Các consumer nội bộ
(`activity.summary`, `sessions.active-turns`, `collectUsageSince`,
`collectSessionTurnsSince`) vẫn phải thấy **mọi** phiên — nếu không, chi phí token của
một phiên đã lưu trữ sẽ biến mất khỏi báo cáo Activity. Ẩn khỏi danh sách là quyết định
của **bề mặt UI**, không phải của tầng lưu trữ.

Ngoài phạm vi WP2 (ghi lại để khỏi tưởng là bug):

- `sessions.search` vẫn tìm cả trong phiên đã lưu trữ.
- `sessions.get` vẫn mở được một phiên đã lưu trữ bằng id.
- `persistence-queue.ts` chưa đưa `archived` vào chữ ký metadata chống-ghi-đè-ngoài
  (`headerMetadataSignature`), giống hệt `todos`/`bookmarks` hiện nay: sửa tay file
  `session.jsonl` **trong lúc app đang chạy** có thể bị bản trong bộ nhớ ghi đè. Cần
  chạm file đó thì gộp chung một lần với `todos`/`bookmarks`.

## 2. `sessions.listEvents` — xem log JSONL thô

### Vấn đề

Transcript nằm ở `~/.awog/sessions/{id}/session.jsonl` nhưng không có đường đọc thô.
`sessions.get` trả về `Session` đã **fold**: dòng hỏng bị bỏ im lặng
(`parseMessagesResilient`), header bị tháo ra thành metadata. Khi một phiên hiển thị
sai thì đúng những thứ vừa bị giấu mới là thứ cần xem.

### Contract

```ts
// sessions.listEvents
params: {
  id: string           // ^[a-z0-9-]+$
  offset?: number      // >= 0, mặc định 0 — chỉ số dòng 0-based
  limit?: number       // 1..1000, mặc định 200
}
result: {
  events: SessionRawEvent[]
  total: number        // tổng số dòng của file → UI phân trang
  offset: number       // echo lại giá trị đã áp dụng
  limit: number
}

type SessionRawEvent = {
  line: number         // số thứ tự 1-BASED trong file (không phải trong trang)
  bytes: number        // kích thước UTF-8 của dòng, không kể '\n'
  kind: 'header' | 'message' | 'malformed'
  data?: unknown       // JSON đã parse + đã redact; vắng mặt khi 'malformed'
  raw?: string         // 500 ký tự đầu của dòng hỏng; chỉ có ở 'malformed'
}
```

- Dòng 1 → `kind: 'header'`, các dòng sau → `'message'` (đúng layout của
  `sessions/jsonl.ts`).
- **Dòng hỏng không làm sập RPC.** `JSON.parse` fail → entry `'malformed'` với 500 ký tự
  đầu. Phơi bày dòng hỏng chính là giá trị của công cụ này.
- `data` là `unknown` có chủ ý: đây là view log thô, shape là bất cứ thứ gì trong file —
  UI không được giả định đó là `SessionMessage` hợp lệ.
- Lỗi: `-32004 'Session not found'` khi thư mục phiên chưa có `session.jsonl`.

## 3. Xuất JSON (`sessions.save-export` format `'json'`)

### Contract

```ts
// sessions.save-export
params: {
  sessionId: string
  format: 'md' | 'html' | 'prompt' | 'json'   // 'json' là biến thể mới
  content?: string                             // BẮT BUỘC với md/html/prompt; BỎ QUA với json
}
result: { path: string; root: string; rel: string }
```

Khác biệt cốt lõi của `'json'`: **nội dung do sidecar dựng, không nhận từ UI.** Ba định
dạng kia là bản render của UI (dùng lại `useMarkdown`); JSON là bản xuất máy đọc được để
chia sẻ / di cư nên nó phải là transcript **đã persist**, không phải thứ UI đang hiển thị.
Gọi `format: 'json'` mà thiếu `content` là hợp lệ; gọi md/html/prompt mà thiếu `content`
trả `-32602 'Missing content'`.

Shape file xuất:

```jsonc
{
  "format": "awog.session.v1",   // hợp đồng phiên bản — bên đọc phải kiểm tra trước
  "exportedAt": "2026-09-06T…Z",
  "header": { /* mọi field của Session TRỪ messages, đã redact */ },
  "messages": [ /* SessionMessage[], đã redact */ ]
}
```

**Đường ghi vẫn do sidecar sở hữu** (không đổi, invariant #2/#3): file luôn nằm ở
`<base>/.awog/exports/<slug-title>-<8 ký tự id>.json`, với `base` = project root khi
phiên thuộc project, ngược lại là AWOG home. RPC **không bao giờ** nhận đường dẫn từ UI;
tên file được slugify từ title.

## Bảo mật — đã redact những gì

`sessions.listEvents` và export `'json'` là hai bề mặt **mới** phơi bày dữ liệu phiên ở
dạng thô: khác `sessions.get` (chỉ trả những dòng chat mà UI vốn đã hiển thị), chúng đưa
ra **toàn bộ object** (kể cả field nội bộ, tool I/O) và ghi ra file người dùng đem đi chia
sẻ. Transcript là **L1** — nội dung do người dùng gõ, do model sinh, cộng tool I/O
(`export TOKEN=…` trong Bash, header HTTP, khối `env` của MCP) — nên cả hai đều đi qua
[`sessions/redact.ts`](../../apps/desktop/sidecar/src/sessions/redact.ts) trước khi rời
sidecar (invariant #1).

Bộ lọc chạy **3 lớp**, fail-safe theo hướng che nhiều hơn thiếu — nhưng không che tới
mức làm hỏng công dụng của chính hai bề mặt này (xem [Cố ý không
redact](#cố-ý-không-redact)). Lớp 1 và lớp 3 được viết lại 2026-09-07 sau audit infosec
(F6 — nhiều ca rò rỉ thật đi qua nguyên vẹn).

**Lớp 1 — theo tên field** (chuẩn hoá lowercase, bỏ `_`/`-`, so kiểu **chứa**):
`apikey`, `accesskey`, `authorization`, `bearer`, `clientsecret`, `cookie`, `credential`,
`passphrase`, `password`, `passwd`, `privatekey`, `refreshtoken`, `secret`, `token`; cộng
3 tên khớp **tuyệt đối** (quá ngắn để so kiểu chứa, sẽ dính `bypass`/`author`/`authMode`):
`auth`, `pass`, `pwd`.

Khớp ⇒ thay **cả nhánh con**, **bất kể kiểu**. Trước đây lớp này chỉ áp cho giá trị
**chuỗi**, nên hai ca rất thật đi lọt: `{"authorization": ["abc123…"]}` (mảng) và
`{"credentials": {"user":"a","pass":"Xy9…"}}` (object — khoá con `pass` khi đó chưa có
trong danh sách). Đi sâu vào một nhánh đã biết là bí mật thì mất dấu, nên che nguyên nhánh.

Ba ngoại lệ hẹp — giá trị **không thể** chứa byte bí mật, mà che đi thì mất thông tin:

| Ngoại lệ | Ví dụ | Vì sao giữ |
|---|---|---|
| `null` | `apiKey: null` | "chưa cấu hình" — thay bằng `[redacted]` là nói dối |
| boolean | `hasApiKey: true`, `isAuthenticated: false` | cờ trạng thái, không phải khoá |
| **số** dưới khoá chỉ khớp mỗi `token` | `usage.inputTokens`, `contextTokens`, `maxTokens`, `tokensBefore` | số liệu đếm — báo cáo chi phí phải đọc được |

Số dưới `password`/`secret`/`apiKey` thì **vẫn che** (PIN, mã số).

**Lớp 2 — theo hình dạng giá trị** (áp cho mọi chuỗi, thay đúng đoạn khớp, giữ phần văn
bản còn lại đọc được):

| Hình dạng | Ví dụ |
|---|---|
| `sk-…` (Anthropic / OpenAI và các provider cùng quy ước) | `sk-ant-api03-…` |
| `ghp_ gho_ ghu_ ghs_ ghr_` + `github_pat_…` | GitHub token / fine-grained PAT |
| `glpat-…` | GitLab PAT |
| `AIza…` | Google API key |
| `xoxb- xoxa- xoxp- xoxr- xoxs-` | Slack token |
| `AKIA…` | AWS access key id |
| `sk_live_ sk_test_ rk_live_ rk_test_`, `whsec_…` | Stripe secret/restricted key, webhook signing secret |
| `npm_…`, `hf_…` | npm automation token, Hugging Face token |
| `…3 ký tự + chữ số + Q~ + …` | Azure AD client secret (dấu `~` là hình dạng riêng) |
| `eyJ….….…` | JWT |
| `Bearer <token>`, `Basic <base64>` | header Authorization / lệnh curl |
| `-----BEGIN … PRIVATE KEY----- … -----END … PRIVATE KEY-----` | khối PEM |
| `scheme://user:pass@host` | URL có credential nhúng — chỉ thay mật khẩu, giữ scheme + user |

**Lớp 3 — gán `KHOÁ=giá trị` / `KHOÁ: giá trị` nằm TRONG một chuỗi** (mới). Lớp 1 chỉ
nhìn **khoá JSON**, nên bí mật nằm giữa một chuỗi thì vô hình với nó — mà đó lại là dạng
rò rỉ phổ biến nhất trong tool I/O và buffer terminal:

- `{"input":{"command":"curl -H 'X-Api-Key: 9f2c…' https://…"}}` — khoá JSON là `command`, vô hại.
- `{"command":"PGPASSWORD=Sup3rS3cret psql …"}` — không tiền tố nào của lớp 2 khớp.
- dump header nhiều dòng: `X-API-KEY: 8f14e45f…`, `AWS_SECRET_ACCESS_KEY=wJalr…`.

Tên khoá nhận diện: `password|passwd|passphrase|secret|token|credential|authorization|api[_-]?key|access[_-]?key|private[_-]?key`, cho phép tiền tố/hậu tố tuỳ ý (`X-Api-Key`,
`PGPASSWORD`, `AWS_SECRET_ACCESS_KEY`). Cố ý **không** có `auth` trần (dính
`author: "Nguyen Van A"`) và **không** có `key` trần (dính `keyFile=/path`). Chỉ thay
**giá trị**, giữ tên khoá → dòng log vẫn đọc được: `X-API-KEY: [redacted]`.

Giá trị chỉ bị che khi "có mùi bí mật": dài ≥ 4, không phải placeholder
(`null`/`true`/`none`/`[redacted]`…), không phải số/tỉ lệ (`maxTokens=100000`,
`contextTokens: 87%`), không phải semver (`token: v1.2.3`), **và** có chữ số, hoặc có ký
hiệu `_ + / = ~ @ % & * $ # !`, hoặc dài ≥ 12. Cân bằng này giữ văn xuôi lại được: một
khoá nhạy cảm đứng trước một từ tiếng Anh ngắn thường là câu văn (`Token: Reserved for
later`), còn bí mật thật gần như luôn có chữ số/ký hiệu/độ dài.

**Không phải bí mật nhưng vẫn bị cắt:** data URL base64 (`data:<mime>;base64,…`) của ảnh/
PDF đính kèm → `data:<mime>;base64,[stripped: N base64 chars]`. Lý do là kích thước: ở
view debug thì bytes vô dụng, ở export thì vài MB base64 làm hỏng file. Bytes gốc vẫn nằm
nguyên tại `~/.awog/sessions/{id}/attachments/`.

Ngoài ra: `redactDeep` luôn trả về **bản sao**, không bao giờ mutate input — `save-export`
nhận `Session` đang nằm trong cache ấm của `sessionManager`, làm bẩn nó là làm hỏng
transcript của phiên đang chạy. Độ sâu cap ở 24 cấp (`[truncated: too deep]`) để một file
bệnh hoạn không làm tràn stack. `redactString` **idempotent**: chạy lại trên chuỗi đã lọc
cho đúng kết quả cũ.

### Cố ý không redact

Đây là nửa khó của bài toán: che quá tay thì hai công cụ này mất hết tác dụng, nên các ca
dưới đây có test hồi quy riêng, ngang hàng với test bắt bí mật.

- **Id** (session/message/account/project), **đường dẫn file**, **tên model**, `authType`/
  `authMode`, **chỉ số token/chi phí**, nội dung chat thường.
- **Chuỗi entropy cao "trần"** — hex/base64 32–64 ký tự không có tiền tố và không đứng sau
  khoá nhạy cảm. Một luật như thế sẽ nuốt luôn SHA commit, `sha256:…`, hash nội dung, id
  nội bộ và mọi đoạn base64 của văn bản thường. Blob entropy cao chỉ bị che khi ngữ cảnh
  nói rõ nó là bí mật, tức khi nó đứng sau một khoá nhạy cảm (lớp 3).
- **Đường dẫn tới file khoá** vẫn bị che nếu tên biến chứa `private_key`/`secret`
  (`SSH_PRIVATE_KEY_PATH=/home/x/id_rsa` → `[redacted]`) — chấp nhận over-redact ở đây,
  đổi lại không phải đoán "cái này là path hay là khoá".

### Test

[`sessions/__tests__/redact.test.ts`](../../apps/desktop/sidecar/src/sessions/__tests__/redact.test.ts)
— 23 test, hai nhóm cân nhau: nhóm **bắt được** (6 ca F6 từng lọt + hình dạng token mới +
không hồi quy lớp 2 + idempotent + không mutate) và nhóm **cố ý không redact**. Chạy:
`npx vitest@2 run src/sessions/__tests__/redact.test.ts` trong `apps/desktop/sidecar`
(vitest chưa nằm trong devDeps, xem `git/__tests__/discover.test.ts`).

### Bề mặt read_terminal

Tool `read_terminal` ([agent-tools-parity](./agent-tools-parity.md#1-read_terminal--model-đọc-được-terminal-của-người-dùng))
dùng lại **cùng** `redactString` cho ring buffer terminal của người dùng trước khi trả về
cho model. Khác hai bề mặt trên ở chỗ đích đến không phải màn hình người dùng mà là **nhà
cung cấp model** — nên nó là lý do lớp 3 tồn tại: terminal đầy `export TOKEN=…`,
`cat .env`, `kubectl get secret`.

### Bề mặt remote

Cả `sessions.setArchived` và `sessions.listEvents` **không** nằm trong allowlist của
Remote Gateway ([`remote-gateway-policy.ts`](../../apps/desktop/electron/src/remote-gateway-policy.ts)),
nên không lên PWA. Muốn mở ra thì bắt buộc **infosec re-audit**
([ADR 0067](../decisions/0067-mobile-remote-control-transport.md)).

## File liên quan

| File | Vai trò |
|---|---|
| `sidecar/src/types/shared.ts` | `Session.archived/archivedAt`, `SessionSummary.archived/archivedAt`, `SessionRawEvent`, `SessionRawEventPage` |
| `sidecar/src/sessions/redact.ts` | Bộ lọc bí mật dùng chung cho listEvents + export JSON + `read_terminal` |
| `sidecar/src/sessions/__tests__/redact.test.ts` | Test 2 chiều: ca phải che / ca cố ý giữ |
| `sidecar/src/sessions/jsonl.ts` | `readSessionRawLines` (đọc thô từng dòng) |
| `sidecar/src/sessions/session-manager.ts` | `setArchived` + chiếu `archived` xuống `SessionSummary` |
| `sidecar/src/sessions/store.ts` | Facade `setSessionArchived`, `loadSessionRawLines` |
| `sidecar/src/methods/sessions.set-archived.ts` | RPC `sessions.setArchived` |
| `sidecar/src/methods/sessions.list-events.ts` | RPC `sessions.listEvents` |
| `sidecar/src/methods/sessions.list.ts` | Lọc phiên đã lưu trữ (`includeArchived`) |
| `sidecar/src/methods/sessions.save-export.ts` | Format `'json'` |
