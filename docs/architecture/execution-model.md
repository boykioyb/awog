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

## Concurrency (MVP)

- Một worker thực thi duy nhất.
- Mỗi task xử lý một node tại một thời điểm.
- Nhiều task có thể queue, nhưng chạy tuần tự cho đơn giản.
- Thiết kế để thay bằng scheduler song song sau MVP.

## Restart Safety

- Mọi state (task, event, artifact) được lưu xuống đĩa trước khi đổi status.
- Khi khởi động, engine quét `tasks/` và:
  - Resume task `Running` từ bước hoàn tất gần nhất.
  - Để nguyên task `WaitingApproval`.
