# Feature: Agent Trace & Observability

**Trạng thái:** Draft

## Overview

Trace cho người dùng xem chính xác agent đã làm gì — mọi tool call, subagent spawn, thinking step, và artifact read/write — dưới dạng cây expandable. Trace được hiển thị trong tab Execution của mỗi Phase, song song với tab Output (artifact) và tab Discussion (chat với agent).

## User Stories

- Là người dùng, tôi muốn xem chính xác agent đã gọi tool gì, dùng input gì, nhận kết quả gì.
- Là người dùng, tôi muốn thấy subagent được spawn để làm gì (purpose), không chỉ tool call cấp một.
- Là người dùng, tôi muốn theo dõi live khi agent đang chạy với indicator pulse.

## 3 tab trong mỗi Phase

| Tab | Nội dung |
|---|---|
| **Output** | Render artifact đã tạo (markdown + mermaid), approval info, nút "Open in editor" cho `.md`/`.diff`/`.patch`/`.yaml` |
| **Execution** | Tree view của trace, expandable/collapsible |
| **Discussion** | Chat panel ngay tại phase, trao đổi user ↔ agent mà không invalidate workflow |

## Phase header

- Index `01`, `02`, …
- Status icon: `running` (pulse), `completed` (filled), `waiting_approval` (amber pulse).
- Role badge của agent.
- Tên agent + skill name (mono font).
- Version badge nếu có nhiều run: `v2 of 3`.
- Tag bên phải: "Awaiting approval" / "Live" / duration (`42s`).

## Trace tree

### 4 loại node

| Type | Hiển thị | Field đặc trưng |
|---|---|---|
| **agent** | Root của trace, agent thực thi phase | `name`, `model`, `startedAt`, `duration` |
| **subagent** | Agent con được spawn ra | `agentName`, `model`, `purpose`, `duration` |
| **tool** | Tool call (ví dụ `gitnexus.semantic_search`) | `tool`, `input`, `result`, `duration` |
| **thinking** | Reasoning step nội bộ | `text`, `duration` |

Mỗi loại có màu phân biệt để dễ scan.

### Live indicator

Node đang chạy có `status: 'running'`, hiển thị pulse animation, `duration: null`. Tree update realtime qua streaming event từ engine.

### Subagent visibility

Subagent có:
- **purpose**: lý do được spawn (ví dụ "Analyze existing scheduler patterns").
- **model**: có thể khác model của agent cha (Architect dùng Opus, subagent Code Explorer dùng Sonnet).
- **tools**: list tool subagent đó dùng, lồng vào children.

Ví dụ trace của Solution Architect:
```
Architect (claude-opus-4-7) — 42s
├── tool: artifact.read(requirement.md) — 0.1s
├── subagent: Code Explorer (claude-sonnet-4-6, purpose: scheduler patterns) — 14s
│   ├── tool: gitnexus.semantic_search — 1.8s
│   ├── tool: gitnexus.read(scheduler.py) — 0.3s
│   └── thinking: "Existing pattern uses BullMQ" — 4.2s
├── subagent: Dependency Analyzer (purpose: downstream consumers) — 8s
│   └── tool: gitnexus.find_callers — 2.1s
├── thinking: "Designing partitioned scheduler" — 12s
└── tool: artifact.write(architecture.md) — 0.3s
```

## Phase actions

- **Approve** — chỉ hiện khi `waiting_approval`. Approve sẽ chuyển phase sang `completed` và kích hoạt phase kế tiếp.
- **Rerun from here** — invalidate phase này và toàn bộ downstream, modal yêu cầu instruction, tạo run mới v(n+1), version cũ thành `superseded` (gạch ngang trong history bar).

## Run history bar

Khi phase có nhiều run, hiện history bar với pills `v1` / `v2` / `v3`:
- Click pill để switch view giữa các version.
- Run trigger bởi rerun có icon ↺.
- Run `superseded` hiển thị gạch ngang.

## Lưu trữ dữ liệu

`workspace/tasks/<task-id>/events.log` — append-only JSON Lines. Trace tree cấu trúc được render từ event log (reconstruct cây từ parent-child relationships).

## Phụ thuộc

- [task-execution-engine](./task-execution-engine.md)

## Câu hỏi mở

- Giữ dữ liệu trace bao lâu? Compact khi quá lớn?
- Export trace ra định dạng nào (OpenTelemetry?) để phân tích bên ngoài?
- Discussion tab có nên có quota token để tránh blow up session?
