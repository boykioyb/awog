# Dev server của dự án

> Trạng thái: đã code (sidecar). Chưa có UI.
> Liên quan: [ADR 0066](../decisions/0066-session-background-exec-and-wake.md) (background exec),
> [ADR 0080](../decisions/0080-command-scoped-permission-rules.md) (luật quyền theo lệnh),
> [ADR 0070](../decisions/0070-share-claude-home-for-config.md) (nhà của config-entity),
> [ADR 0019](../decisions/0019-pty-terminal-in-sidecar.md) (terminal PTY).

## Vấn đề

Model bật được dev server bằng `Bash({ run_in_background: true })` và đọc được output bằng `BashOutput`. Chạy thì được, nhưng **không có khái niệm "server đã đăng ký"**:

- Không biết dự án này chạy bằng lệnh gì. Mỗi lượt chat model đoán lại: `npm run dev`? `pnpm dev`? ở thư mục con nào? cổng nào?
- Không biết cái gì đang chạy. Bật trùng ⇒ hai tiến trình giành một cổng, và cái thứ hai thường chết bằng `EADDRINUSE` giữa một đống log.
- Không dừng được theo tên — chỉ theo `shellId` mà nó phải nhớ từ lượt trước.
- `BashOutput` trả **cả đống**: 64KB đuôi log, mỗi request HTTP một dòng. Tìm một stack trace trong đó tốn token và thường trượt.

## Bản khai: `{project}/.awog/dev-servers.json`

Chỗ đặt theo [ADR 0070](../decisions/0070-share-claude-home-for-config.md): đây là dữ liệu **AWOG-only** (Claude Code không có layout nào cho nó) ⇒ nằm dưới `.awog` của dự án, không phải `.claude`.

```json
{
  "version": 1,
  "servers": [
    {
      "name": "web",
      "command": "pnpm",
      "args": ["dev"],
      "cwd": "apps/web",
      "port": 3000,
      "description": "Nuxt dev server"
    }
  ]
}
```

| Trường | Bắt buộc | Luật |
|---|---|---|
| `name` | ✓ | 1–40 ký tự `[A-Za-z0-9._-]`, không trùng (không phân biệt hoa thường). Vừa là khoá tra cứu vừa là marker trong chuỗi lệnh. |
| `command` | ✓ | **Một token** — tên chương trình hoặc đường dẫn tới nó. Không khoảng trắng, không ký tự shell, không bắt đầu bằng `-`. |
| `args` | | Mảng chuỗi, ≤ 32 phần tử, mỗi cái ≤ 512 ký tự, **không ký tự shell**. |
| `cwd` | | **Tương đối** so với gốc dự án, mặc định `.`. Tuyệt đối / `~` / leo ra ngoài dự án ⇒ từ chối. |
| `port` | | Số nguyên 1–65535. Chỉ để hiển thị + nhắc model, AWOG không tự dò cổng. |
| `description` | | Một dòng cho người đọc. |

Không hỗ trợ `env`, **cố ý**: biến môi trường do repo cấp là một bề mặt tiêm thêm (`LD_PRELOAD`, `NODE_OPTIONS='--require …'`) mà tính năng này không cần.

Nạp **fail-soft** như [ADR 0080 F2](../decisions/0080-command-scoped-permission-rules.md): entry hỏng bị bỏ + ghi một dòng lý do, entry lành vẫn nạp; JSON hỏng toàn phần ⇒ danh sách rỗng, không bao giờ throw. Trần 24 server/file.

## Vì sao "khai" ≠ "chạy"

**File này nằm trong repo, nên bất kỳ ai commit cũng được: nó là dữ liệu L1 KHÔNG TIN.**

Repo này đã vá **hai** lỗ hổng cùng lớp trong ngày 2026-09-07: luật quyền tầng project đặt trong repo ([ADR 0080](../decisions/0080-command-scoped-permission-rules.md), mục Đính chính F1) và trust của hook ([ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md)). Cả hai đều là *"một file trong repo khiến sidecar chạy lệnh mà không hỏi"*. **Một tool tự spawn theo file này sẽ là lỗ thứ ba**: thứ người dùng duyệt phải là **chuỗi lệnh họ đọc thấy**, mà một `start` tự spawn thì chuỗi đó đến từ một file trong repo và không ai nhìn nó cả.

> Từ **2026-09-08** tool này đã có cổng quyền, nhưng **chỉ cho `stop`** (xem mục dưới). `start` vẫn không spawn, nên lập luận trên vẫn nguyên giá trị.

Nên tính năng này tách hẳn **khai** khỏi **chạy**, và có đúng hai đường chạy:

### Đường của MODEL — đi qua cổng quyền thật

`dev_server({ action: 'start', name })` **không spawn**. Nó trả về nguyên văn chuỗi lệnh, và bắt model tự chạy:

```
Bash({ run_in_background: true, command: "cd /repo/apps/web && AWOG_DEV_SERVER=web pnpm dev" })
```

Việc khởi động vì thế đi qua **đúng** cổng quyền hiện có, với **đúng** chuỗi lệnh mà người dùng đọc thấy trong prompt, và chịu đủ mọi luật quyền: deny rule, plan mode (ở đó `Bash` bị chặn và tool này còn không được nạp), always-allow theo lệnh ([ADR 0080](../decisions/0080-command-scoped-permission-rules.md)).

Cái tool này thêm vào là thứ `Bash` trần không có: lệnh **đã được khai sẵn + kiểm tra**, và **kiểm tra trùng** — server đang chạy thì `start` từ chối, trả về cái đang chạy kèm `shellId` + cổng, và nói thẳng "đừng bật cái thứ hai".

### Đường của NGƯỜI DÙNG — RPC `devserver.start`

Chỉ chạy khi người dùng bấm nút trên UI, **sau khi đã đọc nguyên văn lệnh** (`command` do `devserver.list` trả về). UI phải gửi lại đúng chuỗi đó qua `confirmCommand`; sidecar so lại với chuỗi vừa dựng từ file — lệch ⇒ từ chối. Nó đóng đúng một cửa: file trong repo đổi (hoặc `git pull`) **giữa** lúc người dùng đọc và lúc họ đồng ý.

### Hàng rào thứ hai: hình dạng token

Kể cả khi ai đó bỏ qua cả hai cửa trên, một entry vẫn không nối được lệnh thứ hai: `command` là một token, `args` là mảng, và **không token nào được chứa** `; & | ` `` ` `` ` $ ( ) { } < > \ ' " ` xuống dòng hay ký tự điều khiển. Lúc ghép, token "hiền" giữ nguyên (để người dùng đọc được nguyên văn), token có khoảng trắng được bọc nháy đơn — an toàn vì nháy đơn đã bị cấm từ lúc nạp. `cwd` do sidecar dựng từ gốc dự án, **không bao giờ** nhận từ payload; RPC nhận `projectId` chứ không nhận đường dẫn.

### Cổng quyền: `stop` phải hỏi, `list`/`start`/`logs` thì không

Bổ sung 2026-09-08 (finding F3 của lượt audit) — `runtime/permission.ts`, `isGatedTool`:

`dev_server({ action: 'stop' })` **giết một tiến trình**, và tiến trình đó tồn tại được là vì người dùng đã duyệt lệnh khởi động nó. Việc dừng nó vì thế phải đi qua **cùng một cổng**, chứ không được lọt xuống dưới. Trước bản vá, `stop` chạy thẳng: không hỏi ở `ask`, không bị chặn ở plan mode.

Nhưng gate **cả tool** thì sai: `list`/`start`/`logs` không đổi gì ở ngoài tool, và bắt người dùng duyệt cả việc **đọc log** là cách nhanh nhất biến rào chắn thành thứ họ tắt đi. Nên cổng quyết theo **từng lời gọi**, đúng khuôn `isMutatingBrowserAction` của `browser_tool` — cũng là một tool nhiều hành động:

| Hành động | `execute` | `ask` / `accept-edits` | `plan` |
|---|---|---|---|
| `list` · `start` · `logs` | chạy | chạy, không hỏi | chạy |
| `stop` | chạy | **hỏi** | **chặn** |

Nhận diện tên đi qua `isDevServerToolName()` nên khớp **cả hai** cách viết: `dev_server` (nhánh Pi) và `mcp__awogdev__dev_server` (nhánh Claude SDK). Cả hai runtime dùng chung `makeBeforeToolCall`, nên hàng rào chỉ có một bản. Khoá bằng test: [`runtime/__tests__/dev-server-gate.test.ts`](../../apps/desktop/sidecar/src/runtime/__tests__/dev-server-gate.test.ts).

Ô "plan ⇒ chặn" là **phòng thủ theo tầng**, không phải một hành vi mới người dùng sẽ gặp: tool này vốn không được nạp trong plan mode (`filter.backgroundExec`). Nó ở đó để nếu điều kiện cấp phát có nới ra sau này, `stop` không âm thầm trở thành thứ chạy được lúc đang lập kế hoạch.

Luật quyền viết cho tool này là luật **trần** (`dev_server`), không có chủ thể — nên "Always allow" ở prompt của `stop` cấp quyền cho mọi lần `stop` sau đó, giống hệt `browser_tool`.

### Đề xuất (CHƯA làm)

Cần tech-lead chốt trước khi ai đó code:

1. **Cho `start` spawn thẳng** (thêm `start` vào nhóm gated + một nhánh trong `suggestRuleText` để "always allow" ghi ra luật `dev_server(web)` chứ không phải tên tool trần). Rẻ về code, nhưng nó đảo lại đúng quyết định "khai ≠ chạy" ở trên — phải audit chung với đường SSH/browser trước.
2. **Cổng trust riêng cho file cấu hình** (khuôn hook trust của [ADR 0032](../decisions/0032-hook-execution-engine-ipc-contract.md)): người dùng duyệt *nội dung file* một lần theo băm, đổi file ⇒ hỏi lại. Mạnh hơn nhưng thêm một khái niệm và một UI.

## Ánh xạ tên → tiến trình: marker, không phải registry thứ hai

Chuỗi lệnh luôn mang biến đánh dấu `AWOG_DEV_SERVER=<name>`. Vì `sessions/bg-registry.ts` đã lưu **nguyên văn `command`** vào `meta.json` của mỗi background shell, việc tra "server `web` đang chạy ở shell nào" chỉ là quét `listBackground(sessionId)` tìm marker. Hệ quả:

- **Không có file state thứ hai** để lệch pha với sự thật — không có registry thứ hai như yêu cầu.
- Bật bằng RPC hay bằng `Bash` đều tra ra như nhau, vì cùng một chuỗi lệnh.
- Marker khớp **đúng** tên: `AWOG_DEV_SERVER=web ` không dính `AWOG_DEV_SERVER=website `.

Trạng thái được suy từ bg-registry: `running` · `exited` (kèm exit code) · `unknown` (mồ côi: pid chết mà không có file exit) · `stopped` (chưa từng chạy trong phiên này).

## Vòng đời

**Qua lượt chat.** Tiến trình chạy **detached** (bg-registry, ADR 0066), không dính abort signal của lượt, không dính trần 600s của `Bash` foreground. Đóng lượt, gửi tin nhắn mới, model đổi ý — server vẫn chạy.

**Qua restart sidecar: GẮN LẠI ĐƯỢC.** Không cần cơ chế reattach riêng — nó restart-safe *by construction*:

- Tiến trình detach nên nó không chết theo sidecar.
- `meta.json` + file `log` + file `exit` nằm trên đĩa trong `~/.awog/sessions/<sid>/bg/<shellId>/`.
- Lúc boot, `reloadBackgroundShells()` quét lại và nhận lại mọi shell còn sống (pid còn sống, chưa có file exit).
- Marker nằm trong `command` đã persist ⇒ tra theo tên vẫn ra, log vẫn ở chỗ cũ.

**Mồ côi.** Máy tắt đột ngột / tiến trình bị giết ngoài app ⇒ pid chết mà không có file exit ⇒ bg-registry chốt `exited-unknown`, ở đây hiện là **`unknown`**. Nó **không** được coi là đang chạy, nên `start` cho khởi động lại bình thường. Thư mục shell đã kết thúc được bg-registry quét dọn theo TTL 24h.

**Phạm vi phiên.** Background shell thuộc về **một phiên** (`~/.awog/sessions/<sid>/bg`), nên server bật ở phiên A **không** thấy được từ phiên B. Đó là ranh giới sẵn có của ADR 0066, không phải thứ tính năng này tự đặt thêm — nhưng nó là giới hạn đã biết (xem cuối trang).

**Trần đồng thời.** bg-registry cho tối đa 4 background shell *đang chạy* mỗi phiên. Dev server ăn vào hạn mức đó.

## Đọc log

`devserver.logs` / `dev_server({ action: 'logs' })` lấy đuôi log rồi lọc, **cộng dồn theo thứ tự**:

1. `level`: `'error'` giữ dòng trông như lỗi (`error`, `ERR!`, `ELIFECYCLE`, `EADDRINUSE`, `exception`, `traceback`…), `'warn'` giữ cả cảnh báo, `'all'` (mặc định) giữ hết.
2. `contains`: **chuỗi con**, không phân biệt hoa thường. **Không nhận regex** — một regex do model cấp chạy trên 64KB log mỗi lần gọi là bề mặt catastrophic-backtracking không cần thiết (cùng lập luận với tool `monitor`).
3. `lines`: N dòng khớp cuối cùng (mặc định 80, tối đa 400), cộng trần 16.000 ký tự.

Trả về kèm `matched` / `total` để người đọc biết "3/1240 dòng khớp" thay vì đoán, và cờ `clipped` / `truncated` (log đã vượt trần 64KB của bg-registry nên mất phần đầu). Escape ANSI bị tước; thanh tiến trình ghi đè bằng `\r` chỉ giữ lần ghi cuối.

**Khử bí mật + hàng rào nonce — chỉ ở đường của model.** Log server là L1 (URL có token, biến môi trường in ra, dump header). Ở tool `dev_server`, thân log đi qua `redactString()` ([sessions/redact.ts](../../apps/desktop/sidecar/src/sessions/redact.ts)) trước khi tới nhà cung cấp model, và được bọc trong hàng rào `<dev-server-log-<nonce>>` với nonce ngẫu nhiên **mới mỗi lần gọi** — tiến trình sinh log không đoán được nonce nên không tự đóng hàng rào để viết "chỉ thị hệ thống" ra ngoài (khuôn [read-terminal-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/read-terminal-tool.ts)). RPC `devserver.logs` **không** khử: người nhận là chính người dùng trên máy của họ, y như `sessions.backgroundRead`.

Đọc log **không** retire chip nền (`markRead: false`): xem tiến độ của một server đang chạy không phải là "đã nhận kết quả" của một lệnh nền.

## Hợp đồng

### RPC

| Method | Params | Trả về |
|---|---|---|
| `devserver.list` | `projectId`, `sessionId` | `{ configPath, missing, problems[], servers[] }` |
| `devserver.start` | `projectId`, `sessionId`, `name`, `confirmCommand?` | `{ outcome: 'started' \| 'already-running', server }` |
| `devserver.stop` | `projectId`, `sessionId`, `name` | `{ server }` |
| `devserver.logs` | `projectId`, `sessionId`, `name`, `lines?`, `contains?`, `level?` | `{ server, log: { text, matched, total, filtered, clipped }, truncated }` |

`server` = `{ name, description?, port?, command, cwd, status, shellId?, startedAt?, exitCode }`.

### Tool `dev_server` (nhánh Pi)

`action`: `list` · `start` · `logs` · `stop`; kèm `name`, `lines`, `contains`, `level`.

Chỉ được nạp khi `filter.backgroundExec` có mặt — tức **phiên chat, không phải plan mode**, không phải task/subagent — cùng điều kiện với `BashOutput` / `KillShell` / `monitor`, vì nó nói về đúng những background shell đó.

Nhánh **Claude SDK** (provider `anthropic`, [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md)) bắc cùng tool này qua một in-process MCP server tên `awogdev` ⇒ `mcp__awogdev__dev_server` (`runtime/claude-sdk/dev-server-sdk-server.ts`). Handler là **đúng** hàm `runDevServer`, không phải bản chép, và điều kiện cấp phát giữ nguyên `filter.backgroundExec`.

## Giới hạn đã biết / chưa làm

- **Chưa có UI.** RPC đã sẵn sàng cho một khung "Dev servers" trong Workspace Panel; nút Start phải hiện `command` và gửi lại nó qua `confirmCommand`.
- **Server không xuyên phiên** (ranh giới ADR 0066). Muốn xuyên phiên thì phải cho background shell một tầng lưu trữ theo *project* thay vì theo *session* — đó là một quyết định kiến trúc riêng.
- **`start` của model không tự spawn.** Model có thể bỏ qua lời nhắc và tự gõ một lệnh khác qua `Bash`; khi đó AWOG không tra được nó theo tên (thiếu marker). Đây là đánh đổi có chủ ý: thà mất khả năng tra ngược còn hơn mở một bề mặt spawn không qua cổng quyền.
- **Không dò cổng thật.** `port` là thứ file khai, không phải thứ AWOG đo. Muốn biết server lên chưa thì `monitor` trên `shellId` với `until_output_contains`.
