# Phiên ↔ issue: board là sổ việc chung

> Trạng thái: **đã code** (2026-10-15). Mở rộng board của [Session Teams](session-teams.md) — board không còn chỉ là backlog của ê-kíp mà là nơi theo dõi MỌI việc của người dùng.

## 1. Vấn đề

Người dùng làm việc chủ yếu bằng phiên lẻ, ít dùng team. Việc nhiều thì không nhớ nổi phiên nào đang dở, việc nào đã tạm gác, việc nào bị chặn, việc nào đã xong. Board đã có sẵn (status, comment, issue cha-con, tool cho agent) nhưng chỉ bật cho team run, nên phiên lẻ không để lại dấu vết gì trên board.

## 2. Mô hình

**Issue là trung tâm, người thực thi chỉ là một field.** Một issue có thể do chính người dùng, một phiên lẻ, một agent hay một team làm. Ai làm thì khác, còn status, comment và recap vẫn nằm chung một chỗ.

| Field | Ý nghĩa |
| --- | --- |
| `Session.issueId` | Issue trên board của project mà phiên đang làm. Chiều ngược lại (issue → các phiên đã làm nó) suy ra bằng cách lọc phiên theo field này, không lưu trên item. Cùng khuôn với `aboutTaskId` ([ADR 0055](../decisions/0055-session-task-link.md)). |
| `Session.issueUntracked` | Người dùng đã bỏ theo dõi phiên này, nên không tự sinh issue nữa. |
| `BoardItem.assigneeSessionId` | Như cũ: ai đang cầm issue. Khi team hoặc agent nhận lại issue thì phiên cũ vẫn còn trong lịch sử, vì phiên đó vẫn giữ `issueId` của nó. |
| `BoardItem.autoDesc` | Mô tả vẫn là tin nhắn đầu do hệ thống chép vào (chưa ai sửa). Sửa mô tả thật thì cờ mất. Issue mang cờ này vẫn tính là "tự sinh còn trắng". |
| `BoardItem.originSessionId` | Phiên đã tự sinh item ở lượt đầu. Chỉ ghi lúc tạo. Là điều kiện bắt buộc để "bỏ theo dõi" được phép xoá item. |
| `BoardItem.autoTitle` | Title của issue đang đi theo title của phiên đã sinh ra nó. Người hoặc agent đổi title một lần thì cờ này mất. |
| `BoardItem.recap` | Recap gần nhất (`text`, `at`, `modelUsed`, `sessionIds`). Mỗi lần recap thì ghi đè, không đăng thành comment. |
| `BoardItem.startDate` / `dueDate` | Ngày lịch `YYYY-MM-DD` (không có giờ, nên không lệch múi giờ). Store từ chối khi start > due. |
| `BoardItem.sprint` / `milestone` | Nhãn tự do, tối đa 80 ký tự, có redact. |
| `BoardItem.issueLinks` / `prLinks` | Danh sách URL http(s), bỏ trùng, tối đa 20 mỗi loại. Đưa vào `team_item_get` và `<linked_issue>` qua `trackingSummary`. |
| status `pending` | Tạm gác có chủ đích, sẽ quay lại. Khác `blocked` (kẹt vì người hoặc việc bên ngoài) và `backlog` (chưa bắt đầu). Chuyển vào `pending` không đánh thức ai. |

## 3. Luật

### 3.1 Tự sinh issue và tự đổi status (`boards/session-issue.ts`)

Hàm `onSessionTurnStart` chạy đầu mỗi lượt do **người dùng** gửi. Các lượt sau không tính:

- lượt wake nền (`attachWake`, hoặc renderer gắn cờ `automated`);
- tin hộp thư tự giao (`autoDelivered` ⇒ `automated`);
- lượt chạy theo lịch (`schedules/runner.ts` gửi `automated`);
- lượt kênh (`comm`);
- lệnh CLI (`nativeCommand`).

Nếu tính các lượt này, một ping lúc issue đang `pending` sẽ tự lật nó về `in_progress`.

- Issue tự sinh lấy **nguyên tin nhắn đầu** làm mô tả (`autoDesc`), không gọi model. Muốn mô tả gọn hơn thì bấm "Viết bằng AI" trong modal issue: `boards.draft` kèm `itemId`, nguồn là phần đầu của tối đa 3 phiên đã làm issue. Kết quả chỉ được điền vào ô mô tả, bấm Lưu mới ghi.
- Phiên **trackable** là phiên có project, không thuộc team run (`teamRunId`/`teamId`), không có `origin: 'board'` và chưa `issueUntracked`. Phiên trackable mà chưa có issue thì tạo issue `in_progress`, với phiên là assignee. Title lấy từ title của phiên; nếu title vẫn là placeholder `New session` thì lấy dòng đầu của prompt.
- Phiên đã có issue đang ở `backlog`/`todo`/`pending`/`changes` thì chuyển sang `in_progress` và ghi một comment hệ thống "resumed in …".
- Issue đang ở `blocked`/`in_review`/`done`/`cancelled` thì **giữ nguyên**. Đó là quyết định có chủ đích; hỏi thêm một câu trong phiên không được lật nó.
- Phiên không có project thì **không tạo issue** (người dùng đã chốt ngày 2026-10-15).

Auto-title của phiên đổi tên (`sessions.upsert` update-metadata) thì gọi `syncIssueTitle`. Hàm này chỉ đổi title khi issue còn cờ `autoTitle`.

### 3.2 Không tự đánh thức phiên người dùng đang lái

Hàm `tracksIssue(session, itemId)` (`session.issueId === itemId`) là một nguồn duy nhất. Đích là phiên đang tự làm issue thì cả bốn đường sau **không** wake và **không** route model (route sẽ ghi đè `llmOverride` của người dùng):

- `boards.upsert`: đổi status hoặc kéo cột;
- `boards.comment`: comment chỉ là ghi chú sổ việc;
- tool `team_item_update`: `wakeAssignee`;
- tool `team_item_comment`: `wakeThreadPeer`.

Ví dụ nếu không chặn: fork phiên S1 thành S2 cùng issue, S2 comment, thì S1 tự chạy một lượt song song trên cùng repo.

### 3.3 Xoá

- **Xoá issue** (`boards.delete`): mọi phiên trỏ vào issue mất link và bị đánh dấu `issueUntracked`. Cascade xoá phiên giờ **chỉ** áp cho phiên do board hoặc team sinh ra (`origin: 'board'` hoặc có `teamId`). Phiên người dùng tự tạo không còn chết theo issue.
- **Issue tự sinh còn trắng** (`isBlankAutoIssue`) là issue thoả đủ: `originSessionId` đúng là phiên này; không mô tả hoặc mô tả còn `autoDesc`; không recap, không việc con; chỉ có vạch hệ thống (`from === null` và `'system'`); không ai khác cầm; không phiên nào khác trỏ vào. Điều kiện được kiểm **bên trong khoá ghi** của board (`deleteBoardItemIf`).
- **Nhả issue** (`releaseIssue`) dùng chung cho mọi đường phiên rời issue mà issue ở lại: gỡ assignee nếu đúng là phiên này. Không còn phiên nào khác làm issue thì `in_progress` lùi về `pending`. Ghi một vạch hệ thống. Nếu không nhả, `tracksIssue` không còn che phiên đó, và comment hoặc kéo cột sau này sẽ wake phiên đã rời việc.
- **Xoá phiên** (`sessions.delete`): issue tự sinh còn trắng thì xoá theo. Còn lại thì issue sống tiếp và được nhả.
- **Đổi project của phiên** (`sessions.upsert` với `projectId` mới): gỡ link và xử lý issue cũ như trường hợp xoá phiên. Lượt sau sinh issue mới trên board của project mới.
- **Bỏ theo dõi** (`sessions.setIssue {untrack:true}`): gỡ link và đặt cờ. Issue tự sinh còn trắng thì xoá, còn lại thì nhả. Fork của phiên đã bỏ theo dõi giữ nguyên cờ.
- **Gắn sang issue khác** hoặc **gỡ link**: issue cũ được nhả.
- **Theo dõi lại** (`sessions.setIssue {issueId:null, untrack:false}`): gỡ cờ. Lượt sau sẽ sinh issue mới.

### 3.4 Agent tương tác với board

- Tool `team_item_list/get/create/update/comment` giờ bật cho **mọi phiên lẻ có project**, ở chế độ "run một người" (`boardWorker`): không có lead để báo, không có bench. Hai runtime đi chung một gate (`resolveRunContext`), nên không phải sửa riêng Codex hay Claude SDK.
- Phiên lẻ người dùng tự mở (`RunContext.solo`) bị **hẹp hơn** phiên do board dispatch. Model của một phiên chat thường có thể bị prompt-inject từ web hoặc file, nên nó:
  - chỉ giao việc cho phiên **cùng project**;
  - **không** route model (`llmOverride`) của phiên khác;
  - **không** wake ai khi comment.
- `pending` không phải status "sống" trong tool: gán lại người làm không wake ai, và bench member không spawn lên item `pending`.
- Mỗi lượt, khối `<linked_issue>` (`sessions/linked-issue.ts`) đi **cùng đường với `<session_checklist>`**: trên Claude SDK là turn prompt (vì system prompt bị đóng băng), trên Pi/Codex là system/developer prompt. Thẻ bọc nội dung là hash của chính nội dung, nên issue không đổi thì khối không đổi và prefix cache không vỡ. Trên Claude SDK, khối nằm lại vĩnh viễn trong transcript CLI, nên khi hash trùng lần gửi trước thì chỉ gửi một dòng nhắc thay cho bản đầy đủ (hash nhớ trong bộ nhớ sidecar). Khối này chứa id, status, mô tả, recap và 5 comment mới nhất, cùng hợp đồng status:
  - người dùng gác việc → `pending` kèm comment đã làm gì, còn gì;
  - kẹt vì bên ngoài → `blocked` kèm lý do;
  - xong → `in_review` kèm tóm tắt.
- Agent **không** được đặt `done`/`cancelled`. Luật này giữ nguyên như board cũ; người dùng chốt ngày 2026-10-15.

### 3.5 Recap (`boards.recap`)

- Gọi model một lần (`completeWithUsage`). Thử model rẻ trước, rồi đến model "AI authoring" của Settings.
- Nguồn: mô tả, 30 comment gần nhất, checklist, và đuôi transcript (8k ký tự) của tối đa 4 phiên đã làm issue.
- Đầu ra là 4 mục: Đã làm · Đang dở · Bị chặn bởi · Bước tiếp theo.
- Ghi vào `item.recap`, không bump `updatedAt`. Nếu bump thì một issue bỏ dở vừa được recap sẽ trông như mới làm.
- Recap tự chạy nền khi người dùng chuyển issue sang `pending`/`blocked`/`done` từ chip header.

### 3.6 Tự nhận diện sprint / milestone (`boards.detectTracking`)

Nút "Tự nhận diện từ phiên chat" ở đầu sidebar issue (chỉ có với issue đã tồn tại):

1. Tìm link `github.com/<owner>/<repo>/(issues|pull)/<n>` và chấm điểm theo nguồn:
   - link đã gắn trên item, hoặc `aboutGhUrl` của phiên: 10 điểm;
   - title phiên: 4 điểm;
   - mô tả: 3 điểm;
   - tin của người dùng: 2 điểm;
   - tin của agent: 1 điểm.

   Nguồn là tối đa 5 phiên đã làm issue. Lấy tối đa 8 link có điểm cao nhất.
2. Gọi **một** lần `gh api graphql` (`github/issue-tracking.ts`), owner/repo/number truyền bằng **biến** GraphQL, không ghép vào câu query. Đọc `milestone`, các giá trị Iteration của GitHub Projects v2 (sprint), field Date và `closingIssuesReferences` của PR. PR không mang kế hoạch thì đọc thêm issue mà nó đóng.
3. Chọn nguồn chính: issue trước PR, và phải có milestone, sprint hoặc ngày.
   - Sprint: field tên Sprint/Iteration; nếu có nhiều thì lấy iteration đang chứa hôm nay.
   - Ngày bắt đầu và hạn chót: lấy theo thứ tự field Date (start/target…) → khoảng của iteration → `dueOn` của milestone.
4. **Không ghi gì.** Editor điền vào form:
   - sprint và milestone: ghi đè;
   - ngày: chỉ điền ô đang trống;
   - link: gộp thêm.

   Bấm Lưu mới ghi.

Account gh dùng là account hiệu dụng của project (project → mặc định app). Token thiếu scope `read:project` thì vẫn đọc được milestone, và UI báo cách cấp quyền (`gh auth refresh -s read:project`).

### 3.7 Shell của agent chạy `gh`/`git` bằng tài khoản ghim của project

Tài khoản GitHub ghim ở Overview của project (`Project.githubAccount`, nếu vắng thì theo `githubAccount` của app) giờ áp cả cho **shell của agent**: tool Bash, lệnh nền và Bash của CLI nhánh Claude SDK. `gh auth switch` ở terminal ngoài không còn đổi người chạy lệnh.

- Mỗi lượt, sidecar tự resolve tài khoản từ đĩa (`github/project-account.ts`), không nhận từ UI, rồi gắn vào `SessionSettings.ghAccount`.
- `runtime/tools/gh-shim.ts` sinh shim `~/.awog/gh-shims/<login>/gh` (quyền 0700) và đặt nó **đầu PATH**. Shim lấy token bằng `gh auth token --user <login>` ngay lúc chạy rồi chỉ đặt `GH_TOKEN` cho tiến trình `gh` thật. **Shell của agent không cầm token**, nên `env` không làm lộ token.
- Git HTTPS của github.com được trỏ vào shim bằng config qua env (`GIT_CONFIG_COUNT`): xoá các helper toàn cục, rồi đặt `!<shim> auth git-credential`.
- Shim không ép token cho `gh auth login/logout/switch/refresh/setup-git`, và tôn trọng `GH_TOKEN` người dùng tự đặt.

Hai cách đã thử và loại:

| Cách | Lý do loại |
| --- | --- |
| `GH_CONFIG_DIR` riêng cho từng project | `gh api` vẫn đọc token active từ ô keyring chung, chỉ `gh auth status` là đổi (đo trên gh 2.97). |
| Tiêm `GH_TOKEN` vào env của shell | Token lộ qua `env`/`printenv` vào transcript. |

Chưa áp cho:

- **Codex**: shell chạy trong daemon `codex app-server` dùng chung, env đặt lúc spawn daemon.
- Terminal tích hợp.
- Windows (shim là script `sh`).

## 4. Bề mặt UI

| Chỗ | Có gì |
| --- | --- |
| Chip issue ở đầu `SessionContextStrip` (`SessionIssueChip.vue`) | Chấm màu + status + title. Popover gồm: 7 status bấm nhanh (`pending`/`blocked` hỏi một dòng ghi chú, đăng thành comment), recap kèm nút viết lại, mở trên board, bỏ theo dõi. |
| Menu ⋯ của phiên | "Theo dõi thành issue", chỉ hiện khi phiên đã bỏ theo dõi. |
| Workbench → view **Issues** (`IssuesView.vue`) | Issue nhóm theo status: đang làm · bị chặn · tạm dừng · chờ review · cần sửa · cần làm · backlog · xong 7 ngày. Issue `in_progress` không động tới quá 3 ngày được gắn "N ngày chưa động". Phạm vi là project của tab hoặc mọi project. Bấm vào thì mở phiên gần nhất; chuột phải thì có phiên mới / recap / mở board. Badge trên view là số issue bị chặn. |
| Hàng phiên trong view Sessions | Nhãn status của issue khi không phải "đang làm" (tạm dừng / bị chặn / chờ review / xong). |
| Sidebar thuộc tính của modal issue (`WorkspaceIssueSidebar.vue`) | Khuôn GitHub: mỗi field là một section có nhãn nhỏ phía trên, giá trị hiện như chữ thường (viền chỉ hiện khi hover/focus), các section ngăn nhau bằng hairline. Field gồm: Giao cho · Loại (Epic / US / Task / Bug) · Trạng thái · Sprint · Ngày bắt đầu · Hạn chót (đỏ kèm "quá hạn N ngày") · Milestone · Thuộc về · Issue liên kết · Pull request. Sprint và milestone là nhãn tự do, gợi ý từ giá trị đã dùng trên board. Link GitHub hiện dạng `repo#123`, bấm để mở. Giai đoạn / Ưu tiên / Mức độ đã rời form; dữ liệu cũ vẫn giữ và agent vẫn đặt được. Form tạo mới dùng cùng sidebar, xếp lưới 3 cột. |
| Thẻ kanban | Hạn chót (đỏ khi quá hạn) và sprint. |
| Modal issue trên `/board` → tab Chung | Khối Recap, danh sách phiên đã làm issue, nút "Tiếp tục trong phiên mới" (`sessions.createForIssue`). |
| `/board?item=<id>&project=<pid>` | Deep link mở thẳng modal của issue. |

Nhãn và màu status lấy từ một nguồn duy nhất: `composables/useIssueStatus.ts`.

## 5. Hợp đồng RPC / event mới

- Trần `MAX_BOARD_ITEMS` (500) chỉ tính item **đang mở**, không tính `done`/`cancelled`. Số comment mỗi item **không giới hạn** (người dùng chốt 2026-10-15), mỗi comment vẫn tối đa 4000 ký tự.

- `sessions.setIssue {sessionId, issueId?: string|null, untrack?: boolean}` → `{issueId, untracked, deletedIssueId?}`
- `boards.recap {projectId, itemId, settings}` → `{recap}`
- Event `session.issue {sessionId, issueId|null, issueUntracked?}`: đứng **trước** cổng sở hữu phiên ở renderer, để cửa sổ popout cũng nhận được.
- `sessions.upsert` create nhận thêm `issueId`. Bản update-metadata **không** nhận field này.

## 6. Chưa làm

- Recap gửi đuôi transcript lên provider "AI authoring", provider này có thể khác provider của chính phiên.

- Phiên không có project chưa được theo dõi (theo quyết định ở §3.1).
- Recap tự động chỉ chạy khi status được đổi từ chip. Khi agent tự đổi status qua tool thì không recap; agent đã được yêu cầu kèm comment.
- `/board` chưa có lọc "việc của tôi" hay lọc theo người thực thi.
