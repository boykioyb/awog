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
status, stage?, createdBy(sessionId|null=user), createdAt, updatedAt,
mergedBranch?, comments[]`.

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
| Member post channel không-mention, hoặc đổi item sang `in_review`/`blocked`, hoặc hết một stage wave | **lead** (để re-evaluate) — dedup: lead đang busy/queued, hoặc đã wake trong 60s → bỏ qua |
| Post của chính lead, hoặc của người dùng `kind:'note'` | không ai |
| DM session→session (inbox thường) | đích — giữ nguyên luật cũ (`isRunHandoff`) |

Wake-lead implement bằng cách `postSessionMessage(member → rootId)` với text
tóm tắt ("board: X → in_review" / "channel: …") — cha↔con đã là run edge nên
đi trọn đường tự-giao/dedup sẵn có. Dedup map sống trong `channel.ts`, in-memory.

## 7. API surface

### RPC (methods/)

| Method | Params | Nghĩa |
|---|---|---|
| `boards.list` | `{projectId}` | `{items}` |
| `boards.upsert` | `{projectId, item: Partial & {id?, title}}` | tạo/sửa; trả item |
| `boards.delete` | `{projectId, itemId}` | xoá |
| `boards.comment` | `{projectId, itemId, text}` | user comment (from=null) |
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
(`teamRunId` hoặc có con) — phiên lẻ không thấy tools này. Hai runtime dùng
CHUNG runner (`createBoardRunners`/`createChannelRunners`/`createMemberRunners`):
nhánh Pi bọc thành AgentTool, nhánh Claude SDK bọc thành MCP server in-process
`awogteam` (`mcp__awogteam__*`, đăng ký trong `tools/bridged.ts` — thiếu phiên
nào trong nhóm thì server không được dựng).

### Events

`board.changed` `{projectId}` — renderer refetch board.
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
- RPC: `teams.list` / `teams.upsert` / `teams.delete` / `teams.run`.
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
