# 0076 — `/compact` không phải đường cắt: bookmark **không** bị prune ở đó

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-27
- **Người quyết định:** Tech Lead (AWOG)
- **Quan hệ:** **Amend danh sách "đường cắt" trong §Q1 của [ADR 0074](0074-session-message-anchor-and-transcript-navigation.md)** (dòng liệt kê `rewind`/`resend`/`regenerate`/`edit & resend`/**`/compact`** và cụm "cả 5 đường", cùng cụm "sáu đoạn logic" ở §Phương án đã cân nhắc). Quyết định cốt lõi của §Q1 — **neo bằng `eid` bền, không bằng chỉ số mảng**, và **một hàm prune duy nhất `pruneBookmarksTo`** — **giữ nguyên hiệu lực**; chỉ **danh sách nơi gọi** là sai. Chỗ nào ADR 0074 nói khác ADR này thì **ADR này thắng**. Phần T0a/§Q2 đã được [ADR 0075](0075-transcript-surface-scoping.md) amend, độc lập với ADR này.
- **Chặn:** không chặn gì — code đã đúng từ khi implement A1. ADR này tồn tại để **ADR 0074 không dẫn người đọc sau này làm hỏng lại**.

## Bối cảnh

ADR 0074 §Q1 liệt kê `/compact` là một trong các "đường cắt có chủ đích" — nơi message *"đã mất vĩnh viễn trên đĩa"* nên bookmark trỏ tới nó là *"rác thuần tuý ⇒ tự dọn"*. Tiền đề đó **sai**. Dev phát hiện khi implement A1; verify lại tận file:

| Sự thật | Nơi verify |
|---|---|
| `/compact` chỉ ghi checkpoint, **transcript còn nguyên** — comment nói thẳng: *"The full transcript is left intact (the UI keeps rendering every message); only the model context is cut, in buildContext"* | `sidecar/src/methods/sessions.compact.ts:10-13` |
| `compactSession()` lưu `{ ...rest, compaction }` — **không** đụng `session.messages` | `sidecar/src/sessions/store.ts:96-99` |
| Đường `/compact` phía UI **không** `slice` `s.msgs`, không ghi `bookmarks` | `stores/sessions.ts:3380-3470` (không có `msgs =`, không có `slice`) |
| `pruneBookmarksTo` có **0** call site trong đường `/compact` | `grep -n 'pruneBookmarksTo' stores/sessions.ts` |

Hệ quả nếu ai đó "sửa cho đủ" theo ADR 0074: prune ở `/compact` **xoá bookmark còn sống**. Tin nhắn vẫn nằm nguyên trong transcript, người dùng vẫn cuộn tới và đọc lại được — chỉ model là không còn thấy nó. Đó **đúng là lúc bookmark có giá trị nhất**: neo đọc lại phần vừa bị đẩy khỏi ngữ cảnh. Lỗi này im lặng (không exception, không log) và chỉ biểu hiện thành "bookmark tự biến mất" sau một lần `/compact`.

## Quyết định

**Danh sách đường cắt = đúng 3, tính theo hàm store, không theo hành động UI:**

| Đường | Hàm | Ghi chú |
|---|---|---|
| 1 | `rewind` | |
| 2 | `resend` | **gồm cả "edit & resend"** — đó chính là `resend` có `overrideText`, không phải đường thứ tư |
| 3 | `regenerate` | 2 nơi gọi prune trong cùng hàm (hai nhánh cắt), vẫn là **một** đường |

**`/compact` KHÔNG prune, KHÔNG đụng `bookmarks`.** Hồi quy chống lỗi này: **AC-P10** ([spec §5.4](../features/session-transcript-navigation.md)).

**Một ngoại lệ tường minh, không tính vào 3 đường:** `retryModel` có prune ở **nhánh fallback không-IPC** (`stores/sessions.ts:3825-3836`) — nhánh đó tự cắt `s.msgs` khi engine không có, nên prune ở đó là **đúng**. Dưới IPC nó uỷ quyền thẳng cho `regenerate`. Vì vậy `grep pruneBookmarksTo` trả về **5 dòng cho 3 đường + 1 fallback** — con số đó **không** phải dấu hiệu lệch spec.

## Phương án đã cân nhắc

- **Sửa trực tiếp ADR 0074.** Loại. `docs/decisions/README.md:73`: sau khi Accepted, nội dung ADR là **bất biến**. Tiền lệ ngay trong feature này: bản amend tại chỗ của 0074 đã bị hoàn nguyên để thay bằng ADR 0075.
- **Chỉ sửa spec + AC, bỏ qua ADR.** Loại. Đó chính là trạng thái vừa qua và QA bắt được: spec đúng, ADR sai, và ADR là thứ người đọc mở ra để hiểu *vì sao* — nó thắng spec trong đầu người đọc mới.
- **Thêm blockquote cảnh báo ở đầu §Q1 của 0074.** Loại — vẫn là sửa body ADR đã Accepted, cùng lý do trên.

## Hệ quả

- ADR 0074 **giữ nguyên từng chữ**; chỉ dòng **Trạng thái** cập nhật quan hệ amend (đúng cách 0075 đã làm).
- Ai đọc 0074 §Q1 mà chưa đọc ADR này sẽ thấy quan hệ amend ngay ở dòng Trạng thái, trước khi tới §Q1.
- **Điều kiện review:** `grep -n 'pruneBookmarksTo' apps/desktop/ui-next/stores/sessions.ts` ⇒ **5 dòng**, và **không** dòng nào nằm trong đường `/compact` (`runCompactRpc` và hàm gọi nó).
- Không đổi code, không đổi RPC, không đổi type.

## Tham chiếu

- [ADR 0074](0074-session-message-anchor-and-transcript-navigation.md) — §Q1 (neo bằng `eid`) mà ADR này amend danh sách nơi gọi
- [ADR 0075](0075-transcript-surface-scoping.md) — amend T0a/§Q2 của 0074 (độc lập)
- [ADR 0047](0047-auto-compact-context.md) — `/compact` chỉ cắt ngữ cảnh model
- [session-transcript-navigation.md](../features/session-transcript-navigation.md) — §5.4, **AC-P1**, **AC-P10**
