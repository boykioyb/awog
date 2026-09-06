# 0071 — Lõi prompt cấp senior: orientation, quy trình, dẫn chứng

- **Trạng thái:** Accepted (2026-08-19)
- **Ngày:** 2026-08-19
- **Người quyết định:** Tech Lead (theo yêu cầu user)

## Bối cảnh

User báo cáo agent AWOG trả lời "như junior so với senior" khi đặt cạnh Codex và Claude Code. Đo lại thì cảm nhận đó **đúng và định lượng được**.

### Nhánh Pi nhận đúng MỘT câu system prompt

Dưới OAuth, `pi-ai` bơm cứng một câu identity rồi nối thẳng `context.systemPrompt` của AWOG vào sau — không có phần thân hành vi nào:

```js
// node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:736-751
if (isOAuthToken) {
  params.system = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }]
  if (context.systemPrompt) params.system.push({ type: 'text', text: sanitizeSurrogates(context.systemPrompt) })
}
```

Và [context-builder.ts:164-172](../../apps/desktop/sidecar/src/runtime/context-builder.ts) xác nhận: agent không có `systemPrompt` riêng thì `context.systemPrompt` **chính là** chuỗi append nudge của AWOG, không có preset nào khác.

Trong khi đó nhánh Claude SDK dùng `systemPrompt: { type: 'preset', preset: 'claude_code' }` ([claude-sdk/run-stream.ts:490](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts)) — tức toàn bộ system prompt thật của Claude Code. Cùng một app, hai runtime, chênh gần một bậc độ lớn về lượng hướng dẫn hành vi. Đây là lý do chất lượng "lúc ổn lúc junior".

### Vấn đề không phải THIẾU, mà là SAI LOẠI

5 block trong [prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts) trước ADR này — `VERIFY_PROMPT`, `TOOL_DISCIPLINE_PROMPT`, `TODO_USAGE_PROMPT`, `BACKGROUND_EXEC_PROMPT`, `fileRefPrompt` — tổng ~1 069 token và **cả 5 đều là lệnh cấm**: đừng bịa, đừng kể thay vì làm, đừng tick todo khống, đừng đoán exit code.

Đó là chân dung junior: bị dặn "đừng nói dối, đừng bỏ bước" nhưng chưa từng được dạy **cách làm việc**. Scaffolding của Claude Code / Codex là **quy trình**: điều tra trước khi sửa → bắt convention của codebase → verify bằng chính công cụ của repo → báo cáo gọn và trung thực.

### Ba lỗ hổng cấu trúc

1. **Không có env block.** Không chỗ nào trong `runtime/` hay `sessions/` bơm OS, ngày, cwd, branch hay git status. Model phải đoán: flag `find` kiểu Linux trên macOS, hỏi lại thứ `git status` đã trả lời, sửa lên trên công việc chưa commit mà nó không thấy.

2. **`@import` trong CLAUDE.md không được expand.** [sessions.send-message.ts](../../apps/desktop/sidecar/src/methods/sessions.send-message.ts) đọc `CLAUDE.md` + `AGENTS.md` ở project root, nhưng không có code nào resolve `@path`. CLAUDE.md của chính repo này khai 6 dòng `@.claude/rules/*.md`; model nhận đúng **chuỗi text** `@.claude/rules/principles.md` chứ không phải nội dung → toàn bộ rule KISS/YAGNI, TypeScript strict, nuxt-vue, 8 security invariant đều vô hình. `~/.claude/CLAUDE.md` global cũng không được đọc.

3. **Tool description là one-liner.** Description của tool là *một nửa* prompt hành vi, và AWOG chỉ mô tả tool *làm gì*, không nêu *chính sách dùng*: `Read` = "Read a file from the workspace…", `Write` = "Create or overwrite a file with the given content.", `Bash` = "Run a shell command in the workspace directory…". Không chỗ nào nói "Read trước khi Edit", "mỗi Bash là shell mới nên `cd` không giữ", "Grep là POSIX ERE nên `\d` không chạy", "Glob tôn trọng .gitignore".

## Quyết định

Bù đúng nửa còn thiếu — **quy trình + orientation + dẫn chứng** — và bù theo từng runtime tuỳ vào phần nó đã có sẵn.

### 1. Ba block prompt mới ([prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts))

| Block | Nội dung | Áp dụng |
|---|---|---|
| `EVIDENCE_PROMPT` | Mọi claim về codebase phải neo `file:line` đã thật sự đọc; giữ ranh giới observed / inferred hiện rõ; hiệu chỉnh độ tự tin theo bằng chứng | **Cả 2 runtime** |
| `ENGINEERING_PROMPT` | Điều tra trước khi sửa → bắt convention codebase (kiểm dep tồn tại trước khi import) → sửa root cause (không tắt lint / nuốt lỗi) → verify bằng typecheck/lint/test của repo → giữ scope → batch tool call | Pi |
| `COMMUNICATION_PROMPT` | Mở bằng kết luận, không preamble/postamble; dense không dài; ref code dạng `path:line`; khách quan chuyên nghiệp (không tán dương, không gập khi bị push back); báo outcome đúng như nó là | Pi |

`ENGINEERING`/`COMMUNICATION` **không** đắp lên nhánh Claude SDK: preset `claude_code` đã có phần tương đương, thêm bản thứ hai chỉ tốn token và rủi ro tự mâu thuẫn. Nhưng `EVIDENCE_PROMPT` thì đắp cả hai — preset không bắt buộc trích dẫn `file:line`, và `VERIFY_PROMPT` của AWOG trước đó **hoàn toàn vắng** trên nhánh SDK.

### 1b. Calibrate theo hai prompt tham chiếu

Ba block trên được đối chiếu với **hai** nguồn: [system prompt Claude do Anthropic công bố](https://platform.claude.com/docs/en/release-notes/system-prompts) và [system prompt Codex CLI](https://gist.github.com/chigkim/ffed11a3e017d98698707dd24e78af51) — chính hai thứ user lấy làm mốc so sánh.

**Từ prompt Claude:** bắt được **một chỗ bản nháp đầu viết ngược hướng**, cộng bốn thứ thiếu:

| Hạng mục | Bản nháp đầu | Sau khi calibrate (theo prompt thật) |
|---|---|---|
| **Formatting** | *"Prefer a short table or a tight list over a paragraph"* | **Prose-first, formatting tối thiểu.** Prompt thật: *"avoids over-formatting with bold emphasis, headers, lists… using the minimum formatting needed for clarity"*; dùng list chỉ khi (a) user yêu cầu, hoặc (b) nội dung thật sự nhiều mặt. Over-format một câu trả lời ngắn làm **khó đọc hơn**, không dễ hơn |
| Credibility modifier | — | Cấm "genuinely" / "honestly" / "actually" / "straightforward" — *"Claude is honest by default… which come off as disingenuous"* |
| Tự giải thích bằng instruction | — | Không viện dẫn system prompt của chính mình: *"they replace Claude's actual reasoning with an appeal to hidden rules"* mà user không đọc được |
| Warmth ↔ objectivity | Chỉ có objectivity | Ghép cả hai: *"warm tone… still willing to push back and be honest, but does so constructively"* — objectivity trơ không kèm warmth đọc ra lạnh/gắt |
| Nhận lỗi | — | *"accountability without self-abasement"* — nói lỗi 1 câu, sửa, quay lại việc; không xin lỗi lặp, không tự chỉ trích, không càng lúc càng khuất phục khi bị ép |

**Từ prompt Codex CLI** — Codex tách rõ hai thứ mà cả prompt Claude lẫn bản của tôi đều gộp hoặc bỏ:

| Hạng mục | Bổ sung |
|---|---|
| **Giao tiếp giữa lượt vs. tin nhắn cuối** | Codex có hẳn mục *Preamble messages* + *Sharing progress updates* riêng với *Presenting your work and final message*. Bản của tôi chỉ nói về tin nhắn cuối, và câu "đừng mở đầu bằng thông báo sắp làm gì" **vô tình cấm luôn** phần preamble giữa lượt. `COMMUNICATION_PROMPT` giờ chia hai mục `WHILE YOU WORK` / `THE FINAL MESSAGE`: giữa lượt được nói 1 câu trước cụm tool call đầu tiên và lên tiếng khi có phát hiện / đổi hướng / bị chặn; tin nhắn cuối vẫn mở bằng kết luận |
| **Mốc độ dài cụ thể** | *"Brevity is very important as a default. You should be very concise (i.e. no more than 10 lines)"* + *"read naturally, like an update from a concise teammate"*. "Be dense, not long" không có mốc nên vô nghĩa với model; giờ có mốc + framing đồng đội |
| **Ambition vs. precision** | Mục riêng của Codex, bản của tôi chỉ có "giữ scope". Giờ có `CALIBRATE AMBITION TO THE GROUND`: code mới self-contained thì chủ động làm cho tới; code có sẵn thì mổ chính xác — thay đổi nhỏ nhất, đúng idiom, chạm ít dòng nhất, không rename/reformat ngoài yêu cầu |
| **Verify từ hẹp ra rộng** | *"start as specific as possible to the code you changed"*. Bản của tôi chỉ nói "chạy check của project". Giờ: chạy check gần chỗ vừa sửa nhất trước, pass rồi mới mở ra full suite — *một lần chạy rộng mà fail cho ít thông tin hơn một lần chạy hẹp mà fail* |
| **Lịch sử là bằng chứng** | *"Use git log and git blame to search the history of the codebase if additional context is required"*. Thêm vào `INVESTIGATE FIRST` — AWOG sẵn có git tooling nên chỉ thiếu chỗ nói cho model biết |
| **Literal trong backtick** | Bọc command / path / env var / identifier trong backtick để đọc ra literal thay vì văn xuôi |

#### Hai chỗ cố ý KHÔNG copy

1. **Định dạng file reference.** Codex chấp nhận *"absolute, workspace-relative, a/ or b/ diff prefixes, or bare filename/suffix"*. AWOG **không** được nới như vậy: [prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts) `fileRefPrompt` yêu cầu **full absolute path** vì UI chỉ resolve được link preview click-được khi neo ở workspace root. Nới theo Codex sẽ làm chết tính năng đó. Giữ luật AWOG.
2. **`—` làm bullet marker.** Codex quy định bullet mở đầu bằng `—`. AWOG render markdown chuẩn trong transcript; đổi marker chỉ gây lệch với renderer. Bỏ.

Thêm vào `EVIDENCE_PROMPT` cùng dịp: đọc source/types/manifest của dependency đã cài trong workspace thay vì trả lời theo ký ức về API của nó — *ký ức về một thư viện là phỏng đoán về một phiên bản, còn bản thật nằm trên đĩa*. Đây là biến thể coding-agent của pattern knowledge-cutoff trong prompt thật (*"If not certain something it recalls is true and on-point, it says so"*).

### 2. Orientation tách 2 nửa theo prompt-cache ([context/environment.ts](../../apps/desktop/sidecar/src/context/environment.ts))

- `<environment>` — OS/release/arch, shell, cwd, repo root. **Ổn định suốt session** → nằm trong system prompt, được cache.
- `<current_state>` — ngày, branch (hoặc cảnh báo detached HEAD), ahead/behind, working tree dirty + danh sách path (cap 30), 5 commit gần nhất. **Đổi liên tục** → cưỡi **turn prompt**.

Việc tách là bắt buộc, không phải trang trí: `pi-ai` mark toàn bộ system prompt là **một** cache block, nên nhét text volatile vào đó sẽ đổi cached prefix gần như mỗi turn và bắt ghi lại cache cho **toàn bộ** context của session. Cả hai nửa build từ **một** lần `collectWorkspaceSnapshot`, 4 lệnh git read chạy song song, timeout 5s, best-effort (không repo / git lỗi → snapshot rỗng, không bao giờ làm fail turn).

Task node và subagent là one-shot, không có cached prefix cần bảo vệ → dùng `buildOneShotContextBlock` gộp cả hai nửa vào system prompt.

Trên nhánh Claude SDK, `<current_state>` vẫn được gửi mỗi turn: preset CLI có env block riêng nhưng nó chốt lúc **tạo** session, nên qua `resume` snapshot đó cũ đi y như frozen append.

### 3. `@import` expansion + memory file global ([context/memory-files.ts](../../apps/desktop/sidecar/src/context/memory-files.ts))

Expand đệ quy `@path.md` trong CLAUDE.md/AGENTS.md, cộng thêm `~/.claude/CLAUDE.md`.

- **Pattern nghiêm ngặt:** chỉ expand dòng *toàn bộ là* import (`^\s*(?:[-*]\s+)?@(\S+\.md)\s*$`) và bỏ qua trong fenced code block. Hai lớp này là thứ giữ `@nuxt/eslint`, `@types/node`, npm scope và email khỏi bị đọc thành đường dẫn file.
- **Security (invariant #2):** đường dẫn import là input L1 từ file workspace → giới hạn trong allowlist **hai root**: workspace root + `claudeHome()`. Check resolve + prefix + realpath chống symlink escape; ngoài allowlist thì refuse + log, giữ nguyên dòng gốc.
- **Chặn phình / vòng lặp:** depth ≤ 5, `visited` theo realpath, cap 64k char/file *sau* expand.
- **Cắt phải NÓI RA (SỬA 2026-09-06):** trước đây file vượt cap bị `slice(0, 64k)` **im lặng** giữa câu. Model đọc phần cắt như một file instruction hoàn chỉnh ⇒ mọi thứ nằm sau vết cắt không chỉ *vắng mặt*, mà **vắng mặt vô hình**. Gặp thật: một project có `CLAUDE.md` 186k char, trong đó 165k là section "Critical Files & Directories" (index file/thư mục) — 9/15 section H2 phía sau (Security, Coding Standards, Testing, Troubleshooting…) **chưa bao giờ tới model**, trong khi team vẫn tin là có. Nay phần cắt được nối thêm marker `[TRUNCATED: …]` nói rõ tổng số char, phần đã hiện và rằng phần dưới **thiếu**, kèm `log.warn` để chẩn đoán được. Cap giữ nguyên 64k: hạ cap là âm thầm bỏ instruction, còn cách sửa đúng nằm ở phía repo (tách index ra file tham chiếu thường, **không** dùng `@import` vì import bị expand ngược vào).
- Nội dung inline được bọc `<imported-file path="…">` để giữ provenance — model trích dẫn được đúng file rule nó đọc, phục vụ luôn `EVIDENCE_PROMPT`.

### 4. Tool description viết lại theo behaviour thật

`Read`/`Write`/`Edit`/`MultiEdit`/`Grep`/`Glob` ([fs-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/fs-tools.ts)) + `Bash` ([bash-tool.ts](../../apps/desktop/sidecar/src/runtime/tools/bash-tool.ts)) chuyển từ một câu "làm gì" sang chính sách dùng, mọi con số đọc từ hằng số thật trong code (không hardcode lại):

- `Read` — format `cat -n` để trích dẫn `path:line`; dùng `offset`/`limit`; **Read trước khi Edit**; **đừng** re-read để kiểm tra write đã landed.
- `Write` — ghi đè **cả** file; muốn sửa một phần thì dùng Edit.
- `Edit`/`MultiEdit` — match byte-for-byte, strip line-prefix của Read; MultiEdit atomic (một edit fail → không ghi gì).
- `Grep` — **POSIX ERE, không PCRE** (`\d`/lookahead không chạy); mặc định loại node_modules/dist/build/…, truyền `glob` sẽ **thay thế** các exclude đó.
- `Glob` — **cần git repo**; tôn trọng .gitignore nên path bị ignore không xuất hiện (đúng behaviour, không phải file mất).
- `Bash` — mỗi call là **shell mới** nên `cd`/env không giữ; là `sh` không đảm bảo bash (tránh `[[ ]]`); cap output 64KB; ưu tiên tool chuyên dụng.

## Phương án đã cân nhắc

- **Copy nguyên system prompt của Claude Code vào nhánh Pi** — từ chối: nó mô tả tool surface của CLI (khác AWOG), và sẽ mâu thuẫn với preset khi nhánh SDK chạy.
- **Nhét cả env block (kèm git status) vào system prompt cho gọn** — từ chối: mất prompt cache của toàn session mỗi lần cây thay đổi, đây là chi phí tiền thật.
- **Cache `<environment>` per-session bằng Map** — từ chối: cần TTL/prune để không leak, mà tách static/volatile đã đạt cùng mục tiêu, không state.
- **Expand `@import` cả inline, khớp mọi `@token`** — từ chối: false positive `@nuxt/eslint`/`@types/node` sẽ đọc bừa filesystem. Whole-line + bắt buộc `.md` là đánh đổi có ý thức (import inline không expand, có ghi tài liệu).
- **Đắp `ENGINEERING`/`COMMUNICATION` lên cả nhánh SDK cho "đối xứng"** — từ chối: trùng preset, tốn token, rủi ro tự mâu thuẫn. Đối xứng đúng là *đối xứng về năng lực*, không phải về số block.

## Hệ quả

- **Tích cực:** nhánh Pi tăng từ ~1 069 token toàn-lệnh-cấm lên ~3 700 token có quy trình + orientation, calibrate theo prompt Claude + Codex CLI. CLAUDE.md của repo này đi từ ~10k char (6 dòng `@` chết) lên **32 878 char với cả 6 rule file được inline** — đo bằng `loadMemoryFiles` trên repo thật. Nhánh SDK lần đầu có contract verify + evidence. Cả hai runtime hết mù OS/ngày/branch/dirty-tree.
- **Trade-off — token:** thêm ~2 630 token/turn (ENGINEERING 745 + EVIDENCE 352 + COMMUNICATION 967 + `<environment>` 44 + `<current_state>` ~520). `ENGINEERING`/`COMMUNICATION`/`EVIDENCE`/`<environment>` nằm đầu system prompt nên **cache được**, chỉ đắt ở lần ghi cache đầu session. `<current_state>` không cache được (bản chất nó phải tươi); ~520 char khi tree sạch, phình theo số file dirty tới cap 30 path.
- **Trade-off — git spawn:** 4 lệnh git read mỗi turn (~40–80ms), không đáng kể so với round-trip model, nhưng là chi phí mới trên critical path.
- **Trade-off — session SDK cũ:** `VERIFY`/`EVIDENCE` đi vào `systemPrompt.append`, mà SDK chốt append lúc tạo session và bỏ qua khi `resume`. Session tạo trước ADR này giữ hành vi cũ tới khi user mở session mới. Chấp nhận: hai block này là **hằng**, nên đổi lại đưa lên turn prompt (không cache được) đắt hơn lợi.
- **Trade-off — cap 30 path:** git liệt kê changed file trước untracked, nên trên cây rất bẩn (repo này: 45 modified + 3 untracked) untracked có thể bị đẩy hết vào phần `+N không liệt kê`. Model vẫn biết tree dirty và biết còn N path chưa liệt. Quota riêng cho từng bucket = phức tạp thêm cho lợi ích cận biên (YAGNI).

### Giới hạn upstream đã xác minh

`<current_state>` cưỡi **user turn**, không phải message role `system`. Docs Anthropic chỉ ra role `system` giữa hội thoại (`{"role":"system"}` trong `messages[]`) là kênh operator **an toàn hơn với prompt-injection** và giữ được cache — nhưng union `Message` của `pi-ai` chỉ có `user` / `assistant` / `toolResult`, không có `system`, và `context-builder.ts` cũng skip message role system. Nên cách hiện tại đúng là **fallback mà docs khuyến nghị** cho path không hỗ trợ role đó, không phải lựa chọn kém. Nâng lên kênh `system` cần pi-ai hỗ trợ trước.

### Phát hiện chưa gộp vào (ngoài scope yêu cầu)

**Phạm vi AGENTS.md.** Codex quy định *"the scope of an AGENTS.md file is the entire directory tree"* — nó đọc AGENTS.md ở **mọi cấp**, file gần nhất thắng cho cây con đó. [memory-files.ts](../../apps/desktop/sidecar/src/context/memory-files.ts) hiện chỉ đọc CLAUDE.md/AGENTS.md ở **project root**. AWOG là monorepo, convention của `apps/desktop/ui-next/` khác `apps/desktop/sidecar/` — nên AGENTS.md lồng trong package con sẽ vô hình. Chưa làm vì nằm ngoài yêu cầu "tham khảo prompt"; cách rẻ nhất là bound theo `extractTurnPaths` (hạ tầng đã có, đang dùng cho rules) thay vì quét cả cây.

### Việc cần làm tiếp

- **infosec audit** `context/memory-files.ts` — surface đọc file mới, và là lần đầu AWOG đọc file **ngoài** workspace root theo chủ đích (`claudeHome()`).
- Kiểm tra CLAUDE.md có bị bơm **hai lần** trên nhánh SDK không: CLI tự đọc CLAUDE.md theo cwd, còn `buildBulkLoad` cũng bơm `<project_context_files>`.
- Test runtime thật cả hai nhánh (typecheck + build + unit-verify `loadMemoryFiles`/`collectWorkspaceSnapshot` đã pass; chưa chạy turn thật có credential).
- Cân nhắc surface `<current_state>` trong panel usage của UI để user thấy phần orientation chiếm bao nhiêu context.

## Tham chiếu

- [ADR 0029](./0029-migrate-llm-runtime-to-pi-sdk.md) — chuyển sang Pi SDK, nguồn gốc của việc mất scaffolding preset
- [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) — dual runtime, nguồn gốc của bất đối xứng preset vs Pi
- [ADR 0033](./0033-rules-system-prompt-injection.md) — rules AWOG-native, bổ trợ (không thay) memory file
- [ADR 0046](./0046-session-response-styles.md) — response style; `COMMUNICATION_PROMPT` đặt **trước** style để voice do user chọn vẫn thắng về giọng
- [ADR 0070](./0070-share-claude-home-for-config.md) — `.claude` dùng chung, lý do `claudeHome()` là root hợp lệ thứ hai
- [.claude/rules/principles.md](../../.claude/rules/principles.md) — `ENGINEERING_PROMPT` cố ý phản chiếu (root cause, KISS/YAGNI)
- [Anthropic — Claude system prompts](https://platform.claude.com/docs/en/release-notes/system-prompts) — nguồn calibrate cho `COMMUNICATION_PROMPT` (xem mục 1b)
- [Codex CLI system prompt](https://gist.github.com/chigkim/ffed11a3e017d98698707dd24e78af51) — nguồn calibrate thứ hai (preamble/final-message, ambition vs precision, verify hẹp→rộng)
