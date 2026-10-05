# Session Teams — nhóm phiên vận hành như code team

> Trạng thái: đang triển khai (MVP). ADR: `docs/decisions/0094-session-teams.md`.
> Supersede phần "điều phối" của [session-runs.md](session-runs.md); cơ chế
> hộp thư/cổng duyệt/arm của session-runs + [session-messaging.md](session-messaging.md)
> vẫn là nền và được tái dùng nguyên vẹn.

Nâng "session group" từ một cây phiên trò chuyện qua inbox thành một **code team**:

- **Phiên gốc = LEAD**: bind một agent AWOG (AGENT.md, ví dụ `tech-lead`) + có
  Operating Protocol riêng — điều phối qua board, không tự code.
- **Mỗi phiên con = MEMBER**: bind agent thật (`agent` — vai có thật, không
  còn là nhãn `teamRole`), làm việc trên **worktree/branch riêng**, tự ghi
  status lên board.
- **Việc = work-item trên BOARD THEO PROJECT** (`~/.awog/boards/<projectId>.json`)
  — sống theo project, không theo nhóm; xoá nhóm không mất backlog.
- **Trao đổi = CHANNEL của nhóm** (`~/.awog/team-runs/<rootId>/channel.jsonl`) —
  broadcast cả ê-kíp, khác hộp thư 1-1.
- **Review → merge có cổng**: member đẩy item sang `in_review`, lead/người dùng
  đọc `member_diff`, merge là hành động của NGƯỜI DÙNG qua RPC.

Tham khảo nghiệp vụ: Multica (github.com/multica-ai/multica) — issue là nơi dính
mọi thứ, status do agent ghi, `backlog` là bãi đỗ không-wake, lead re-trigger
có luật + dedup.

## 1. Mô hình dữ liệu

### 1.1 Trên Session (types/shared.ts)

| Field | Ghi bởi | Nghĩa |
|---|---|---|
| `teamRunId` | `sessions.setRunMembership`, `create_session` | (sẵn có) cha trong cây nhóm; gốc = lead |
| `teamRole` | như trên | (sẵn có) nhãn hiển thị ngắn — giữ làm chip UI |
| `teamId` | `teams.run`, spawn | id của team SPEC nguồn — lead LẪN member đều mang (member thừa hưởng qua `spawnChildSession`) |
| `teamSource` | như trên | tier của spec (`'global' \| 'project'`) — resolve spec chính xác khi cùng id tồn tại ở 2 tier |
| `teamProjectId` | như trên | project sở hữu spec khi `teamSource==='project'` |
| `origin` | `agents.run` | `'board'` = phiên lone-agent do một board item dispatch — ẩn khỏi danh sách session |
| `agent` | `sessions.setAgent`, spawn | **AgentRef {id, source?, projectId?}** — agent thật áp cho mọi lượt |
| `worktree` | sidecar (lười, lượt đầu) | **SessionWorktree {repoPath, worktreePath, branch, baseRef, createdAt}** |

`SessionSummary` mirror cả `agent` + `worktree` (+ `teamId`/`teamSource`/
`teamProjectId`/`origin`) để roster/danh sách hiện agent + branch mà không
nạp transcript.

**Phiên "của board" không hiện trong danh sách session** (`isBoardSession` —
có `teamId` HOẶC `origin==='board'`): vòng đời của chúng sống trong board
item (peek drawer + thread) và trang Teams, không phải inbox chat. Phiên
ad-hoc gom tay (chỉ `teamRunId`) và "chat với agent" từ trang Agents vẫn
hiện bình thường.

### 1.2 Board — `~/.awog/boards/<projectId>.json`

```jsonc
{ "version": 1, "items": [ BoardItem ] }
```

`BoardItem` (types/shared.ts): `id, projectId, title, desc?, assigneeSessionId?,
status, type?, parentId?, priority?, severity?, stage?, createdBy(sessionId|null=user),
createdAt, updatedAt, mergedBranch?, comments[]`.

**Khuôn Jira (type/parentId/priority/severity):**
- `type`: `epic | story | task | subtask | bug` — nhãn loại việc, vắng = `task`.
- `parentId`: item cha của cây sub-issue — đây là con đường agent TÁCH việc:
  lead nhận epic rồi `team_item_create` các mảnh với `parent_id` trỏ về cha
  thay vì đẻ item ngang hàng. Store kiểm: cha phải tồn tại, không tự trỏ về
  mình, không vòng (leo chuỗi cha). Xoá cha ⇒ con MỒ CÔI (gỡ `parentId`),
  KHÔNG chết theo — giữ việc của người khác.
- `priority`: `urgent | high | medium | low` — vắng đọc như `medium`;
  `severity`: `blocker | major | minor | trivial` — chủ yếu cho `bug`.
  Cả hai đều gỡ được bằng null (user path); `type` luôn có giá trị.
- Tool `team_item_create`/`team_item_update` nhận đủ 4 tham số trên cả hai
  runtime; `team_item_list`/`team_item_get` in type/cha/ưu tiên để agent đọc
  được cây trước khi tách.
- Board page: filter theo type + priority, toggle "Ẩn việc con" (giấu mọi item
  có cha); card hiện icon type, cờ ưu tiên, chip severity, breadcrumb cha và
  số việc con.

**Board là của PROJECT, không phải của group.** Nhiều group trong cùng project
nhìn chung một board; member kế thừa `projectId` của cha nên 1 run = 1 board.

Status: `backlog | todo | in_progress | in_review | changes | blocked | done | cancelled`

**Hợp đồng status:**
- Agent (member/lead) tự ghi qua tool `team_item_update` — TRỪ `done`/`cancelled`
  là của người dùng (tool từ chối hai giá trị đó, gợi ý `in_review` thay thế).
- Hệ thống chỉ tự sửa 2 chỗ:
  1. Lượt của assignee **fail** (stopReason error/cancel) → item `in_progress`
     của session đó về `todo` (rollback, ghi system comment).
  2. User merge thành công (`sessions.integrateMember`) → item `in_review`/
     `changes` về `done`, ghi `mergedBranch`.
- `backlog` = bãi đỗ: KHÔNG wake assignee. Kéo sang `todo` mới là "bắt đầu".
- `blocked` là first-class: member tự báo kẹt kèm lý do (comment) — KHÔNG phải
  "fail", không rollback.

### 1.3 Channel — `~/.awog/team-runs/<runId>/channel.jsonl`

JSONL append-only của `TeamChannelEntry` (types/shared.ts):
`id, at, from(sessionId|null), fromTitle, kind('chat'|'status'|'note'|'eval'|'system'),
text(đã redact), mentions?(sessionId[])`.

Channel là của RUN (chết theo run), khác board là của PROJECT.

## 2. Lead protocol (Operating Protocol của gốc)

Mỗi lượt của phiên GỐC trong nhóm ≥1 member, `sessions/team-context.ts` inject
một block `<team>` gồm ba phần:

1. **Operating Protocol** (cố định, hệ thống quản — không editable):
   - Đọc board (đã tóm tắt trong block) → quyết định điều phối.
   - Giao việc = tạo/update item (assignee + `todo`), KHÔNG tự làm việc của member.
   - Member spawn LƯỜI: giao cho member chưa có phiên qua `assignee_member`
     (title spec) — phiên member materialize ngay trên lần giao đó.
   - Sau khi dispatch thì DỪNG — không tự code.
   - Ghi nhận định qua `team_note` (kind `eval`) sau mỗi lần tỉnh.
   - Review: đọc `member_diff` của member → duyệt thì báo người dùng merge, cần
     sửa thì chuyển item sang `changes` + comment.
   - `in_review` chỉ khi goal của item thật sự đạt.
2. **Roster**: danh sách member đang sống (title, teamRole, agent.id, branch,
   busy/idle) — build từ `listSessionSummaries`.
3. **Bench**: member của team spec CHƯA có phiên — lead thấy để biết còn ai
   để giao; spawn lười khi item được gán `assignee_member` (build từ
   `loadRunTeam` + `benchMembers` trong sessions/team-members.ts).
4. **Board summary + channel tail** (bounded, ~4k chars): item đang mở theo
   status; N entry cuối của channel.

Member được inject block `<team>` nhẹ hơn: roster ngắn + status contract +
hướng dẫn handoff (xong → `in_review` + báo lead; kẹt → `blocked` + lý do).

## 3. Agent binding — "vai có thật"

- `Session.agent` resolve **server-side mỗi lượt** trong
  `sessions.send-message.ts` qua `resolveAgentContext` (tasks/agent-context.ts)
  — kể cả lượt được tự-giao. Khi `params.agent` cũng có mặt (user chỉ tay),
  `params.agent` thắng.
- Agent áp: systemPrompt (prepend), model/provider/account, allowedTools,
  mcpServerIds — đúng đường agent hiện có của phiên.
- `create_session` tool + `sessions.spawn` nhận `agentId`/`agentSource`/
  `agentProjectId` trong spec con; spawn popover có picker agent (UI).
- Gỡ agent / đổi agent: RPC `sessions.setAgent(id, agent|null)` — RPC
  riêng vì `null` phải XOÁ HẲN key (spread patch không xoá được, y như setGroup).
- Lead được bind qua `sessions.setAgent` trên phiên GỐC (hoặc preset UI).

## 4. Worktree per member — "làm trên branch riêng"

Quản lý trong `tasks/worktree.ts`, owner kind `'session'` đã có sẵn:

- **Thiết lập lười**: lượt đầu của một phiên có `teamRunId` (và phiên đó
  không phải gốc) → `ensureSessionWorkspace(session)` tạo
  `~/.awog/session-worktrees/<sessionId>/worktrees/team` + branch
  `awog/session/<sessionId>/team` từ `baseRef` (HEAD hiện tại của repo), ghi
  `session.worktree`, rồi cwd của lượt = `worktreePath`.
- **Ưu tiên cwd**: `worktree.worktreePath` > `workspaceFolder` > project.path.
- **Degrade**: project không phải git repo / lệnh git fail → bỏ qua
  (không ghi worktree), member làm trên cây chung như cũ. Log warn.
- **Nhả theo membership**: `sessions.setRunMembership(id, null)` / archive / delete →
  `releaseSessionWorkspace(sessionId)`: commit WIP lên branch (nếu có thay đổi),
  remove worktree, GIỮ branch (không bao giờ xoá branch/merge tự động — việc đó
  của người dùng), xoá `session.worktree`.
- Lead (gốc) KHÔNG có worktree — nó giữ cây chính của project, đúng vai "đọc
  diff, điều phối, merge".

## 5. Review → merge loop

1. Member xong việc → `team_item_update` status `in_review` + `team_say` báo lead.
   - **Tác phong phối hợp** (prompt member): báo status ngắn lên channel khi
     bắt đầu và khi xong một item; cần input thì hỏi đồng đội bằng tên qua
     `team_say` mentions (wake ngay); trả lời member hỏi mình. Lead cũng được
     chỉ công bố giao việc/quyết định lên channel — người dùng đọc channel
     để theo dõi ê-kíp, nên phối hợp phải "hiện hình" ở đó.
   - **Tag `item_id`**: `team_say`/`team_note`/`team.channelPost` nhận
     `itemId`/`item_id` tùy chọn — entry nói về một item cụ thể được gắn thẻ
     (system merge cũng tự tag). UI tab **Discuss** của item lọc đúng các
     entry được tag item đó — "trao đổi nội bộ của ê-kíp về task này" tách
     khỏi ồn ào chung của run; entry không tag vẫn là kênh ê-kíp chung
     (cockpit Team / channel_read). Tail inject vào `<team>` hiện kèm
     `[item <id>]` để member biết entry nói về item nào.
     - **Thẻ phụ `itemIds`**: sidecar tự extract mọi `bi-<hex>` được nhắc
       trong text (trừ thẻ chính, dedup, trần 6) — agent hay nhắc id mà quên
       truyền `item_id`. Tin "duyệt bi-A liên quan bi-B" hiện trên Discuss
       của cả A lẫn B. UI entry cũ (trước field này) được derive tại chỗ
       cùng regex, không backfill file.
     - **Suy luận item của member**: post của member không mang thẻ nào
       (text cũng không nhắc `bi-…`) được gán thẻ phụ = các item đang do
       ĐÚNG phiên đó đảm nhận (`assigneeSessionId === from`, status
       in_progress/in_review/changes/blocked/done — backlog/todo/cancelled
       không tính; trần 3). Trao đổi của member mặc định là về việc mình
       đang cầm. LEAD (`from === rootId`) điều phối nhiều item một lúc nên
       không suy — lead untagged vẫn là trao đổi chung. UI derive luật y
       hệt cho entry cũ trong `entryInScope`.
     - **Roll-up cây cha-con**: scope tag của một item = chính nó + mọi con
       cháu (walk `parentId`) — Discuss của epic/parent hiện cả trao đổi được
       tag subtask. Helper dùng chung: `board.itemTagScope` + `entryInScope`
       (feed Discuss và badge đếm lọc cùng một luật).
     - **Chip `@mention`**: `SessionMarkdownHtml` bọc token `@handle`
       (slug `agentHandle` hoặc title) thành `.mdmention` khi có provider
       `useMemberPeek` — board editor resolve handle → session roster và mở
       drawer `WorkspaceAgentPeek`. Mention trong thread comment ("Giao cho
       @Dev") đi cùng đường luôn.
     - **"Đang soạn" = ghost bubble, không phải hàng chữ**: member được tag
       trong tin user vừa gửi (Discuss) hoặc assignee `streaming` (Comment)
       hiện như một assistant message placeholder (`streaming: true`,
       `author` = title) cuối feed — bubble rỗng render ba chấm typing
       (`.mtyping` — cùng state "chờ token đầu" của turn thật) kèm byline +
       `SessionProcessingIndicator` (chữ xoay + elapsed) dưới đó.
       Discuss gộp nhiều typer vào MỘT ghost vì indicator chỉ gắn message
       cuối; ghost nhường chỗ cho bubble thật khi member post (clearTyping)
       hoặc hết TTL 90s **và** phiên đã ngừng stream — lượt comm dài vài
       phút, TTL chỉ áp cho phiên không chạy (wake rớt/ping xong im) để
       ghost sống trọn turn chứ không biến mất giữa chừng. Hàng trạng thái
       dưới composer chỉ còn báo GIAO TIN (đã chuyển / xếp hàng / lỗi inbox).
2. Lead tỉnh (re-trigger §6) → đọc `member_diff` (tool, bounded `git diff
   baseRef..branch` — tối đa ~8k chars + danh sách file/stat) →:
   - OK → `team_say` ping người dùng / gợi ý merge.
   - Chưa OK → `team_item_update` status `changes` + comment cần sửa gì
     (wake lại member qua mentions hoặc inbox).
3. **Merge = của người dùng**: cockpit hiện nút Merge trên member có branch +
   item `in_review` → RPC `sessions.integrateMember(sessionId, {itemId?})`:
   checkout base trong repo gốc (dùng cơ chế integrate của worktree.ts),
   `git merge` branch member; conflict → trả lỗi rõ, item giữ `in_review`;
   thành công → item → `done` + `mergedBranch`, post channel `system`, KHÔNG
   xoá branch (user tự quyết).
- `sessions.memberDiff(sessionId)` RPC cho UI đếm diff stat (± files) hiện trên
  roster.

## 6. Re-trigger rules (ai được đánh thức)

Wake = `postSessionMessage` tới phiên đích (đi đúng đường inbox hiện có —
tin tự chạy khi đích rảnh, xếp sau lượt đang chạy khi bận; trần chi phí
của nhóm là hàng rào duy nhất — đúng triết lý "tiền của người dùng").

| Sự kiện | Ai tỉnh |
|---|---|
| Member post channel **có mentions** | các member được mention (không phải lead, trừ khi lead nằm trong mentions) |
| **User post channel `kind:'chat'` có mentions** | đúng các phiên được tag — `@Tên` trong Discuss gọi người dậy thật. `postChannelEntry` tự resolve lại `@handle` trong text về roster của run (không tin mentions[] rỗng của client): `@lead` ⇒ gốc · id phiên · slug title · verbatim `@Title` · `agent.id` nguyên văn/đuôi `'-'`+handle — bắt cả handle slug-tên-agent ("product-delivery-team-lead" vs title phiên "Product Delivery Team") vốn từng rớt sạch và để tin đi im lặng |
| Member post channel không-mention, hoặc đổi item sang `in_review`/`blocked`, hoặc hết một stage wave | **lead** (để re-evaluate) — dedup: lead đang busy/queued, hoặc đã wake trong 60s → bỏ qua |
| Post của chính lead, user không-mention, hoặc `kind:'note'`/`'eval'` | không ai |
| DM session→session (inbox thường) | đích — giữ nguyên luật cũ (`isRunHandoff`) |
| **User comment** trên thread item (`boards.comment`) | assignee sống → assignee; còn `assigneeRef` đỗ → materialize spec (agents.run / teams.run / sessions.materializeMember, kèm slot `assigneeConfig`) rồi gán `assigneeSessionId` + ping; trống chủ + có `@handle` → đích đầu khớp (**lead của run item** nếu handle trỏ vào nó — `lead` · `<slug-tên>-lead` · `agent.id` đuôi — đứng trước mọi match, không bao giờ spawn lead thứ hai) → phiên sống cùng project (exact trước, đuôi `agent.id` sau) → bench member của run item → agent spec → team spec) nhận item; `@handle` còn lại (kể cả item đã có chủ) → ping tham gia thread, không cướp assignee. Handle = slug bỏ dấu (`@khác` ≡ `@khac`), trần 3/comment |

Wake-lead implement bằng cách `postSessionMessage(member → rootId)` với text
tóm tắt ("board: X → in_review" / "channel: …") — cha↔con đã là run edge nên
đi trọn đường tự-giao/dedup sẵn có. Dedup map sống trong `channel.ts`, in-memory.

Tin wake `[channel]` (cả mention lẫn lead) dẫn RÕ "reply ON THE CHANNEL via
team_say (item_id…) — transcript của bạn vô hình với ê-kíp": không có chỉ
dẫn này, phiên đích đọc wake như một DM và trả lời trong transcript riêng —
người hỏi trên kênh không bao giờ thấy. Cùng bệnh `[board]` ping của
`boards.comment` đã vá bằng câu "reply IN THE THREAD via team_item_comment".

Chỉ dẫn là mềm nên có **mirror deterministic**: cả `wakeMentions` lẫn
`wakeLead` đều đánh dấu đích (`channelWakeMarks`: rootId + `itemId` gốc —
fallback `itemIds[0]` khi thẻ chính vắng — TTL 30'); `sessions.sendMessage`
gọi `mirrorCommReply` khi lượt COMM của đích kết thúc có text → reply ghi
lên kênh như 'chat' của chính phiên (tag item gốc, cắt 2000 ký tự). Phiên
đã tự `team_say` sau mốc wake → mirror bỏ qua để không đúp. Reply của lead
về một post member chính là đánh giá ê-kíp cần thấy trên Discuss nên lead
cũng mirror — reply mirror của lead (`from === rootId`) không kích wake nào.

Cả hai đường wake đều ghi **vạch biên nhận** `kind:'system'` ngay khi wake
THẬT SỰ bắn (cùng khuôn receipt của `boards.comment`): `delivered to "X"` /
`"X" is mid-turn — will read after it finishes` / `"X" could not be reached`
— tag item gốc (hoặc `itemIds[0]`) nên hiện đúng Discuss. `wakeLead` chỉ ghi
khi post thành công/thất bại — wake bị dedup 60s hay lead đang bận (không
post) thì không ghi vạch, vì member post rất thường xuyên sẽ spam kênh.
Đây là "nhận tin" mức hệ thống chứng minh được tức thì, không phải chờ
member/lead trả lời.

Phiên lead/member không ai mở UI nên auto-compact chủ động (đo gauge phía
client) không bao giờ chạy cho chúng — một lượt `Prompt is too long` từng giết
phiên điều phối vĩnh viễn. `sessions.sendMessage` tự cứu: bắt lỗi tràn ngữ
cảnh → chạy `/compact` qua runStream → persist checkpoint → retry lượt đúng
một lần (xem `auto-compact.md` §"Tự cứu khi tràn"). Wake vẫn trả lời được
sau khi cứu, và marker mirror không mất — reply của lượt đã cứu vẫn lên kênh.

Mọi ping thành công của `boards.comment` cũng ghi một **vạch biên nhận** kiểu
system-comment trong thread ("delivered to \"X\" · \"Y\" is mid-turn — will
read after it finishes"): đây là "nhận việc" mức thấp nhất mà hệ thống chứng
minh được ngay lập tức — user thấy tin đã tới ai và người đó đang bận hay
rảnh, không phải đợi agent thật sự reply. Tin wake (comment, giao việc qua
`boards.upsert`/`assignee_member`) đều ép thứ tự "acknowledge FIRST qua
`team_item_comment` trước mọi việc khác" — ack trong thread là hành động đầu
tiên, không phải công đoạn cuối.

### 6.1 Model route — model/effort theo tính chất việc

`boards/model-route.ts`: **dispatch = lúc quyết lại cấu hình**. Khi một item
được đặt vào tay một phiên — `boards.upsert` wake, `team_item_create/update`
(đường lead), `sessions.materializeMember`, hoặc bench member materialize lười —
hệ thống tự set `modelId` + `level` của người nhận theo tính chất item:

- **Chấm complexity** (deterministic, không tốn lượt LLM): epic/story,
  severity blocker/major, priority urgent/high, brief dài (>600 chars) mỗi
  thứ +1; subtask −1; kẹp 0..2 (nhẹ/thường/nặng).
- **"Rẻ nhất mà đủ"**: model có tier thấp nhất ≥ complexity trong catalog của
  provider hiệu dụng (pi `getModels` + `AWOG_EXTRAS`), trong tier xếp theo
  `cost.input + cost.output` thật; model chưa định giá đứng cuối. Effort đi
  theo: nhẹ `low`, thường `medium`, nặng `high`. **Lead không dưới tầm giữa**
  (orchestrator rẻ = orchestrator đần).
- **Route ĐÈ `modelId`/`level` của override tay** (`assigneeConfig`/Advanced)
  — người dùng đã cho phép — nhưng giữ `provider`/`accountId`/`mode` vì đó là
  ràng buộc account chứ không phải "độ mạnh". Provider để route: override tay
  → pin của agent bind → settings phiên; con kế thừa provider cha qua
  `mergeSpawnConfig`.
- Nút **"Tối ưu model"** trong tab Advanced của item là bản TAY của cùng một
  heuristic — giữ đồng bộ hai bên khi sửa.
- Cùng một item được giao hai lần liên tiếp (materialize → upsert → wake) đi
  qua nhiều điểm route — `routeSessionForItem` bỏ ghi khi kết quả y hệt
  override đang có; mọi ghi thành công phát `session.llm-override` để UI hội tụ.

### 6.2 Comm turn — lượt trả lời kênh chạy rẻ + nhanh

Wake từ kênh ê-kíp (`wakeMentions`/`wakeLead` của channel — tin `[channel]`)
mang cờ `comm` trên `InboxMessage` → event `session.inbox-message` → queue
renderer → RPC `sessions.sendMessage`. Batch tự giao chỉ được gọi là comm
khi **mọi** tin trong batch đều comm (một tin `[board]` lẫn vào ⇒ lượt chạy
cấu hình đầy đủ). `send-message` áp kẹp **sau mọi overlay** (payload → agent
pin → llmOverride → auto-route): model rẻ nhất catalog của provider hiệu dụng
+ `level: 'low'` — kể cả đè override tay, vì đích lượt là trả lời nhanh chứ
không làm việc sâu. Catalog rỗng ⇒ giữ model đang có, chỉ hạ effort. Kẹp này
per-turn: **không ghi** lên `session.llmOverride` nên cấu hình persistent
không đổi. DM `send_session_message`, ping `[board]` (giao việc, comment
wake) và user post thường KHÔNG mang comm — chúng có thể mang việc thật.

### 6.3 Ghế song song — một spec member là ROLE, không phải singleton

`member_instance:<N≥2>` trên `team_item_create`/`team_item_update` (kèm
`assignee_member`) xếp một ghế song song của cùng member: phiên mới mang
title `"<member title> N"` ("Dev 2" — một Dev thứ hai cho luồng backend trong
khi Dev làm frontend). Ghế instance thừa hưởng agent binding + `assigneeConfig`
của role — key `member:<seat>` thắng `member:<title>` khi user tinh chỉnh
riêng cho ghế đó.

- **Ngữ nghĩa ghế**: ghế N đã sống ⇒ tái dùng (giao thêm item vào "Dev 2" =
  đúng phiên đó); chưa có ⇒ spawn mới qua `spawnChildSession` — cùng đường
  spec-member nên KHÔNG qua popover duyệt (role đã được user duyệt; trần run
  con MAX_TEAM_MEMBERS vẫn áp).
- **Cap `MAX_MEMBER_INSTANCES = 4`**: vừa là trần fanout vừa chặn typo kiểu
  "Dev 99" — lỗi trả bằng lời để model tự sửa.
- **`liveMemberSession`** nhận tham số instance: ghế gốc khớp title hoặc
  agent.id nhưng LOẠI phiên instance-titled ("Dev 2" mang cùng agent binding
  mà không phải ghế gốc); ghế N khớp đúng title `"<title> N"`.
- **Lead quyết**, không tự động: protocol trong `<team>` chỉ dẫn đánh giá
  trước mỗi dispatch — spawn ghế khi các luồng độc lập sẽ xếp hàng trên một
  member hoặc member đang bận item khác; tái dùng ghế sống khi việc xếp chuỗi
  tự nhiên. Mỗi ghế là một phiên đốt token thật — song song có chủ đích,
  không phải phản xạ; lead được chỉ công bố lý do lên channel.
- User path (`sessions.materializeMember`, `@handle` trên comment) vẫn chỉ
  materialize ghế gốc — instance là công cụ điều phối của lead.

## 7. API surface

### RPC (methods/)

| Method | Params | Nghĩa |
|---|---|---|
| `boards.list` | `{projectId}` | `{items}` |
| `boards.upsert` | `{projectId, item: Partial & {id?, title}}` | tạo/sửa; trả item |
| `boards.delete` | `{projectId, itemId}` | xoá |
| `boards.comment` | `{projectId, itemId, text}` | user comment (from=null); wake theo §6 — trả `wake` ('delivered'/'queued'/'failed'/'none') |
| `sessions.setAgent` | `{id, agent: {id,source?,projectId?}|null}` | bind/gỡ agent |
| `sessions.memberDiff` | `{id}` | `{stat, diff}` bounded |
| `sessions.integrateMember` | `{id, itemId?}` | merge branch về base — conflict → RpcError |
| `team.channelList` | `{rootId, limit?}` | tail channel |
| `team.channelPost` | `{rootId, text, kind?, mentions?}` | user post vào channel |

### Model tools (chat sessions trong nhóm)

`team_item_list`, `team_item_get` (đọc một item: mô tả đầy đủ + toàn bộ thread
comment), `team_item_create`, `team_item_update` (status/assignee/stage/
title/desc — chặn `done`/`cancelled`; `assignee_member` = giao cho member spec
chưa có phiên — materialize lười ngay trên lần giao), `team_item_comment`,
`team_say` (post channel; `wake` param = mentions), `team_note` (lead eval,
kind `eval`), `channel_read`, `member_diff` (của member khác trong nhóm hoặc
chính mình).

Tất cả gated `filter.chatSession` + chỉ xuất hiện khi phiên **nằm trong nhóm**
— member (`teamRunId`) hoặc GỐC của run (link spec `teamId`, hoặc đã có con);
resolver chung `sessions/run-root.ts` — phiên lẻ không thấy tools này. **Ngoại
lệ duy nhất**: phiên board-worker lẻ (`agents.run` với `origin:'board'` —
phiên do board item dispatch) được `team_item_*` vì hợp đồng của nó LÀ board
item, nhưng vẫn không có channel/member tools (không ê-kíp). Hai runtime dùng
CHUNG runner (`createBoardRunners`/`createChannelRunners`/`createMemberRunners`):
nhánh Pi bọc thành AgentTool, nhánh Claude SDK bọc thành MCP server in-process
`awogteam` (`mcp__awogteam__*`, đăng ký trong `tools/bridged.ts` — thiếu phiên
nào trong nhóm thì server không được dựng).

### Events

`board.changed` `{projectId}` — renderer refetch board.
`board.item-touched` `{projectId, itemId, title, status, actorTitle, action,
changes?}` — một PHIÊN vừa tạo/cập nhật item qua board tools → renderer toast
"ai vừa làm gì" (dedup theo itemId). Chỉ phát từ đường agent — user tự sửa
qua `boards.upsert` không qua đây vì họ thấy kết quả ngay trên modal.
`channel.appended` `{rootId, entry}` — renderer append feed.

## 8. UI — "team cockpit"

`WorkspaceTeam.vue` nâng thành cockpit của nhóm (tab Nhóm):
- **Board** theo cột status (gọn, click mở item detail popover: desc, comments,
  assignee picker, nút move); nút "+" tạo item.
- **Roster**: mỗi member — status dot, role chip, **agent chip** (agent.id),
  **branch chip + diff stat** (`±n files`), nút Merge khi có item `in_review`.
- **Channel feed** (timeline, composer nhỏ; `@` mention member).
- **"Cần bạn quyết"**: item `in_review`/`blocked`/member error lên đầu.
- Spawn popover (`SessionSpawnHost.vue`): thêm picker agent per-spec.

## 9. Team (squad) — spec bền tách khỏi cây phiên

Group là cấu trúc RUNTIME — tan theo phiên. **Team** là lớp SPEC BỀN phía
trên (kiểu "squad" của Multica): định nghĩa một ê-kíp tái dùng, tồn tại độc
lập với mọi cây phiên, materialize thành cây mới mỗi lần giao việc.

```
TeamSpec { id, name, desc?, lead?, members[{title, agent?}],
           createdAt, updatedAt, source?, projectId? }
```

- `lead`/`members[].agent` là `SessionAgentRef` (con trỏ AGENT.md, resolve lúc
  chạy — agent bị xoá thì member đó chạy vai tự do, không fail cả team).
- Lưu hai tầng khuôn workflows: global `~/.awog/teams/<id>.json`, project
  `{project}/.awog/teams/<id>.json`; `source`/`projectId` suy từ đường dẫn,
  không ghi vào file (spec project-tier commit lên repo được).
- RPC: `teams.list` / `teams.upsert` / `teams.delete` / `teams.run` /
  `teams.draft` (AI dựng/revise cả spec — trả draft, KHÔNG ghi đĩa; roster
  agent hợp lệ do UI gửi kèm) / `teams.instructionsDraft` (AI viết lại RIÊNG
  ô `instructions` theo lời yêu cầu của user — trả text, editor đổ vào
  textarea để duyệt rồi Save; kèm `current` + context name/desc/member titles
  để model revise đúng vai trò).
- `teams.run(id, source, teamProjectId?, projectId, settings)`
  → tạo phiên gốc (title = team name — tự giao là mặc định nên run
  vừa được duyệt là nhận việc luôn), bind `team.lead` TRƯỚC khi emit `session.created`
  (summary mang sẵn `agent`), ghi `teamId`+`teamSource`/`teamProjectId` lên
  gốc, rồi gửi MỘT briefing vào inbox lead: chỉ dẫn của spec + roster member +
  luật dispatch lười. **Member KHÔNG spawn sẵn** — phiên của một member chỉ
  materialize khi được giao một board item (`assignee_member` của
  `team_item_create`/`team_item_update` → `materializeMember` trong
  sessions/team-members.ts → `spawnChildSession` đúng đường spawn thường →
  kế thừa settings, emit event, prompt đầu qua inbox CHÍNH là lời giao việc
  mang id item). Member đã sống ⇒ tái dùng phiên, không đẻ thêm. Mỗi lần
  run = một cây phiên MỚI; spec không đổi.
- `projectId` của `teams.run` là project ĐÍCH chạy cây phiên (board/worktree
  theo nó), tách với `teamProjectId` — project sở hữu SPEC. Team global giao
  được cho mọi project.
- UI: trang `/teams` (quản lý spec + nút Chạy), và picker "Giao cho" của board
  ở mode agent liệt kê cả team — sentinel `team:<key>` kích `teams.run` rồi
  item gán cho phiên gốc vừa materialize, tin giao việc xếp vào inbox lead.

## 10. Giới hạn & bất biến giữ nguyên

- Một phiên = một lượt tại một thời điểm (inbox/queue là chỗ đệm duy nhất).
- Không auto-merge; merge luôn qua click của user.
- Trần chống lặp của inbox (per-turn/per-target/hops) áp cho cả wake-lead.
- Redact toàn bộ text đi vào channel/board/comment (model-written).
- Hai cấp run giữ nguyên; run lồng không đổi.
- Không đụng Task Execution Engine / workflows.

## 11. Migration tương thích

- Group cũ (chỉ có teamRunId/teamRole) vẫn chạy: không agent → prompt thường,
  không worktree → cây chung, board/channel vẫn dùng được ngay.
- Không migrate dữ liệu cũ — board/channel là file mới.
