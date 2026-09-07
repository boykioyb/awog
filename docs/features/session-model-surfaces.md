# Bề mặt do model chủ động đưa ra trong transcript

Năm thứ model **tự đưa cho người dùng** thay vì mô tả bằng văn xuôi: **chương** (#24), **card file** (#26), **chip việc ngoài phạm vi** (#27), **gợi ý câu tiếp** (#34), **findings có cấu trúc** (#8). Cả năm dùng chung một seam nên làm chung một gói.

Liên quan: [ADR 0029](../decisions/0029-migrate-llm-runtime-to-pi-sdk.md) (AgentTool của Pi), [ADR 0058](../decisions/0058-claude-agent-sdk-vs-pi-runtime-revisit.md) (dual runtime), [ADR 0071](../decisions/0071-senior-engineer-prompt-core.md) (chính sách nằm trong mô tả tool), [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) + [ADR 0075](../decisions/0075-transcript-surface-scoping.md) (hợp đồng nhảy tới message), [ADR 0055](../decisions/0055-session-task-link.md) (việc sinh ra từ chat).

## 1. Seam chung

Không có kênh IPC mới, không có store mới, không có RPC mới. Cả năm tool trả về một payload surface trên `details`; [step-mapper.ts](../../apps/desktop/sidecar/src/sessions/step-mapper.ts) biến nó thành **một step `kind: 'surface'`** — đi đúng đường mà mọi step khác đã đi:

```
tool call → AgentToolResult.details.surface
          → step-mapper (stepFromToolUse / stepFromToolResult)
          → SessionStep { kind:'surface', surface }
          → session.step event  +  JSONL (steps[] / parts[])
          → stores/sessions.ts surfaceToBlock() → AssistantBlock
          → SessionMessageItem → component card
```

Hệ quả trực tiếp: **chương và card persist như một phần của transcript** (yêu cầu của #24), reload/fork/popout đều tự có, và không cần đụng `runtime/event-adapter.ts`.

Step được emit ở **cả hai mép** của lời gọi:

| Mép | Nguồn payload | Vì sao |
|---|---|---|
| `tool_execution_start` | tham số của lời gọi | card hiện ngay, không thấy cảnh "row tool" nhấp nháy rồi biến thành card |
| `tool_execution_end` | `details.surface` (đã validate) — nhánh Claude SDK không có `details`, dùng handoff ở §4 | với `send_user_file` đây mới là danh sách file **thật sự tồn tại trong workspace** |

Cùng `step.id` ⇒ UI upsert một block. Lời gọi **bị từ chối** (`details.isError`, xem §3) **không** phải surface: nó rơi xuống đường tool row thông thường và render thành error — một guard chặn êm là guard vô hình.

## 2. Bốn tool

Tất cả đều **chỉ có trong chat session** (Pi: gate `ToolFilter.chatSession`; Claude SDK: server chỉ nối trong `run-stream.ts`, không nối trong `invoke.ts`). Task run và subagent không có người đọc transcript, ở đó những schema này chỉ là tiền token. File: [runtime/tools/surface-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts).

| Tool | Tham số | Hiển thị |
|---|---|---|
| `mark_chapter` | `title`, `summary?` | vạch phân chương trong transcript + một mục trong menu chương |
| `send_user_file` | `files: string[]`, `caption?` | card file bấm mở được |
| `suggest_task` | `title`, `prompt`, `tldr` | chip "việc ngoài phạm vi", bấm là mở phiên mới |
| `suggest_followups` | `options: string[]` (2–3) | chip câu tiếp dưới câu trả lời cuối |
| `report_findings` | `findings: Finding[]`, `scope?` | danh sách findings nặng-trước, mỗi dòng mở đúng file |

### #24 — Chương + mục lục

- `SessionChapterMark.vue` vẽ vạch phân chương (đọc như `.sysdiv`: đây là **ranh giới**, không phải message).
- `SessionChapterNav.vue` là menu nổi ở góc trên transcript, **chỉ hiện khi có ≥ 2 chương** (mục lục một dòng là nhiễu, không phải điều hướng).
- Nhảy chương đi qua **đúng hạ tầng đang có**: `useSessionScroll().scrollToMessage(i)` → revealer mở render-window rồi query **trong root của surface chứa nó** (ADR 0074 §Q2 + ADR 0075). **Không** `document.querySelector`, không template ref, không tự tính scroll.
- Danh sách chương derive từ `props.messages` của transcript nên chương nằm **ngoài render-window vẫn có trong menu** — đó chính là ca dùng thật (session dài).

### #26 — Card file

- Đường path đi qua `assertInsideWorkspace(cwd, path)` (invariant #2) **cộng** một `stat` bắt buộc: path ngoài workspace, path không tồn tại, hay không phải file thường đều **không thành card** — chỉ được báo lại cho model. Card là lời hứa "bấm là mở được".
- Payload chỉ mang **path tương đối theo workspace**; cú bấm đi qua `useFilePreview().open(path)` → `usePreview()` → `PreviewModal` — đúng quy ước "mọi lần đọc file đi qua một modal preview chung". Không có viewer riêng. Lần đọc đó lại bị `assertInsideWorkspace` gác lần thứ hai ở sidecar.
- Tối đa 10 file/lời gọi.

### #27 — Chip việc ngoài phạm vi

- "Bắt đầu" = `store.create(projectId)` + `store.setDraft(id, prompt)`: **phiên mới, prompt tự chứa nằm sẵn trong ô soạn**, người dùng đọc/sửa rồi mới tiêu một lượt. Dùng lại đúng cặp mà nút "+" và starter ở màn hình trống đang dùng, không dựng luồng mới.
  - Cố ý **`setDraft` chứ không phải `seedComposer`**: `seedComposer` là một nonce mà composer đang mount lắng nghe; composer của phiên **vừa tạo** chưa mount tại thời điểm gọi, nên seed sẽ rơi vào khoảng trống.
- **Bỏ qua được và không lải nhải**, hai lớp:
  1. **Client** — nút ✕ ghi `eid` của chip vào `localStorage` (`awog.sessions.dismissedSuggestions`, giữ 200 mục gần nhất). Chip nằm trong transcript **trên đĩa**, nên cờ chỉ trong component sẽ sống lại sau mỗi lần reload và trông y như model nhắc lại. Chỉ *việc bỏ qua* là state client; bản thân gợi ý vẫn nằm trong transcript.
  2. **Model** — ledger per-session từ chối trùng tiêu đề (§3), và kết quả tool nói thẳng "người dùng quyết định — đừng nhắc lại".
- Bấm "Bắt đầu" cũng tính là đã xử lý ⇒ chip tự ẩn.

### #34 — Gợi ý follow-up: đánh đổi

**Chọn: model tự phát qua tool `suggest_followups`. KHÔNG gọi thêm lượt LLM, KHÔNG dẫn xuất bằng heuristic từ văn bản.**

| Phương án | Vì sao loại / chọn |
|---|---|
| Gọi thêm một lượt LLM sinh gợi ý | **Loại** — spec cấm; tốn tiền và chậm ở đúng khoảnh khắc người dùng vừa đọc xong câu trả lời. |
| Dẫn xuất từ nội dung đã có (bắt câu hỏi, bắt "next steps" trong markdown) | **Loại** — miễn phí thật, nhưng nó **bịa lời cho model**: heuristic nhặt một dòng bullet rồi trưng ra như thể model đề nghị. Sai lệch âm thầm, và với văn bản tiếng Việt/markdown lồng nhau thì chất lượng phụ thuộc regex. Cùng họ lỗi với confabulation mà repo đang đi chống. |
| **Model tự phát qua tool** | **Chọn** — 0 lượt LLM thêm (gói trong lượt đang chạy), gợi ý là lời model **thật sự nói ra** nên bấm vào có nghĩa, và cùng seam với 3 hạng mục còn lại. |

**Giá phải trả, nói thẳng:** độ phủ phụ thuộc việc model chịu gọi tool. Sẽ có lượt không có gợi ý nào. Đó là đánh đổi có chủ đích — thà không có thanh gợi ý còn hơn ba cái chip vô nghĩa, và mô tả tool nói đúng câu đó. Nếu sau này đo được độ phủ quá thấp, cần tăng bằng **prompt** (`runtime/prompts.ts`, ngoài phạm vi gói này), không phải bằng heuristic.

Vòng đời: chips **chỉ hiện ở message CUỐI** (`isLastMessage` tính ở `SessionMessageItem`) và **biến mất ngay khi người dùng gõ** (`store.active.draft` không rỗng). Bấm → `store.seedComposer(text)` (composer của phiên hiện tại đang mount, không có race) → người dùng đọc/sửa rồi gửi; không bao giờ tự gửi lượt.

### #8 — Findings có cấu trúc

Agent `code-reviewer` và skill `review-pr` trả **văn xuôi**: model biết chính xác `file:line` rồi lại gói nó vào một đoạn văn, và người dùng phải tự đọc, tự grep, tự mở. `report_findings` cắt bước đó.

**Schema một finding** (`SessionFinding` trong [surface-tools.ts](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts)):

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `file` | ✓ | path file chứa lỗi. Model gửi absolute hoặc relative; sidecar trả về **relative theo workspace** khi hợp lệ |
| `line` | | số dòng **1-based**. Bỏ khi lỗi không nằm ở một dòng cụ thể (vd thiếu hẳn một file). Số không nguyên / < 1 bị bỏ, dòng hạ xuống mức file |
| `severity` | ✓ | `blocker` \| `major` \| `minor` — **tập đóng**. Giá trị lạ ⇒ **bỏ dòng**, không ép về mặc định: xếp nhầm một "critical" thành minor là báo cáo sai, tệ hơn là mất dòng |
| `summary` | ✓ | một câu gọi tên lỗi |
| `failure` | ✓ | **ca hỏng cụ thể**: input/state nào kích hoạt và khi đó thực sự xảy ra gì. Đây mới là giá trị của dòng — "chỗ này có vẻ không an toàn" thì không phải finding |
| `verdict` | | **model đã kiểm chứng thế nào**: test đã chạy, call path đã lần, dòng đã đọc. Vắng ⇒ UI nói thẳng "model không nói đã kiểm chứng bằng cách nào" thay vì im lặng cho qua |
| `linkable` | (sidecar đặt) | `true` chỉ khi path qua được `assertInsideWorkspace` **và** `stat` ra file thường |

Cộng thêm `scope?` cấp danh sách ("PR #128", "module auth").

**Path là L1** (model sinh), nên đi đúng đường của card file: `assertInsideWorkspace` + `stat`. Một khác biệt **có chủ đích** so với `send_user_file`: path hỏng **không** làm mất finding — chỉ mất *link*. Card file là lời hứa "bấm là mở được" nên không có file thì không có card; còn finding thì **chữ mới là nội dung**, cái link chỉ là tiện. Dòng vẫn hiện, chỉ không phải link, và model được báo path nào không mở được.

**UI** ([SessionFindings.vue](../../apps/desktop/ui-next/components/session/SessionFindings.vue)): một card, sắp **nặng trước** (`blocker` → `major` → `minor`, ổn định trong cùng bậc nên thứ tự model viết được giữ), mỗi dòng = chip severity + summary + `file:line` + ca hỏng + verdict. Bấm `file:line` đi qua `useFilePreview().open(path)` → `usePreview()` → `PreviewModal`, đúng quy ước "mọi lần đọc file đi qua một modal preview chung".

> **Hạn chế đã biết — mở FILE, chưa nhảy tới DÒNG.** `PreviewRef` ([usePreview.ts](../../apps/desktop/ui-next/composables/usePreview.ts)) **không có** trường số dòng, và thêm vào thì phải sửa `usePreview` + `PreviewModal` + viewer Monaco — nằm ngoài phạm vi sở hữu file của gói này. Hiện tại số dòng vẫn **hiện trên hàng** (và copy được, `file:line` đúng dạng dán vào editor), tooltip nói rõ "chỉ mở tệp, chưa nhảy tới dòng". Muốn đóng: thêm `line?: number` vào `PreviewRef`, cho `PreviewModal` truyền xuống `MonacoEditor` rồi `revealLineInCenter` — một thay đổi riêng, không thuộc gói này.

## 3. Chống lạm dụng chương, gợi ý và findings

Vấn đề thiết kế ở đây là *tiết chế*, không phải *năng lực*: một model đánh dấu mỗi tool call một chương biến điều hướng thành nhiễu. Ba lớp, rẻ trước:

| Lớp | Cơ chế | Chương | Gợi ý việc | Findings |
|---|---|---|---|---|
| 1. Chính sách | ghi ngay trong `description` (ADR 0071): ngân sách, "đánh dấu chuyển pha, không phải mỗi bước", "không chắc thì đừng gọi" | 3–8 chương/phiên | ≤ 1/lượt, vài cái/phiên | chỉ báo cái **đã kiểm chứng**; nghi ngờ chưa truy / góp ý style **không phải** finding; gọi **một lần** sau khi review xong, không phải mỗi file |
| 2. Per-turn | biến đếm trong closure của factory — toolset **rebuild mỗi lượt** nên một `let` chính là "một lần mỗi câu trả lời" | 1 | 1 | 1 lời gọi/lượt **+ trần 8 dòng/lời gọi** |
| 3. Per-session | ledger module-level keyed theo `sessionId` (đúng khuôn `read-registry.ts`): chặn **trùng tiêu đề** (chuẩn hoá lower/space) + trần tổng | 10 | 6 | 20 dòng/phiên, chặn **trùng** theo `file:line:summary` |

Lớp 2 và 3 trả lời bằng **kết quả bình thường có `isError`** (`tool-error.ts`) chứ không throw: model đọc được lý do và tự sửa hành vi, còn hàng trong transcript hiện thành lỗi thay vì thành một chương chưa từng tồn tại. `suggest_followups` cũng bị chặn ở lớp 2 (một lần/lượt).

Riêng `report_findings`, lớp 2 **từ chối cả lời gọi** khi vượt 8 dòng thay vì cắt bớt: cắt im lặng khiến model tin nó đã báo hết, và quyết định "dòng nào đáng" là việc của người review, không phải của cái `slice()`. Lớp 3 thì ngược lại — **bỏ dòng trùng, giữ phần còn lại**, vì một dòng trùng lẫn trong danh sách mới không làm hỏng cả danh sách.

Ledger là **guard, không phải nguồn sự thật**: restart sidecar thì reset, tệ nhất là một phiên resume được đánh thêm vài chương. Bản ghi thật của "đã đánh dấu gì" là transcript đã persist.

## 4. Hai runtime, một hiện thực

Bốn tool đầu có đủ ở **cả hai nhánh**; `report_findings` hiện **chỉ có ở nhánh Pi** — xem §6. Với bốn tool đầu, khác biệt duy nhất là *đường dây*, không phải hành vi:

| | Pi (`provider !== 'anthropic'`) | Claude SDK (`provider === 'anthropic'`) |
|---|---|---|
| Cách phơi tool | `AgentTool` trực tiếp, gate `ToolFilter.chatSession` ([`runtime/tools/index.ts`](../../apps/desktop/sidecar/src/runtime/tools/index.ts)) | in-process MCP server `awogsurfaces` ([`claude-sdk/surface-sdk-server.ts`](../../apps/desktop/sidecar/src/runtime/claude-sdk/surface-sdk-server.ts)), nối trong `claude-sdk/run-stream.ts` |
| Tên tool model thấy | `mark_chapter` | `mcp__awogsurfaces__mark_chapter` |
| Schema tham số | TypeBox | zod |
| Mô tả tool (chính sách, lớp 1) | **chung** `SURFACE_TOOL_TEXT` | **chung** `SURFACE_TOOL_TEXT` |
| Thân xử lý + 3 lớp guard + `assertInsideWorkspace` + `stat` | **chung** `run*()` | **chung** `run*()` |
| Kênh trả payload đã validate | `details.surface` | *(không có)* → handoff, xem dưới |
| Render step `kind:'surface'` | chung `step-mapper` | chung `step-mapper` |

**Chỉ schema bị khai hai lần** (hai runtime nói hai thư viện schema khác nhau). Mọi thứ còn lại — ngân sách, câu từ chối, ledger per-session, validate path — là **một hiện thực** trong [`surface-tools.ts`](../../apps/desktop/sidecar/src/runtime/tools/surface-tools.ts): `runMarkChapter` / `runSendUserFile` / `runSuggestTask` / `runSuggestFollowups` / `runReportFindings`. Hai nhánh không thể trôi khác nhau vì không có bản thứ hai để trôi.

Nối ở `run-stream.ts` (chat) và **cố ý không nối ở `invoke.ts`** (task node): task không có ai đọc transcript, đúng lý do mà nhánh Pi gate bằng `chatSession`.

### Lớp 2 (một lần mỗi lượt) vẫn đúng ở nhánh SDK

`buildSurfaceToolsSdkServer()` được gọi **bên trong** `runStream`, tức mỗi lượt một lần — y hệt việc Pi dựng lại toolset mỗi lượt. Bộ đếm `SurfaceTurnCounters` do đó vẫn nghĩa là "một lần mỗi câu trả lời" trên cả hai nhánh.

### Handoff payload đã validate (chỉ nhánh SDK)

Claude SDK ép kết quả MCP xuống **text + `isError`**: `step-mapper` không nhận được `details`. Với `mark_chapter` / `suggest_task` / `suggest_followups` thì không sao (payload dựng lại được từ tham số lời gọi), nhưng `send_user_file` thì **không**: danh sách file thật là kết quả của `assertInsideWorkspace` + `stat`, không nằm trong tham số.

Cách giải: `surface-sdk-server` **gửi tạm** payload đã validate vào một map bounded trong `surface-tools.ts`, `step-mapper` **nhận** lại, tương quan bằng **tham số lời gọi** — thứ duy nhất hai đầu cùng thấy (handler MCP không biết `tool_use` id). Nói thẳng các giới hạn:

- hai lời gọi tham số y hệt gộp làm một mục — vô hại, tham số như nhau thì surface như nhau;
- key **không** scope theo session (step-mapper không có session id ở điểm đó): hai session cùng gửi một path tương đối *đồng thời* có thể tráo mục. `path`/`name` của card suy từ chính chuỗi path nên vẫn đúng; chỉ **cỡ byte** hiển thị có thể là của session kia;
- mục **không** bị tiêu huỷ khi đọc (map một lần thứ hai của cùng kết quả không được rơi xuống card rỗng), map tự đuổi mục cũ nhất;
- **trượt không phải lỗi**: `step-mapper` rơi về tham số lời gọi, và với `send_user_file` thì "danh sách file rỗng" ở mép **kết thúc** được coi là *không có surface* → hàng tool thường, chứ không phải một card file trống.

Ở nhánh Pi `details` luôn có nên nhánh handoff **không bao giờ chạy** — hành vi Pi không đổi một byte nào.

### Đặt tên: cẩn thận tiền tố `mcp_`

Anthropic **dành riêng tiền tố `mcp_`** cho tool name; một tool tự đặt tên `mcp_*` khiến lượt OAuth bị tính extra-usage rồi trả **400** (repo đã trả giá một lần với `mcp_describe`/`mcp_call`). Bốn tool ở đây tên `mark_chapter`, `send_user_file`, `suggest_task`, `suggest_followups` — **không** dính. Tiền tố `mcp__<server>__` mà SDK tự thêm là quy ước của chính API cho tool MCP, khác chuyện đó, và `awogwiki`/`awogmemory`/`awogssh` đã chạy production bằng đúng dạng này.

### `alwaysLoad: true` — chọn có chủ đích

`createSdkMcpServer({ alwaysLoad: true })` (khác mặc định của các server AWOG khác, giống lựa chọn cho MCP ngoài trong `shared.ts`). Lý do: mặc định là **defer sau tool search**, mà model **không đi tìm** mấy tool này — nó hoặc thấy `mark_chapter` đúng lúc một pha kết thúc, hoặc surface không bao giờ xảy ra. Defer = tính năng được quảng cáo nhưng không ai dùng, đúng cái hố mà cả gói này sinh ra để lấp. Giá phải trả: 4 schema nhỏ nằm trong prompt mỗi lượt — chấp nhận, và đây là 4 schema *nhỏ nhất* trong nhà.

### Bẫy "system prompt đóng băng khi resume" — **không** dính

Claude SDK đóng băng `systemPrompt.append` tại thời điểm tạo session (và `snapshot: true` còn ghim luôn bản render), nên mọi thứ nằm ở append **không tới được** phiên đang resume. Gói này **không đặt một chữ nào** vào append:

- **lớp 1 (chính sách)** nằm trong `description` của tool, mà description đi theo **định nghĩa tool** trong tham số `tools` của từng request, không phải system prompt;
- `run-stream` dựng `allServers` và truyền `options.mcpServers` **mỗi lượt**, độc lập hoàn toàn với `args.sdkSessionId`;
- lớp 2 + lớp 3 là code chạy trong sidecar, không phải prompt.

Hệ quả (theo hướng tốt, hiếm gặp ở nhánh này): **phiên cũ tạo trước thay đổi này, khi resume, có ngay 4 tool** — không phải mở phiên mới như các tính năng đi bằng append.

## 5. Đã làm / chưa làm

**Đã:** 4 tool đầu trên **cả hai runtime** (Pi + Claude SDK, §4) + `report_findings` trên nhánh Pi (§6), 3 lớp guard dùng chung, `SessionSurface` trong `types/shared.ts`, map ở `step-mapper.ts` (nhận cả tên trần lẫn tên bridge), fold ở `stores/sessions.ts`, 6 component (`SessionChapterMark`, `SessionChapterNav`, `SessionSharedFiles`, `SessionTaskSuggestion`, `SessionFollowupSuggestions`, `SessionFindings`), i18n en+vi (`sessionsSurfaces.*`).

**Ba bề mặt hiển thị, findings phủ đủ cả ba:** transcript ([SessionMessageItem.vue](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue)), overlay fullscreen một lượt ([SessionTurnFullscreen.vue](../../apps/desktop/ui-next/components/session/SessionTurnFullscreen.vue)), export markdown/HTML ([useSessionExport.ts](../../apps/desktop/ui-next/composables/useSessionExport.ts)). Bốn surface land trước **sót đúng hai chỗ sau** ở lần đầu — không vẽ gì trong fullscreen, biến mất khỏi export — và đã được vá; findings làm đủ cả ba ngay từ đầu vì đó là bài học vừa trả giá. Ngoài app còn **Remote PWA** (`StepRow.vue`), chưa biết `kind: 'surface'` cho **bất kỳ** surface nào.

**Chưa (cố ý, ngoài phạm vi sở hữu file của gói này):**

- **Bảng Tools của session** (`SessionConfigPopover.vue`): `TOOL_GROUPS` là danh sách cứng nên 5 tool này chưa tắt/bật được từ UI. Bản thân `disabledTools` **vẫn lọc theo tên**, nên chỉ cần thêm 5 chuỗi vào một nhóm mới ("Surfaces") là xong — nhưng nhớ **cả hai dạng tên**: nhánh Pi lọc `mark_chapter`, nhánh Claude SDK truyền thẳng xuống `disallowedTools` nên phải là `mcp__awogsurfaces__mark_chapter`.
- **Remote PWA**: `StepRow.vue` chưa biết `kind:'surface'` ⇒ hiện thành hàng step chung.
- **Nhảy tới đúng DÒNG khi bấm một finding** — `usePreview` không mang số dòng; xem hộp cảnh báo ở §2 (#8) để biết đường đóng.
- `fmtSize` trong `SessionSharedFiles.vue` là **bản sao thứ ba** (đã có ở `SessionAttachmentsModal`, `SessionWorkspacePanel`) — Rule of Three: nâng lên `utils/` trong một thay đổi riêng.

## 6. Nợ kỹ thuật của `report_findings` — 2 khoản, có đường đóng

### 6.1. Nhánh Claude SDK chưa có `report_findings`

`runtime/claude-sdk/` đang bị một luồng công việc song song sửa nên gói này **không đụng vào**. Hệ quả nói thẳng: người dùng chạy provider `anthropic` **không có tool này**, model không thấy nó, và review vẫn ra văn xuôi như trước. Người dùng provider khác (nhánh Pi) có đủ.

Thân xử lý đã sẵn sàng dùng chung — `runReportFindings` không biết gì về runtime, `SURFACE_TOOL_TEXT.reportFindings` là chính sách chung, `step-mapper` nhận cả tên trần lẫn tên `mcp__awogsurfaces__*`, và `report_findings` **đã** có trong `SURFACE_TOOL_NAMES`. Bắc cầu là 3 bước cơ học, tất cả trong [`claude-sdk/surface-sdk-server.ts`](../../apps/desktop/sidecar/src/runtime/claude-sdk/surface-sdk-server.ts):

1. `import { runReportFindings } from '../tools/surface-tools.js'`;
2. thêm một `tool('report_findings', SURFACE_TOOL_TEXT.reportFindings.description, { … }, …)` với schema **zod** phản chiếu `FindingsParams` (TypeBox) — `findings: z.array(z.object({ file, line: z.number().optional(), severity: z.enum(['blocker','major','minor']), summary, failure, verdict: z.string().optional() }))` + `scope: z.string().optional()`, mỗi trường `.describe(SURFACE_TOOL_TEXT.reportFindings.<field>)`;
3. handler `async (args) => finish('report_findings', args, await runReportFindings(args, cwd, sessionId, turn))` — `finish` đã lo `rememberResolvedSurface`, và `SURFACE_KEY_FIELDS.report_findings` đã khai (`keyPart` serialise mảng object, nếu không thì mọi lời gọi trùng key).

Không phải sửa gì ở `step-mapper`, UI, i18n hay `run-stream.ts`.

### 6.2. Biến thể `findings` chưa nằm trong `SessionSurface`

`types/shared.ts` cũng thuộc luồng song song nói trên, nên `SessionFindingsSurface` tạm khai trong `surface-tools.ts` và cả gói nói bằng union rộng hơn `SurfacePayload`. Có **đúng một** chỗ ép kiểu xuống `SessionStep.surface`: `asStepSurface()` trong [`step-mapper.ts`](../../apps/desktop/sidecar/src/sessions/step-mapper.ts). Hình dạng trên dây và trong JSONL không đổi (đằng nào cũng là JSON), nên đây thuần tuý là nợ *kiểu*, không phải nợ *hành vi*.

Đóng khi `shared.ts` rảnh: chuyển `SessionFinding` + `SessionFindingsSurface` sang `shared.ts`, thêm `| SessionFindingsSurface` vào union `SessionSurface`, rồi xoá `SurfacePayload` + `asStepSurface`.
