# 0077 — Bề mặt hiển thị là markdown trong GUI, không phải terminal: cấm hard-wrap đoạn văn xuôi

- **Trạng thái:** Accepted (2026-08-28)
- **Ngày:** 2026-08-28
- **Người quyết định:** Tech Lead
- **Quan hệ:** amend [ADR 0071](./0071-senior-engineer-prompt-core.md) — thêm một loại block **được phép** đắp lên nhánh Claude SDK (loại "đính chính bề mặt"), và bỏ một câu trong `COMMUNICATION_PROMPT`.

## Bối cảnh

Model sinh markdown **hard-wrap đoạn văn xuôi** ở khoảng 80–100 ký tự. Đã loại trừ renderer và layout:

- [useMarkdown.ts:293](../../apps/desktop/ui-next/composables/useMarkdown.ts) — `breaks: false`, tức renderer **không** biến `\n` đơn thành `<br>`. Ngắt dòng nhìn thấy được là do model tự chèn.
- [prototype.css:324](../../apps/desktop/ui-next/assets/css/prototype.css) — `.maw{max-width:92%}`, không có cap kiểu `70ch`.

### Đo trên dữ liệu thật

Quét ~40 session gần nhất trong `~/.awog/sessions/*/session.jsonl`:

| Phạm vi | Median ký tự/dòng | p90 | Kết luận |
|---|---|---|---|
| Prose trong transcript, **ngoài** code fence | 117 | 265 | **Không** wrap |
| Prose **trong** fence ```` ```markdown ```` / ```` ```plain ```` (140 khối, 921 dòng) | 80 | 100 | **Bị** wrap |

Ví dụ thật — một đoạn văn duy nhất bị cắt làm 4 dòng (96/99/91/74 ký tự):

```
Implements company alias (別名) management and name-unification (名寄せ) search as the second of four
sub-features split from #77. Each company can now carry zero or more aliases alongside its official
name; searching by an alias in the admin screen or the ① 情報提供者 combobox resolves to exactly
one company row, guaranteeing the 1社=1UUID invariant required by ADR 0032.
```

Đây chính là các khối **paste-ready** (PR body, issue body, commit message, release note) mà user copy ra dán vào ô nhập rộng của GitHub → mép phải răng cưa, thừa mảng trắng, phải sửa tay.

### Nguyên nhân KHÔNG phải câu "legible in a terminal"

Giả thuyết đầu tiên là câu kết của `COMMUNICATION_PROMPT` — *"Keep all of it legible in a terminal."* ([prompts.ts:142](../../apps/desktop/sidecar/src/runtime/prompts.ts)). **Dữ liệu bác bỏ giả thuyết đó:** toàn bộ session đo được đều là provider `anthropic`, mà nhánh Anthropic **không hề nhận** `COMMUNICATION_PROMPT` ([claude-sdk/run-stream.ts:398-404](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) chỉ append `systemPrompt` + `systemPromptAppend` + `rulesPrompt` + `VERIFY_PROMPT` + `EVIDENCE_PROMPT`). Câu đó không có mặt khi hiện tượng xảy ra ⇒ không thể là nguyên nhân.

Nguyên nhân thật nằm ở chỗ khác, và đối lập trong bảng đo chỉ ra rất rõ: **model chỉ wrap khi nó nghĩ mình đang viết một FILE `.md`**, không phải khi đang nói chuyện. Mở fence ```` ```markdown ```` bật "chế độ soạn tài liệu nguồn", và corpus `.md` mà model học phần lớn được wrap ở 80 cột. Prose thường (median 117, p90 265) chứng minh model hoàn toàn không nhắm cột cố định khi nói.

Hệ quả cho thiết kế: một chỉ dẫn chung chung kiểu *"đừng ngắt dòng thủ công"* sẽ **trượt đúng chỗ đau**, vì model không tự phân loại nội dung trong fence là "prose". Chỉ dẫn **bắt buộc phải gọi tên** trường hợp prose-trong-fence.

### Ràng buộc đã xác minh

- 5 điểm append prompt trong sidecar: [run-stream.ts:239](../../apps/desktop/sidecar/src/runtime/run-stream.ts) (Pi chat), [invoke.ts:328](../../apps/desktop/sidecar/src/runtime/invoke.ts) (Pi task), [claude-sdk/run-stream.ts:398](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) (Anthropic chat), [claude-sdk/invoke.ts:225](../../apps/desktop/sidecar/src/runtime/claude-sdk/invoke.ts) (Anthropic task), [task-tool.ts:290](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) (subagent, Pi).
- Block dùng chung cả 2 runtime hiện **chỉ có** `VERIFY_PROMPT` và `EVIDENCE_PROMPT`. `ENGINEERING`/`COMMUNICATION` là Pi-only theo chủ trương "không chồng lấn preset `claude_code`" của [ADR 0071 §1](./0071-senior-engineer-prompt-core.md).
- `<environment>` ([context/environment.ts:183](../../apps/desktop/sidecar/src/context/environment.ts)) **không** được gửi trên nhánh Anthropic chat — nhánh đó chỉ gửi `<current_state>` trên turn prompt ([claude-sdk/run-stream.ts:467](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts)).
- 3 style `military` / `step-by-step` / `checklist` ([styles.ts:19,25,43](../../apps/desktop/sidecar/src/style/styles.ts)) cố ý tạo dòng ngắn / one-item-per-line.

## Quyết định

### 1. Thêm block dùng chung `OUTPUT_SURFACE_PROMPT`, đắp lên **cả 5** điểm append

Block mới trong [prompts.ts](../../apps/desktop/sidecar/src/runtime/prompts.ts), tag `<output-surface>`, nội dung tiếng Anh:

```
<output-surface>
Your text is rendered as markdown in a resizable GUI panel, not printed to a fixed-width terminal. The reader's client soft-wraps every line to whatever width it has, so you never need to wrap anything yourself.

Write each paragraph as ONE unbroken line, however long it runs. Never insert a newline to hit a column target (72, 80, 100 characters) or to "keep the line short": a hard-wrapped paragraph re-flows as ragged, broken text in any window that is not exactly the width you assumed, and it survives copy-paste into GitHub, Jira, or an editor as visible damage the user has to repair by hand. Separate paragraphs with a blank line, the way markdown expects.

This holds for everything you write, INCLUDING prose you put inside a fenced block for the user to copy — a PR description, an issue body, a commit message, a release note, a review comment. That is prose in a fence, not source code, and its paragraphs must be single lines too.

A newline must mean a new block, never a continued sentence. So keep every line break that carries meaning: lines of real code, command or tool output, diffs, log excerpts, ASCII art and box drawings, one list item or checklist entry per line, one table row per line, and the line structure of YAML, JSON, TOML, CSV, or any other line-oriented format. Never join those together.
</output-surface>
```

Ranh giới của block (SRP): **chỉ nói về ngắt dòng và bề mặt hiển thị.** Mọi luật định dạng khác (dùng ít markdown, mở bằng kết luận, độ dài) vẫn thuộc `COMMUNICATION_PROMPT` và ở lại nhánh Pi.

### 2. Vì sao đắp lên nhánh Claude SDK KHÔNG vi phạm ADR 0071

ADR 0071 cấm **trùng lặp** với preset. Block này không trùng — nó **đính chính** một giả định của preset:

- Preset `claude_code` là system prompt của một **CLI**. Nó nói với model rằng output hiển thị trên command-line interface. Trên AWOG điều đó **sai**: transcript là markdown render trong panel GUI co giãn được.
- Preset không có luật "một đoạn = một dòng". Nó không nói tới hard-wrap.

Nên tiêu chí mới, tường minh, để phân biệt với chủ trương cũ:

> **Trùng lặp** (cấm đắp lên nhánh SDK) = nói lại điều preset đã nói. **Đính chính** (được phép đắp) = sửa một điều preset nói *đúng cho Claude Code CLI* nhưng *sai cho AWOG*, vì AWOG có bề mặt/tool surface khác.

Đây là loại block thứ ba, bên cạnh "preset không có" (`VERIFY`/`EVIDENCE`) và "preset đã có" (`ENGINEERING`/`COMMUNICATION`).

### 3. Bỏ câu *"Keep all of it legible in a terminal."*

Xoá câu cuối [prompts.ts:142](../../apps/desktop/sidecar/src/runtime/prompts.ts), **không thay bằng gì**. Lý do:

- Nó **mâu thuẫn trực tiếp** với `<output-surface>` mới. Hai chỉ dẫn ngược nhau trong cùng system prompt là kịch bản tệ nhất.
- Nó **phát biểu sai sự thật** về bề mặt AWOG (GUI markdown, không phải terminal).
- Ý định gốc của nó — "đừng over-format" — **đã được đoạn văn ngay trước đó nói đủ** (*"use the minimum formatting the content actually needs"*, *"Over-formatting a short reply makes it harder to read"*). Xoá không mất tri thức nào.

Không kết tội nó gây ra hiện tượng đo được (xem Bối cảnh): xoá vì mâu thuẫn + sai, không phải vì là root cause.

### 4. Style: KHÔNG cần cơ chế loại trừ

`military` / `step-by-step` / `checklist` tạo **dòng ngắn theo đơn vị nội dung** (một bước / một item một dòng), không phải **wrap giữa câu**. Block mới scope đúng vào "một đoạn văn xuôi", và câu cuối liệt kê tường minh "one list item or checklist entry per line" là thứ phải giữ ⇒ hai bên không đá nhau.

Thứ tự append giữ nguyên bảo hiểm sẵn có: `OUTPUT_SURFACE_PROMPT` đặt **trước** `stylePrompt` ở nhánh Pi ([run-stream.ts:250-251](../../apps/desktop/sidecar/src/runtime/run-stream.ts)), và trên nhánh SDK style cưỡi turn prompt nên luôn đến sau system prompt. Style vẫn thắng về giọng, đúng [ADR 0046](./0046-session-response-styles.md).

### 5. Subagent CÓ nhận block này

Khác với `COMMUNICATION_PROMPT` (bị loại ở [task-tool.ts:285-288](../../apps/desktop/sidecar/src/runtime/tools/task-tool.ts) vì hợp đồng output nhắm người đọc, còn báo cáo subagent do model cha tiêu thụ), block này nhắm vào **văn bản có bị hỏng khi tái sử dụng hay không**:

- Subagent được giao viết PR body / release note là chuyện thường ([ADR 0030](./0030-subagent-task-tool.md)), và model cha thường **trích nguyên văn** kết quả — text đã wrap sẽ đi thẳng ra tin nhắn cuối.
- Nested step của subagent **có** render trong transcript qua `parentId`, tức nó cũng là bề mặt GUI.

Chi phí ~200 token mỗi lần delegate, chấp nhận được.

## Phương án đã cân nhắc

- **(B) Nhét vào `EVIDENCE_PROMPT`** (block đã dùng chung, ít điểm sửa nhất) — **từ chối:** phá SRP nặng. `<evidence>` là hợp đồng "claim phải có dẫn chứng"; nhét luật ngắt dòng vào đó khiến tên block nói dối về nội dung, và lần sau ai cần sửa luật format sẽ không tìm ra. Tiết kiệm đúng 3 dòng import.
- **(C) Sửa `COMMUNICATION_PROMPT` cho Pi + append riêng một câu ở nhánh Anthropic** — **từ chối:** tạo **hai nguồn sự thật** cho cùng một luật, ở hai file, với hai cách diễn đạt sẽ trôi xa nhau. Đúng thứ ADR 0071 tránh khi gom block vào `prompts.ts`. Ngoài ra "một câu" không đủ: phải gọi tên được ca prose-trong-fence và liệt kê ngoại lệ, nếu không sẽ trượt đúng chỗ đau hoặc làm hỏng bảng/list.
- **(D1) Đưa vào `<environment>`** (đúng chỗ về mặt khái niệm: đây là *sự thật về môi trường*) — **từ chối:** [claude-sdk/run-stream.ts:467](../../apps/desktop/sidecar/src/runtime/claude-sdk/run-stream.ts) chỉ gửi `<current_state>`, **không** gửi `<environment>` trên nhánh Anthropic chat — tức chính nhánh user dùng hằng ngày sẽ không nhận được. Wire thêm `<environment>` vào nhánh SDK là quyết định khác (ADR 0071 cố ý không làm vì preset đã có env block riêng) và blast radius lớn hơn nhiều so với vấn đề đang giải.
- **(D2) Sửa ở tầng renderer** — bỏ ngắt dòng đơn trong code fence `markdown`/`plain` khi copy — **từ chối:** dữ liệu hỏng vẫn nằm trong file `session.jsonl` và vẫn hỏng khi user bôi đen copy tay hoặc đọc qua Remote PWA; không thể phân biệt an toàn "prose bị wrap" với "text cố ý xuống dòng" ở tầng string; và vi phạm SoC (sửa triệu chứng ở UI cho một lỗi sinh ra ở prompt).
- **(D3) Không làm gì, chờ model tự tốt lên** — từ chối: đo được, lặp lại, và user phải sửa tay mỗi lần.

## Hệ quả

- **Tích cực:** khối paste-ready dán thẳng vào GitHub/Jira không còn răng cưa. Lần đầu AWOG nói cho model biết **bề mặt hiển thị thật** của nó trên cả hai runtime — trước đây model phải suy ra từ preset CLI (sai) hoặc từ câu "legible in a terminal" (cũng sai).
- **Tích cực (kiến trúc):** ADR 0071 có thêm tiêu chí phân loại rõ ràng ("trùng lặp" vs "đính chính") thay vì luật ngón tay cái "đừng đắp gì lên preset" — thứ sẽ chặn nhầm những đính chính hợp lệ trong tương lai.
- **Trade-off — token:** ~200 token/turn × 5 đường. Nằm trong system prompt append (hằng, không đổi giữa session) nên **cache được** trên cả hai runtime; chỉ đắt ở lần ghi cache đầu.
- **Trade-off — session SDK cũ:** giống hệt `VERIFY`/`EVIDENCE` ([ADR 0071 §Hệ quả](./0071-senior-engineer-prompt-core.md)) — Claude Agent SDK chốt `systemPrompt.append` lúc **tạo** session và bỏ qua khi `resume`, nên session tạo trước thay đổi này giữ hành vi cũ tới khi user mở session mới. Chấp nhận: block là hằng, đưa lên turn prompt để "sửa ngay" sẽ mất cache mãi mãi.
- **Trade-off — commit message body:** luật áp dụng **đồng nhất**, kể cả body của commit message, tức cố ý đi ngược quy ước wrap-72 của git. Có ý thức: `git` không tự wrap, GitHub soft-wrap, và [.claude/rules/git-commit.md](../../.claude/rules/git-commit.md) chỉ ràng buộc **title** ≤ 72. Một danh sách ngoại lệ theo từng loại artifact sẽ bắt model phân xử mỗi lần và rất dễ rò ngược sang PR body — luật đồng nhất rẻ hơn (KISS).
- **Rủi ro — over-correction:** model có thể nối cả những dòng đáng giữ (bảng ASCII, output lệnh dán lại). Đoạn cuối của block liệt kê tường minh để chặn; cần quan sát sau khi ship.
- **Việc cần làm tiếp:** sau khi developer ship, chạy lại phép đo trên `~/.awog/sessions/*/session.jsonl` (median/p90 ký tự/dòng trong fence `markdown`/`plain`) để xác nhận median rời khỏi mốc ~80. Nếu vẫn wrap, chỗ cần siết là **đoạn 3** (prose-trong-fence), không phải đoạn 1.

## Tham chiếu

- [ADR 0071](./0071-senior-engineer-prompt-core.md) — lõi prompt cấp senior; ADR này amend chủ trương "không chồng lấn preset" và bỏ một câu trong `COMMUNICATION_PROMPT`
- [ADR 0058](./0058-claude-agent-sdk-vs-pi-runtime-revisit.md) — dual runtime, lý do tồn tại 5 điểm append
- [ADR 0046](./0046-session-response-styles.md) — response style; block mới đặt trước style để voice user chọn vẫn thắng
- [ADR 0030](./0030-subagent-task-tool.md) — subagent, lý do subagent cũng nhận block
- [useMarkdown.ts:293](../../apps/desktop/ui-next/composables/useMarkdown.ts) — `breaks: false`, bằng chứng renderer không phải thủ phạm
