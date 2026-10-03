# 0094 — Session Teams: nhóm phiên vận hành như code team (board theo project, channel theo nhóm, worktree per member)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-30
- **Người quyết định:** kyro (chốt mô hình "code team"), devin (phác thảo)

## Bối cảnh

Session groups ([spec](../features/session-runs.md)) đã có cây **hai cấp** cha→con trên `groupParentId`, cơ chế arm/`groupAutoDeliver`, miễn trần hop theo cạnh cha–con và popover duyệt spawn. Nhưng nhóm đó vẫn là "một cây phiên trò chuyện qua hộp thư", chưa phải một **code team**:

- **Vai chỉ là nhãn.** `groupRole` là chuỗi hiển thị — không bind agent thật, không đổi systemPrompt/model/tools của phiên. Mục "Vai đi vào prompt" nằm trong Phần chưa làm.
- **Cùng một cây làm việc.** Mọi member sửa chung working tree của project — hai member chạy song song là giẫm lên nhau.
- **Điều phối = ping-pong hộp thư 1-1.** Không có chỗ dính "việc" — lead và member đọc trạng thái công việc từ transcript của nhau.
- **Không có cổng review.** Lead tự quyết khi nào việc xong; người dùng không có điểm dừng trước khi code của member vào nhánh chính.

Người dùng muốn một ê-kíp thật: vai có thật (agent được bind), mỗi member một branch/worktree riêng, task board + vòng review, kênh chung của cả nhóm, và một lead chuyên trách điều phối. Hình mẫu tham khảo: **Multica** (github.com/multica-ai/multica) — issue là vật dính mọi thứ (assignment, status, comment), status do agent tự ghi, `backlog` là bãi đỗ **không-wake**, lead được re-trigger theo luật có dedup.

Ràng buộc định hình: [ADR 0085](0085-workflow-as-script.md) đo trên máy dev thấy workflow DAG **chưa từng được dùng thật** còn sessions dùng mỗi ngày — nên mô hình team phải dựng trên bề mặt sống là sessions, không mượn Task Execution Engine.

## Quyết định

1. **Giữ cây hai cấp; phiên gốc = LEAD.** Không thêm entity "Group" — `groupParentId` vẫn là cạnh duy nhất, gốc cây đóng vai lead điều phối (Operating Protocol riêng, không tự code).
2. **Hai field mới trên `Session`:**
   - `groupAgent` (`SessionAgentRef` `{id, source?, projectId?}`) — bind một agent AWOG thật (AGENT.md) cho mọi lượt của member/lead; resolve server-side mỗi lượt qua `resolveAgentContext`, `params.agent` của user thắng khi cả hai có mặt. `groupRole` giữ nguyên làm chip hiển thị.
   - `groupWorktree` (`SessionGroupWorktree` `{repoPath, worktreePath, branch, baseRef, createdAt}`) — worktree + branch riêng của member.
3. **Board thuộc PROJECT, không thuộc group** — `~/.awog/boards/<projectId>.json`. Xoá nhóm không mất backlog; nhiều group trong cùng project nhìn chung một board (member kế thừa `projectId` của cha ⇒ 1 group = 1 board).
4. **Channel thuộc GROUP** — `~/.awog/team-runs/<rootId>/channel.jsonl` (JSONL append-only, broadcast cả ê-kíp), chết theo group. Board và channel cố ý khác chủ sở hữu: backlog là tài sản của project, còn hội thoại điều phối là phù du của ê-kíp.
5. **Hợp đồng status:** agent tự ghi mọi status qua `team_item_update` **trừ `done`/`cancelled` — hai giá trị đó là của người dùng** (tool từ chối, gợi ý `in_review`). Hệ thống chỉ tự sửa đúng hai chỗ: lượt assignee **fail** → `in_progress` về `todo` (rollback + system comment); user **merge thành công** → `done` + `mergedBranch`. `backlog` không wake ai; `blocked` là first-class (member tự báo kẹt, không phải fail).
6. **Worktree sống theo membership, không theo lượt.** Tạo lười ở lượt đầu của member (`ensureSessionWorkspace`, nhánh `awog/session/<sessionId>/team`); nhả khi rời nhóm/archive/xoá (`releaseSessionWorkspace`: commit WIP, remove worktree, **giữ branch**). Lead (gốc) không có worktree — nó giữ cây chính.
7. **Merge luôn qua tay người dùng**: RPC `sessions.integrateMember` (checkout base trong repo gốc → `git merge` branch member; conflict → RpcError, item giữ `in_review`). **Branch không bao giờ tự bị xoá hay tự merge.**
8. **Re-trigger theo luật** (wake = `postSessionMessage` → đi đúng đường inbox/arm/caps sẵn có):
   - Post channel **có mention** → wake các member được mention.
   - Activity member **không-mention** (post thường, item → `in_review`/`blocked`, hết stage wave) → wake **lead**, dedup 60s + skip khi lead busy/queued.
   - Post của chính lead, hoặc `kind:'note'` của người dùng → **không wake ai**.
9. **Channel delivery pull-based**: inject **channel tail** (bounded ~4k chars) vào block `<team>` ở đầu lượt tỉnh, thay vì push từng entry vào inbox.

## Phương án đã cân nhắc

- **Tái dùng trọn Task Execution Engine** (board = workflow items, member = node): ADR 0085 đã đo workflow DAG gần như không được dùng (0 file workflow); node one-shot không giữ context và không có "người ngồi giữa". Sessions là bề mặt sống — dựng team trên sessions, không trên scheduler.
- **Entity `Group` first-class** (object riêng có id/tên/lifecycle): từ chối — giữ mô hình `groupParentId` đã chạy, khỏi thêm một entity phải đặt tên, đổi tên và dọn rác khi phiên cha bị xoá (tên nhóm vẫn = tiêu đề phiên gốc).
- **Push-based channel delivery** (mỗi entry post thẳng vào inbox từng member): từ chối — push chen giữa lượt đang chạy, vi phạm bất biến "một phiên = một lượt" và bắt inbox phải mang thêm một nguồn nữa. Pull/tail-injection để lượt tỉnh tự đọc phần mới, không gián đoạn ai.
- **Cho agent ghi `done`**: từ chối — "done là quyền của người dùng" giữ thẩm quyền merge ở người; agent tối đa đến `in_review`, còn merge là click của user qua `sessions.integrateMember`.

## Hệ quả

- **Tích cực:** vai thành có thật (agent bind thay nhãn); member cô lập nhau bằng worktree/branch; backlog sống sót qua vòng đời nhóm; người dùng có điểm dừng merge rõ ràng; lead có luật re-trigger + dedup nên ê-kíp tự xoay mà không spam.
- **Tiêu cực / Trade-off:** thêm hai store file mới (`boards/`, `groups/<id>/channel.jsonl`); wake-lead đi qua inbox nên chịu trần của đường đó; worktree lười nghĩa là lượt đầu của member chậm hơn một nhịp git.
- **Bất biến giữ nguyên:** một phiên = một lượt tại một thời điểm; không auto-merge; trần inbox (per-turn/per-target/hops) áp cho cả wake-lead; redact toàn bộ text model ghi vào board/channel/comment; cây nhóm vẫn hai cấp.
- **Vùng đụng (theo [spec](../features/session-teams.md)):** `types/shared.ts` (Session/BoardItem/TeamChannelEntry), `boards/` store mới, `sessions/channel.ts` (append + dedup wake-lead), `sessions/team-context.ts` (inject `<team>`), `tasks/worktree.ts` (owner kind `session` — ensure/release/memberDiff/integrate), model tools mới (`team_item_*`, `team_say`, `team_note`, `member_diff`), RPC (`boards.*`, `groups.channel*`, `sessions.setGroupAgent/memberDiff/integrateMember`), events `board.changed`/`channel.appended`, UI cockpit trong `WorkspaceGroup.vue` + agent picker ở `SessionSpawnHost.vue`.
- **Migration:** không cần — group cũ chỉ có `groupParentId`/`groupRole` vẫn chạy (không agent → prompt thường, không worktree → cây chung); board/channel là file mới.
- **Supersede phần mô hình điều phối của spec session-runs** (vai=nhãn, điều phối qua ping-pong hộp thư, không cổng review). Cây hai cấp, arm/`groupAutoDeliver`, miễn trần hop, trần lượt và popover spawn/arm **giữ nguyên là nền**.

## Tham chiếu

- [Spec: session-teams](../features/session-teams.md)
- [session-runs.md](../features/session-runs.md) — nền cây/inbox/arm được tái dùng nguyên vẹn
- [session-messaging.md](../features/session-messaging.md) — hộp thư 1-1 (giữ nguyên, channel không thay thế DM)
- [ADR 0085](0085-workflow-as-script.md) — số liệu "workflow DAG không được dùng" làm cơ sở bác phương án mượn engine
- [ADR 0081](0081-task-node-worktree-isolation.md) — tiền lệ worktree theo owner trong `tasks/worktree.ts` mà member worktree kế thừa
- Multica: github.com/multica-ai/multica — hình mẫu issue-as-connective-object + lead re-trigger
