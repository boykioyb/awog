# Phạm vi MVP

## Trong phạm vi

- Project management (CRUD codebase local)
- Agent Builder
- Skill Builder
- Workflow Builder (DAG designer kéo-thả)
- Task Runner với Phase / Run versioning
- Artifact Viewer + Markdown editor fullscreen
- Mermaid diagram rendering
- Diff viewer cho `.diff` / `.patch`
- Approval gate cho con người (Approve / Rerun-from-here)
- Agent Trace với 4 loại node (agent, subagent, tool, thinking)
- Discussion tab per phase
- Theme system (dark / light)
- Settings 7 section (Workspace / Models & API Keys / Connectors / MCP Servers / Hooks / Commands / Appearance)
- MCP Servers (stdio + http transport, whitelist per-agent)
- Hooks (event automation, blocking + background)
- Slash Commands (prompt / agent-switch / shell / workflow)
- Lưu trữ trên local filesystem
- Versioning bằng Git
- Desktop shell (Tauri + Nuxt + Node.js sidecar)
- System tray + native notification

## Đã prototype (UI mock, chưa wire vào engine thật)

- Live trace với subagent đang chạy
- Mock data cho 5 task, 4 project, 7 agent, 12 skill, 2 workflow mẫu
- Rerun-from-here với invalidate downstream
- Approve flow với chuyển trạng thái phase kế tiếp

## Ngoài phạm vi (sau MVP)

- Database backend
- Cloud sync
- Cộng tác đa người dùng
- Authentication / authorization
- Tích hợp GitNexus thật (provider có khung, chưa kết nối)
- RAG / vector search
- Tích hợp Jira / Slack / Notion thật (chỉ có connector skeleton)
- Marketplace cho agent / skill / workflow
- Notification action button (Approve / Reject ngay từ OS notification)

## Tiêu chí thành công

MVP được xem là thành công khi người dùng có thể:

1. Đăng ký ít nhất 2 project (link existing hoặc clone).
2. Tạo ít nhất 3 agent tùy biến với role khác nhau.
3. Định nghĩa skill và gán cho agent.
4. Dựng một workflow nhiều bước bằng DAG designer.
5. Chạy workflow như một task gắn project, thấy artifact sinh ra tại mỗi phase.
6. Mở artifact `.md` trong markdown editor fullscreen, thấy mermaid diagram render đúng theme.
7. Phê duyệt / rerun-from-here các artifact trung gian, thấy version history rõ ràng.
8. Inspect trace của mọi hành động agent, kể cả subagent.
9. Tiếp tục công việc sau khi khởi động lại ứng dụng (state persistent trên đĩa).
10. Đóng cửa sổ, task vẫn chạy ở tray, nhận notification khi cần approval.
