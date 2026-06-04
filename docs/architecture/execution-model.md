# Execution Model

Cách task chạy qua workflow.

## Vòng đời Task

```
              ┌──────────────┐
              │   Queued     │
              └──────┬───────┘
                     ▼
              ┌──────────────┐         ┌──────────────────┐
   ┌─────────►│   Running    │────────►│ WaitingApproval  │
   │          └──────┬───────┘         └────────┬─────────┘
   │                 │                          │ (người dùng act)
   │                 ▼                          │
   │          ┌──────────────┐                  │
   │          │   Failed     │                  │
   │          └──────────────┘                  │
   │                                            │
   └────────────────────────────────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │  Completed   │
              └──────────────┘

   (bất kỳ trạng thái nào) ──> Superseded   (bị thay thế bởi task mới)
```

## Thực thi per-node

Với mỗi workflow node:

1. **Gom input** — resolve các edge từ output của node phía trên (artifact).
2. **Load agent + skill** — đọc config agent và prompt template của skill.
3. **Build prompt** — điền template skill với input và context từ provider.
4. **Gọi model** — qua Model Adapter tương ứng.
5. **Xử lý tool call** — chạy tool call theo vòng lặp tới khi model trả response cuối.
6. **Ghi output** — sinh artifact vào workspace; Git commit.
7. **Phát event** — append trace event vào `events.log` xuyên suốt.
8. **Tiến lên** — đánh dấu node hoàn tất; chuyển sang node kế (hoặc approval gate).

## Approval Gate

Khi workflow tới một approval node:

1. Task status → `WaitingApproval`.
2. Engine persist state hiện tại và dừng xử lý.
3. UI thông báo cho người dùng.
4. Người dùng act (Approve / Reject / Request Changes / Rerun).
5. Engine resume tương ứng.

## Xử lý lỗi (MVP)

- Bất kỳ lỗi không xử lý nào trong node execution → task status `Failed`.
- Event lỗi được ghi vào trace.
- Không retry tự động (MVP). Người dùng có thể rerun node fail thủ công.

## Concurrency

> Cập nhật theo [ADR 0024](../decisions/0024-task-execution-engine-ipc-contract.md) — thay mô hình "single worker" ban đầu bằng parallel scheduler.

- **Parallel scheduler per-task.** Một node trở nên *runnable* khi mọi node upstream (nguồn của edge vào) có phase `completed`. Các nhánh DAG độc lập (vd REV và QA cùng phụ thuộc DEV) chạy **đồng thời**.
- **Join semantics**: node có nhiều edge vào chỉ chạy khi *tất cả* upstream `completed`.
- **Concurrency cap** `CONCURRENCY_CAP = 4` node chạy đồng thời trong một task; phần dư queue tới khi có slot.
- **Approval gate** chỉ chặn nhánh downstream của chính nó, không chặn nhánh sibling.
- **Failure**: node fail → downstream (reachability BFS) fail; sibling in-flight chạy nốt; không dispatch thêm → task `failed`. Không auto-retry (MVP).
- **Git contention**: node ghi-code nên nối **tuần tự** trong DAG; nhánh song song dành cho read/analysis sinh `.md` artifact (tránh `git add -A` race — xem ADR 0024 D-9).
- Nhiều task có thể chạy song song (mỗi task có scheduler + cap riêng).

## Restart Safety

- State event-sourced JSONL (`tasks/<id>/events.log`) — mọi status change append trước khi có hiệu lực; `task.json` là snapshot cache (`fold`).
- `engine.resumeOnBoot` (gọi lúc sidecar start): `listTasks` → fold mỗi task:
  - `completed` / `failed` / `waiting_approval` / `paused` → để nguyên.
  - `queued` / `running` → **KHÔNG auto-resume.** Đưa task về `paused` và chờ người dùng bấm **Resume** (kill/restart không được âm thầm chạy lại agent — tốn token + tự sửa repo không có sự đồng ý). Run còn `running` lúc boot (interrupted) → append `run.status: failed` + phase về `pending` để chạy lại sạch khi resume (artifact overwrite, autoCommit skip nếu no-change). Không resume nửa chừng một lượt SDK.
  - Resume (`tasks.resume`) → recompute runnable set từ frontier (completed phase giữ completed, pending chạy lại).
