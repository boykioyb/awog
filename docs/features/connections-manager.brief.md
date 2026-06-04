# Feature Brief: Connections Manager

> **Status:** In Spec
> **Owner:** Product Owner (placeholder)
> **Created:** 2026-06-03
> **Spec:** [connections-manager.md](./connections-manager.md)

## Problem

Khi tạo task gắn nguồn ngoài (GitHub issue, Jira ticket), người dùng nhập URL nhưng **không biết task sẽ truy cập hệ thống ngoài bằng credential nào** — vì hiện `source` chỉ là **metadata** in vào prompt, không gắn account, không xác thực. Khi agent thực sự cần đọc/ghi GitHub/Jira lúc chạy, nó phải dựa vào `gh` CLI (auth hệ thống, ngầm) hoặc một MCP server đã cấu hình sẵn — nhưng mối liên hệ "task này ↔ connection nào" không hề hiện ra ở đâu.

Hệ quả: người vận hành AWOG (guild master) phải tự nhớ đã cấu hình token ở đâu, whitelist cho agent nào, và không có một nơi thống nhất để xem/tái dùng "các kết nối có credential". Credential dễ bị nhập trùng nhiều chỗ, khó audit "task sắp chạy sẽ chạm tài nguyên ngoài nào".

## Target user

- **Persona:** Developer/operator chạy AWOG local-first trên repo + issue tracker thật của mình (single-user).
- **Tần suất gặp problem:** Mỗi lần tạo task có `source = github/jira`, hoặc mỗi lần agent cần chạm hệ ngoài.
- **Workaround hiện tại:** Tự tạo GitHub/Jira **MCP server** (token → keychain) rồi whitelist thủ công cho từng agent; hoặc phó mặc `gh` CLI dùng auth máy. Không có liên kết tới task source, không có chỗ xem tổng quan.

## Why now

- **Tasks/Workflows vừa chạy thật** ([ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md)) — engine giờ thực thi node qua SDK, nên "thiếu lớp kết nối" mới lộ ra rõ ràng (trước đây mọi thứ là mock).
- **Hạ tầng credential tái sử dụng đã sẵn sàng**: MCP secret keychain ([ADR 0018](../decisions/0018-mcp-secret-keychain.md)) + per-agent whitelist + fold Context Providers vào MCP ([ADR 0016](../decisions/0016-deprecate-context-providers-fold-into-mcp.md)). Substrate có rồi — việc còn lại là **hợp nhất + phơi bày**, không phải xây mới từ đầu.
- Tránh nợ kỹ thuật: nếu không định hướng, dễ phát sinh "account store thứ hai" trùng với MCP/Anthropic accounts ([ADR 0011](../decisions/0011-anthropic-subscription-oauth.md)).

## Hypothesis

Nếu ta đưa ra một khái niệm **Connection** thống nhất (xây **trên** MCP, không thay thế) mà cả *task source* lẫn *agent* đều tham chiếu, thì người dùng cấu hình credential **một lần** và tái dùng xuyên task/agent, đồng thời **nhìn thấy ngay** task sẽ dùng connection nào. Đo bằng: số lần nhập trùng token → 1/dịch vụ; tỉ lệ task tạo ra có connection rõ ràng tăng.

## Success criteria

- Mỗi dịch vụ ngoài (GitHub, Jira, …) chỉ cần cấu hình credential **một chỗ**, tái dùng cho mọi task/agent (0 lần nhập trùng).
- Ở New Task modal, khi chọn source GitHub/Jira: người dùng **thấy + chọn được** connection sẽ dùng (hoặc được cảnh báo nếu chưa có) — hết câu hỏi "account nào?".
- Có **một màn hình** liệt kê mọi connection có credential (gồm MCP server) + trạng thái, không phân mảnh.
- Credential **không** rời keychain/sidecar (giữ nguyên invariant #1) — 0 secret lộ ra UI/log.
- Không phát sinh store credential thứ hai (mọi thứ vẫn trên MCP/keychain).

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | Yes — connection cấp tool để agent đọc/ghi rồi sinh artifact; bản thân connection không phải artifact. |
| Workflow-based | Yes — connection gắn vào agent/source mà workflow node dùng. |
| Human-in-the-loop | Yes — con người cấu hình + cấp quyền connection; secret cần người nhập, lưu keychain. |
| Local-first | Yes — credential trong OS keychain, không cloud, không telemetry. |

## Scope hint

- **v-next** (post-MVP). Tích hợp GitHub/Jira **native** vẫn ngoài MVP ([mvp-scope](../requirements/mvp-scope.md): connector skeleton) — feature này **không** xây API client riêng mà chuẩn hoá lớp connection trên MCP.
- Layer chạm: **UI** (màn Connections + picker trong NewTaskModal) / **Sidecar** (mở rộng `mcp/store` + có thể 1 abstraction "connection" mỏng trỏ tới MCP server + service-type) / **Storage** (tái dùng keychain, không thêm store).
- Ước lượng (PM refine): **M–L**.

## Out of scope (cho lần này)

- Native GitHub/Jira API client trong AWOG (vẫn đi qua MCP server làm transport).
- OAuth flow tương tác cho GitHub/Jira (chỉ token/PAT qua keychain ở bản đầu).
- Đa người dùng / chia sẻ connection giữa nhiều máy.
- Hợp nhất Anthropic accounts (model auth) vào cùng màn — cân nhắc sau, khác bản chất.

## Open questions cho user

- "Connection" là **view thân thiện hơn của MCP server**, hay **entity mỏng mới** trỏ tới (mcpServerId + serviceType: github/jira)? — quyết định kiến trúc lớn, cần ADR.
- `task.source` có nên mang `connectionId` không, hay vẫn để agent (qua `mcpServerIds`) quyết định runtime?
- Khi source = github mà chưa có connection GitHub: tự gợi ý tạo MCP server preset, hay chỉ cảnh báo?
- `gh` CLI (auth hệ thống) cùng tồn tại thế nào — coi như một "connection ngầm" hay bỏ qua?

## Liên kết

- [VISION](../../artifacts/VISION.md)
- [MVP scope](../requirements/mvp-scope.md)
- ADR liên quan: [0014 MCP runtime](../decisions/0014-mcp-servers-stdio-runtime.md), [0016 fold context providers](../decisions/0016-deprecate-context-providers-fold-into-mcp.md), [0018 MCP secret keychain](../decisions/0018-mcp-secret-keychain.md), [0011 Anthropic OAuth](../decisions/0011-anthropic-subscription-oauth.md), [0024 task engine](../decisions/0024-task-execution-engine-ipc-contract.md)
- Spec liên quan: [mcp-servers](./mcp-servers.md), [task-execution-engine](./task-execution-engine.md)
