# Feature Brief: Account Quota Usage trên System Tray

> **Status:** Draft — decisions locked 2026-06-15, ready for BA
> **Owner:** PO (placeholder)
> **Created:** 2026-06-15

> Đây là **đề xuất #6** trong loạt mở rộng system tray (xem 5 đề xuất kia ở
> [docs/design/tray-and-notifications.md](../design/tray-and-notifications.md):
> badge cần-duyệt, dynamic menu task, native notification qua main, quick actions,
> minimize-to-tray). #6 tập trung riêng vào **quota usage của từng account**.

## Problem

User chạy session/task dài bằng tài khoản subscription (Claude Pro/Max, ChatGPT
Codex). Quota của các tài khoản này theo cửa sổ trượt (5 giờ + tuần) và **cạn giữa
chừng mà không có cảnh báo sớm** — đến khi provider trả `rejected`/429 thì session bị
chặn hoặc task rơi vào `waiting_connection` ([connection-quota-handling](./connection-quota-handling.md)).

Hiện app **đã có** số liệu usage (RPC `account.usage`, render trong
[SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue)),
nhưng chỉ thấy được khi: (1) mở app, (2) vào đúng một session, (3) bấm mở popover —
và chỉ cho **account của session đó**. Khi cửa sổ đóng / thu xuống tray, hoặc khi có
nhiều account, user **mù hoàn toàn** về việc còn bao nhiêu quota.

Đây là vấn đề **proactive** (nhìn trước để giãn việc), khác với quota-handling hiện
tại vốn **reactive** (cạn rồi mới pause + xin key mới).

## Target user

- **Persona:** Solo Builder (persona chính MVP) — chạy session/task local bằng
  subscription của chính mình, thường có ≥1 account (vd Max chính + Codex phụ).
- **Tần suất gặp problem:** hằng ngày với user dùng nhiều — cửa sổ 5h dễ chạm trần khi
  chạy nhiều session/task song song.
- **Workaround hiện tại:** mở từng session bấm popover để đoán, hoặc chạy tới khi bị
  reject mới biết rồi đổi account/đợi reset.

## Why now

- **Hạ tầng đã sẵn 80%:** `account.usage` (5h / weekly / opus / sonnet / overage,
  kèm `utilization`, `status`, `resetsAt`) + logic màu/đếm-ngược trong
  `SessionContextStatus.vue` đã chạy thật. Còn thiếu mỗi: loop multi-account + đẩy lên
  tray.
- **Tray đang được mở rộng** (5 đề xuất khác) — ghép usage vào tray-state chung là rẻ,
  làm chung một lần.

## Hypothesis

Nếu hiện % quota mỗi account ngay trên tray (tooltip + menu + đổi màu icon khi sắp
cạn), user sẽ chủ động giãn/đổi account **trước** khi bị reject → giảm số session/task
bị gián đoạn vì quota.

## Success criteria

- Submenu tray liệt kê **mọi** account; account OAuth/subscription hiện đúng % bucket
  5h + weekly, cập nhật khi **mở menu tray + window focus** (không timer nền).
- Account không có usage (API key / custom endpoint) hiện trạng thái "không khả dụng"
  rõ ràng — **không** báo lỗi.
- Account Codex hiện được số: sidecar **ping một call rẻ** để nạp snapshot khi snapshot
  thiếu/cũ; ping **không** ghi vào transcript session.
- Tray icon chuyển amber khi account active ≥90%, đỏ khi `rejected` (tái dùng ngưỡng
  `allowed_warning` / `rejected` đã có).
- **Notification** bắn ra khi một account chạm ≥90% (warning) hoặc `rejected`, có
  throttle (theo quy tắc không-spam của tray design) — không bắn lặp cho cùng account.
- Không gọi `/api/oauth/usage` vượt cache 60s/account; Codex ping có staleness-guard
  (chỉ ping khi snapshot thiếu/cũ), không ping lại nếu còn tươi.

## Fit with vision

| Tiêu chí | Đánh giá |
|---|---|
| Artifact-driven | N/A — đây là observability của runtime, không tạo artifact. |
| Workflow-based | Gián tiếp: giúp task/workflow dài không chết oan vì quota. |
| Human-in-the-loop | **Yes** — cho người chủ động quyết định giãn/đổi account trước checkpoint. |
| Local-first | **Yes** — đọc qua sidecar, token không rời sidecar (đẩy tray qua `tray:setState`, main không cầm token). |

## Scope hint

- **v-next** — **không** chặn chờ minimize-to-tray (#5); chấp nhận giai đoạn 1 tray
  usage chỉ tươi khi app đang mở.
- Layer chạm:
  - **UI (renderer):** fetch usage cho mọi account khi mở menu tray + focus → đẩy qua
    `tray:setState`.
  - **Electron main:** render submenu/tooltip/icon + bắn `Notification` (chuyển notify
    từ Chromium-renderer sang main — trùng hướng đề xuất #3).
  - **Sidecar:** thêm nhánh **Codex usage ping** (call rẻ để nạp snapshot, không ghi
    transcript); phần Anthropic dùng nguyên `account.usage`.
- Ước lượng: **M** (tăng từ S–M do thêm notification + Codex ping).
- Gợi ý SoC: trích logic usage trong `SessionContextStatus.vue` ra composable
  `useAccountUsage()` dùng chung cho popover + tray (Rule of Three).

## Out of scope (cho lần này)

- Usage cho account **API key** (provider không expose endpoint quota).
- Biểu đồ lịch sử usage / dự báo thời điểm cạn.
- Multi-key pool / auto-rotate (đã out of scope ở [connection-quota-handling](./connection-quota-handling.md)).
- **Background poller định kỳ** khi app đang mở — đã chốt chỉ refresh khi mở menu +
  focus (xem Resolved decisions #1).

## Resolved decisions (chốt 2026-06-15)

1. **Cadence:** chỉ refresh khi **mở menu tray + window focus** — không timer nền. Lý do:
   tránh hammer endpoint rate-limited của claude.ai và tránh Codex ping thừa.
2. **Phạm vi hiển thị:** submenu liệt kê **tất cả** account (không chỉ account active).
3. **Notification:** **Có** — bắn khi account chạm ≥90% (warning) hoặc `rejected`, có
   throttle/không lặp.
4. **Codex usage:** dùng **trick ping** — sidecar gửi 1 model call rẻ để bắt header
   `x-codex-*-used-percent` nạp snapshot (Codex không có GET usage endpoint). Ràng buộc:
   max-token tối thiểu, **staleness-guard** (chỉ ping khi snapshot thiếu/cũ), **không**
   ghi call này vào transcript/JSONL session, token ở nguyên sidecar (invariant #1).
   Lưu ý đánh đổi: ping tiêu một lượng quota rất nhỏ của chính account đang đo — chấp
   nhận được vì 1-token, nhưng BA/TL cần định nghĩa rõ ngưỡng "cũ" + max-token.
5. **Phụ thuộc #5:** **không** chặn — giai đoạn 1 chấp nhận tray usage chỉ tươi khi app
   đang mở.

## Liên kết

- [VISION](../../artifacts/VISION.md)
- [MVP scope](../requirements/mvp-scope.md)
- [Tray & Notifications design](../design/tray-and-notifications.md)
- [Connection Quota Handling](./connection-quota-handling.md) (reactive counterpart)
- [Models & Accounts](./models-and-accounts.md)
- RPC: [account.usage](../../apps/desktop/sidecar/src/methods/account.usage.ts) ·
  UI hiện tại: [SessionContextStatus.vue](../../apps/desktop/ui/components/session/SessionContextStatus.vue)
