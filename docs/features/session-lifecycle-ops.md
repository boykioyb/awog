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

Cùng bộ lọc còn chạy trên **đường vào prompt** của model: `read_terminal`, `dev_server`,
`browser` (header/response), hộp thư liên phiên, khối theo dõi PR, `note` của lời hẹn.
Trên đường đó "che nhầm" không chỉ là lỗi UX — model nhận một **bằng chứng sai** và đi sửa
một dòng code không tồn tại, đúng failure mode mà `EVIDENCE_PROMPT` sinh ra để chặn.

Bộ lọc chạy **3 lớp**, fail-safe theo hướng che nhiều hơn thiếu — nhưng không che tới
mức làm hỏng công dụng của chính hai bề mặt này (xem [Cố ý không
redact](#cố-ý-không-redact)). Lớp 1 và lớp 3 được viết lại 2026-09-07 sau audit infosec
(F6 — nhiều ca rò rỉ thật đi qua nguyên vẹn), rồi vá tiếp 2026-09-08 (F2/F3/F4 — xem
[Vòng vá thứ hai](#vòng-vá-thứ-hai-2026-09-08)).

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
- **JSON đã in ra thành chuỗi**: `{"apiKey":"abcd1234…"}` — sau tên khoá là dấu **nháy**
  rồi mới tới `:`, nên dấu phân cách cho phép `["']?` đứng trước. Lớp 1 không cứu ca này
  vì nó chỉ chạy trên object THẬT; `cat ~/.awog/credentials.json` qua `read_terminal` đi
  đúng đường chuỗi này, và key của endpoint tuỳ biến **không có tiền tố nào** cho lớp 2.
- **Cờ CLI có giá trị cách bằng khoảng trắng**: `mysql --password …`,
  `gh auth login --token …` (dạng `--password=…` thì đã là gán). Cờ ngắn `-p` chỉ được
  hiểu là mật khẩu khi đứng sau `docker login`/`mysql`/`mysqldump`/`mysqladmin`/
  `redis-cli`/`mongo`/`mongosh` — không có hàng rào đó thì `mkdir -p /path` và
  `docker run -p 8080:80` bị che.

Tên khoá nhận diện: `password|passwd|passphrase|secret|token|credential|authorization|api[_-]?key|access[_-]?key|private[_-]?key`, cho phép tiền tố/hậu tố tuỳ ý (`X-Api-Key`,
`PGPASSWORD`, `AWS_SECRET_ACCESS_KEY`). Cố ý **không** có `auth` trần (dính
`author: "Nguyen Van A"`) và **không** có `key` trần (dính `keyFile=/path`). Chỉ thay
**giá trị**, giữ tên khoá → dòng log vẫn đọc được: `X-API-KEY: [redacted]`.

Giá trị chỉ bị che khi "có mùi bí mật": dài ≥ 4, không phải placeholder
(`null`/`true`/`none`/`[redacted]`…), không phải số/tỉ lệ (`maxTokens=100000`,
`contextTokens: 87%`), không phải semver (`token: v1.2.3`), **không chứa ký tự cú pháp**
``( ) < > { } [ ] $ * ` `` hay khoảng trắng nội bộ, **không phải định danh thuần**
(`^[A-Za-z_][A-Za-z_.-]*$` — tên biến không chữ số), **và** có chữ số hoặc ký hiệu
`_ + / = ~ @ % & # !`. Cân bằng này giữ văn xuôi VÀ mã nguồn lại được: một khoá nhạy cảm
đứng trước một từ tiếng Anh ngắn thường là câu văn (`Token: Reserved for later`), đứng
trước một biểu thức thì là code (`const secret = process.env.MY_SECRET`), còn bí mật thật
gần như luôn có chữ số hoặc ký hiệu.

**Ngoại lệ: khoá kiểu biến môi trường và cờ CLI được nới.** Hai hàng rào cuối (khoảng
trắng nội bộ, định danh thuần) sinh ra để bảo vệ **mã nguồn**, nhưng ở vế phải của
`PGPASSWORD=…`, `SSH_PASSPHRASE="…"`, `--token …`, `ssh-keygen -N '…'` thì theo định
nghĩa không có mã nguồn — có thông tin đăng nhập. Nên khi tên khoá khớp
`^[A-Z][A-Z0-9_]*$` hoặc khớp đến từ một cờ CLI, giá trị chỉ cần **dài ≥ 6** và **không
chứa ký tự cú pháp**; khoảng trắng và định danh thuần không còn loại nó.

Con số đến từ phép đo, không phải suy đoán: quét **577 phiên thật** trong
`~/.awog/sessions` (chuỗi đã parse) cho ~950 lần khớp thêm, phần áp đảo là thông tin
đăng nhập **đang lọt** — `POSTGRES_PASSWORD=pwpf_dev`, `MINIO_ROOT_PASSWORD=minioadmin`,
`AWS_SECRET_ACCESS_KEY=minioadmin`, `DB_PASSWORD=postgres`,
`SECRET_KEY=change-me-in-production` — vì hàng rào "định danh thuần" nuốt trọn mọi bí mật
toàn chữ hoặc có gạch nối. Che nhầm còn ~140 lần, toàn hằng mã lỗi
(`API_KEY_EXPIRED="unauthorized"`).

Khoá **viết thường** cố ý **không** được nới. Cùng bộ 577 phiên: nới ra mọi giá trị trong
nháy che thêm 104 chuỗi mà gần như tất cả là nhãn i18n ("Nhập mật khẩu", "Enter your
password", "Passwords do not match"), và không bắt thêm bí mật thật nào. Cái giá đã biết:
một cụm mật khẩu toàn chữ sau khoá viết thường (`passphrase: "correct horse battery
staple"`) vẫn lọt — không có dấu hiệu cấu trúc nào tách nó khỏi một nhãn giao diện, và
đổi 104 lần hỏng bằng chứng lấy 0 lần bắt được là một vụ đổi tồi.

**Không phải bí mật nhưng vẫn bị cắt:** data URL base64 (`data:<mime>;base64,…`) của ảnh/
PDF đính kèm → `data:<mime>;base64,[stripped: N base64 chars]`. Lý do là kích thước: ở
view debug thì bytes vô dụng, ở export thì vài MB base64 làm hỏng file. Bytes gốc vẫn nằm
nguyên tại `~/.awog/sessions/{id}/attachments/`.

Ngoài ra: `redactDeep` luôn trả về **bản sao**, không bao giờ mutate input — `save-export`
nhận `Session` đang nằm trong cache ấm của `sessionManager`, làm bẩn nó là làm hỏng
transcript của phiên đang chạy. Độ sâu cap ở 24 cấp (`[truncated: too deep]`) để một file
bệnh hoạn không làm tràn stack. `redactString` **idempotent**: chạy lại trên chuỗi đã lọc
cho đúng kết quả cũ, và có **trần độ dài đầu vào 1 MiB** — phần vượt trần bị cắt kèm nhãn
`[truncated: N chars over the redaction cap]` chứ không được đi qua không lọc.

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
- **Mã nguồn sau một khoá nhạy cảm** — `const token = useCookie<string | null>(…)`,
  `password = models.CharField(max_length=128)`, `apiKey: options.apiKey ?? undefined`,
  `TOKEN=$(cat /tmp/t)`, `sed 's/PASSWORD=.*/PASSWORD=***/'`. Lớp 3 từ chối mọi giá trị
  có hình dạng biểu thức.
- **Giá trị toàn chữ cái, không chữ số, không ký hiệu** (`password: abcdefghijkl`) —
  đánh đổi CÓ CHỦ Ý của vòng vá F4, có test tường minh. Thêm một chữ số thì lại bị che.

### Vòng vá thứ hai (2026-09-08)

Audit infosec kế tiếp trả về ba finding, cả ba đều có số đo thật.

**F3 — độ phức tạp bậc hai (nặng nhất).** Sidecar chạy **một luồng** và phục vụ mọi RPC,
nên một `redactString` chậm là một engine đứng hình. Hai lượng tử "mở" gây ra chuyện đó:
`([a-z][a-z0-9+.-]*` mở đầu rule URL và `[A-Za-z0-9_.-]*` mở đầu lớp 3 — ở **mọi** vị trí
trong một dãy chữ-số dài, chúng nuốt tới cuối dãy rồi lùi lại để tìm cái không có. Gấp đôi
input ⇒ gấp bốn thời gian (đo trên Node 22, M-series, ms):

| Input 200 KB | Trước | Sau |
|---|---|---|
| PEM thiếu dấu `END` | 64 234 | 29 |
| dãy chữ trần | 62 889 | 29 |
| `password=` + dãy dài | 25 286 | 28 |
| nháy mở không bao giờ đóng | 66 172 | 30 |
| nhiều mốc `BEGIN` | 127 | 81 |
| log thật (nhiều dòng) | 4 | 5 |

Sau vá, gấp đôi input ⇒ gấp đôi thời gian; ở đúng trần 1 MiB thì ca xấu nhất là 434 ms.

Hệ quả cụ thể của bản trước: `save-export`/`listEvents` chạy `redactDeep` trên **toàn bộ**
transcript ⇒ hàng chục giây ⇒ lỡ 3 nhịp heartbeat ⇒ `killWedged()` giết engine giữa lượt.
Bản vá đặt **trần cho mọi lượng tử mở** (phụ tố tên khoá 24, giá trị 4096, thân PEM 8000
gói trong "atomic group" `(?=(…))\1`, scheme URL 24, khoảng trắng sau `Bearer` 8), thêm
**trần đầu vào 1 MiB** cho `redactString`, và đảo thứ tự ở `schedules/wakeup.ts`: `note`
được kiểm **độ dài trước**, khử bí mật sau — cộng `maxLength` trong schema của tool
`schedule_wakeup`, nên một `note` vài MB bị từ chối với chi phí O(1).

**F2 — lọt hình dạng rò rỉ phổ biến nhất.** Khoá JSON trong nháy và cờ CLI (chi tiết ở
lớp 3 bên trên). Trước vá, cả 5 ca sau đi qua **nguyên vẹn**: `{"apiKey":"…"}`,
`{"api_key": "…"}`, `{ "password" : "…" }`, `mysql --password …`,
`docker login -u me -p …`.

**F4 — che nhầm nặng, và nó làm hỏng bằng chứng gửi cho model.** Đo trên 366 dòng JSONL
của 40 phiên: `.steps[].detail.content` bị sửa **207 lần**, `.detail.output` 38,
`.detail.diff` 27 — gần như toàn bộ là tên biến, dính vì luật cũ "dài ≥ 12 ký tự là đủ".
Luật đó bị gỡ và thay bằng hai hàng rào hình dạng (ký tự cú pháp / định danh thuần).
**Không** tách `detail.diff`/`detail.content` ra khỏi lớp 3: một `Write` ghi file `.env`
mang đúng `DB_PASSWORD=…` trong `content`, bỏ lớp 3 ở đó là mở lại một lỗ thật.

**F4b — hàng rào của chính F4 mở ra một lỗ mới.** Phát hiện khi kiểm chứng lại bản vá
F4 chứ không phải khi audit: "định danh thuần" khớp `^[A-Za-z_][A-Za-z_.-]*$`, nên nó
chặn `password: hashedPassword` (đúng ý đồ) **và** `SECRET_KEY=change-me-in-production`
(không hề đúng ý đồ). Cùng lúc, hàng rào "khoảng trắng nội bộ" làm lọt sạch dạng
passphrase bốn từ được khuyến nghị rộng rãi. Cả hai đóng bằng ngoại lệ env/CLI ở trên —
đo được, không phải nới bừa.

### Test

[`sessions/__tests__/redact.test.ts`](../../apps/desktop/sidecar/src/sessions/__tests__/redact.test.ts)
— 47 test, các nhóm cân nhau: **bắt được** (6 ca F6 từng lọt + hình dạng token mới + JSON
trong chuỗi và cờ CLI của F2 + không hồi quy lớp 2 + idempotent + không mutate), **cố ý
không redact** (metadata, SHA, văn xuôi) và **mã nguồn không được đụng tới** (F4), cộng
nhóm **hiệu năng** (F3 — 5 hình dạng đối kháng 200 KB phải xong dưới 2 giây; bản trước mất
25–66 giây) và nhóm **khoá env / cờ CLI** (F4b, kèm ranh giới cố ý: khoá viết thường vẫn
giữ nguyên nhãn giao diện, `-N` chỉ mang nghĩa passphrase sau `ssh-keygen`). Chạy:
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
