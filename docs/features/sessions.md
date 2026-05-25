# Feature: Sessions

**Trạng thái:** Draft (prototype) — chưa wire engine.

## Vì sao

Task + Workflow là đơn vị công việc có quy trình, agent cố định, approval gate, deliverable rõ. **Không phù hợp** cho:

- Brainstorm / research mở
- Note nháp / scratch pad
- Hỏi nhanh không cần workflow đầy đủ
- Trao đổi đa agent ad-hoc (mời ai cũng được, hỏi ai cũng được)

→ Tách **Sessions** thành entity hoàn toàn riêng, song song với Tasks. Không ép vào model Task để tránh lẫn paradigm (Task có status pipeline, Session thì không).

## Định nghĩa

Session = một thread chat **tự do**, không gắn workflow, không bắt buộc gắn project, không có pipeline phase.

| | Task | Session |
|---|---|---|
| Cấu trúc | DAG workflow phase | Linear chat thread |
| Agent | Cố định theo node | Mời tùy ý, ai cũng có thể không có |
| Project | Bắt buộc | Optional |
| Approval | Có gate per node | Không |
| Output | Artifact phase | Artifact rải rác trong thread (optional) |
| Lifecycle | Queued → Running → Completed/Failed | Không có status — luôn "open" cho tới khi user xóa |

## User flow

1. **Vào tab Sessions** (nav rail riêng, cùng cấp Tasks/Projects/Agents).
2. Sidebar trái: list session, sort theo `pinned` → `updatedAt`. Search theo title + nội dung message.
3. Click **+ New** → tạo session trống, title "Untitled session", auto-focus title để rename.
4. Chat panel chính:
   - **Composer ở đáy**, gửi message **không cần agent**. Mặc định không có ai trả lời.
   - **`@mention`** trong message → agent đó tự động join + trả lời. Có thể mention nhiều agent cùng lúc, tất cả trả lời song song.
   - **Header** hiển thị chip các agent đang trong session, click chip = remove agent (system message "left").
   - Nút **Invite** mở popover chọn agent để mời thủ công (không qua @mention).
5. Rename session bằng cách click vào title ở header.

## Acceptance criteria (prototype scope)

- [x] `Session` type độc lập, không phụ thuộc `Task`.
- [x] Pinia store `sessions` riêng (`stores/sessions.ts`).
- [x] Nav rail item **Sessions** giữa Tasks và Projects.
- [x] `/sessions` page với layout sidebar + chat tương tự `/tasks`.
- [x] Composer gửi message không cần chỉ định agent.
- [x] `@mention` parse handle (kebab-case từ name hoặc role), auto-invite + trigger mock reply.
- [x] Header chip cho mỗi agent invited, click X để remove.
- [x] Nút Invite mở popover chọn agent.
- [x] Sample data 3 session: 1 multi-agent có artifact, 1 đang chờ pair, 1 scratch pad.
- [x] Auto-scroll xuống đáy khi có message mới.
- [x] Rename session inline.

## Out of scope (prototype)

- Lưu xuống filesystem (`workspaces/<ws>/sessions/<id>.md`).
- Skill invocation từ session.
- Promote-session-to-workflow.
- Multi-agent quorum / parallel debate format.
- Session timeline / fork / branch.
- Mention autocomplete dropdown (gõ `@` xong gợi ý) — hiện tại chỉ parse khi send.
- Markdown render trong message (hiện text + escape + highlight mention).

## Tác động kiến trúc

- **Không đụng `Task`** — paradigm tách rời.
- Sidecar sẽ cần handler riêng cho session messages (ADR riêng khi đến lúc).
- Workspace layout cần directory mới `sessions/` (sẽ document trong `workspace-layout.md`).
- Mention syntax thống nhất qua dự án — cần đăng ký handle convention (name kebab + role lowercase).

## Câu hỏi mở

- Session có nên gắn project optional, hay luôn rời? (hiện tại: optional, nhưng prototype seed không hiển thị picker — sẽ thêm sau).
- Có cần "agent role" mode trong session (vd: agent X được giao role moderator)?
- Mention không match → silent ignore hay system warning? (hiện tại: silent).
- Session lớn → cần compaction/summarize khi nào?
