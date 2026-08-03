# Preview Modal — Back-stack (điều hướng "đi sâu / quay lại")

> Spec BA cho hành vi điều hướng của `PreviewModal` khi mở file **từ bên trong** một preview đang xem.
> Liên quan: fix issue #3 (404 khi click link trong markdown → `openLink`), [workspace-panel](./workspace-panel.md).
> Chạm: [`composables/usePreview.ts`](../../apps/desktop/ui-next/composables/usePreview.ts), [`composables/usePreviewModal.ts`](../../apps/desktop/ui-next/composables/usePreviewModal.ts), [`components/common/PreviewModal.vue`](../../apps/desktop/ui-next/components/common/PreviewModal.vue).

## Bối cảnh & vấn đề

`PreviewModal` là viewer full-window dùng chung, mount app-lifetime ở `layouts/default.vue`, drive bởi shared store `usePreview()` (`current` + `open()`/`close()`).

Fix issue #3 thêm `openLink(href)`: click link file nội bộ trong markdown đang xem → **repoint** `sharedItem.value` sang file mới (giống `openTreeFile` khi click file trong folder-tree). Nhưng repoint **thay thế** item chứ không lưu lịch sử. Hệ quả người dùng vừa báo:

> Mở xem **response** (fullscreen 1 message) → click 1 link file → file mở ra → bấm **× (Close)** kỳ vọng "đóng file để quay lại response" → thực tế **đóng cả modal**, mất luôn response đang đọc.

Nguyên nhân: không có back-stack. `close()` set `current = null` → đóng hết.

## Mô hình mong muốn

Xem PreviewModal như một trình duyệt 1 cửa sổ:

- **Mở mới (open, top-level)** — từ transcript / attachment / fullscreen response → **reset** stack, item là **gốc** (root).
- **Đi sâu (navigate-in / push)** — click link file trong markdown (`openLink`) hoặc click file trong folder-tree (`openTreeFile`) → **push** item hiện tại xuống stack, hiển thị item mới.
- **Quay lại (back / pop)** — trả về item ngay trước đó. Chỉ khi ở **gốc** (stack rỗng) mới đóng hẳn modal.
- **Đổi tại chỗ (replace)** — rename/move/reload là **cùng một file logic** ở path/nội dung mới → **replace** top, **không** push (nếu push thì Back sẽ về path cũ đã biến mất).

## Ngữ nghĩa nút điều khiển (đề xuất)

| Hành động | Khi stack rỗng (gốc) | Khi stack > 0 |
|---|---|---|
| **Back `‹`** (mới, hiện góc trái header khi depth>0) | ẩn | pop 1 cấp |
| **Esc** | đóng modal | pop 1 cấp |
| **× (Close)** | đóng modal | **đóng cả modal** (close-all) |
| **Click scrim** (`@click.self`) | đóng modal | đóng cả modal (close-all) |

Lý do (Least Astonishment): `×` và scrim mang nghĩa phổ quát "đóng cửa sổ này" — giữ nguyên để không bắt user click `×` nhiều lần khi stack sâu. Cung cấp **affordance quay lại rõ ràng** qua nút Back `‹` + phím Esc (đúng thói quen user vừa báo: bấm để "lùi").

> **Open question (UX/PO):** Có muốn `×` = "back 1 cấp khi depth>0" đúng bản năng user đã báo, thay vì close-all? Đánh đổi: hợp bản năng "đóng file" nhưng phá nghĩa phổ quát của `×` và buộc click nhiều lần để thoát stack sâu. Mặc định đề xuất: giữ close-all + thêm Back + Esc-pop.

## Phạm vi

**Trong scope**
- `usePreview.ts`: thêm `stack: PreviewRef[]` + `push()` / `replace()` / `back()` / `canGoBack`. `open()`/`restore()`/`close()` clear stack.
- `usePreviewModal.ts`: `openLink`/`openTreeFile` → `push`; `submitRename`/`reload` → `replace`; `minimize`/`doDelete`/`doClose` clear stack; `onKey` Esc → back-1-hoặc-close.
- `PreviewModal.vue`: nút Back `‹` (chỉ khi `canGoBack`), i18n, tooltip.

**Ngoài scope**
- Legacy mount qua prop `item`: `item = props.item ?? sharedItem.value` nên prop luôn thắng → repoint `sharedItem.value` không có tác dụng khi ở prop-mode. **Back-stack chỉ áp cho shared-store**. (Ghi chú: prop-mode hiện không hỗ trợ navigate-in — không xử lý ở spec này.)
- Khôi phục scroll/view của frame khi Back (nice-to-have, xem Enhancement).

**Giới hạn độ sâu:** cap mềm stack ~25 frame, vượt thì drop frame cũ nhất (chặn phình bộ nhớ với vòng lặp link trỏ nhau). Không dedupe path (giữ KISS).

## Acceptance Criteria (Given/When/Then)

**AC1 — Đi sâu rồi quay lại response**
- Given đang xem fullscreen một response (item gốc, in-memory markdown)
- When click 1 link file nội bộ trong response
- Then modal hiển thị file đó, nút Back `‹` xuất hiện ở header
- And When bấm Back (hoặc nhấn Esc)
- Then modal quay lại **đúng response** đang đọc (giữ nội dung), Back ẩn đi (đã về gốc)

**AC2 — Back ở gốc = đóng modal**
- Given đang ở item gốc (stack rỗng), Back không hiển thị
- When nhấn Esc
- Then modal đóng hẳn (`current = null`)

**AC3 — Đi sâu nhiều cấp**
- Given ở response → mở file A → trong A mở file B (stack = [response, A])
- When Back lần 1 → hiển thị A; When Back lần 2 → hiển thị response; When Back lần 3 (gốc, Esc) → đóng modal

**AC4 — × luôn đóng hẳn**
- Given stack = [response, A], đang xem A
- When bấm × (hoặc click scrim)
- Then modal đóng hẳn, stack clear (không cần pop từng cấp)

**AC5 — Folder-tree đi sâu**
- Given item gốc kind `folder` (working folder), When click file trong tree
- Then push, hiển thị file; When Back → quay lại folder-tree (giữ trạng thái đang mở của tree ở mức chấp nhận được — xem edge E7)

**AC6 — Mở mới reset stack**
- Given stack = [response, A], đang xem A
- When từ transcript mở một file khác qua `useFilePreview.open` (open top-level)
- Then stack reset về rỗng, file mới là gốc, Back ẩn

**AC7 — Rename/Move không tạo frame Back**
- Given đang xem file X (có thể đã đi sâu từ gốc), When rename/move X → X'
- Then hiển thị X' tại chỗ, **độ sâu stack không đổi**; When Back → về đúng frame trước X (không về path X cũ đã mất)

**AC8 — Minimize giữa chừng**
- Given stack = [response, A], đang xem A, When Minimize
- Then A được park vào dock, modal đóng, **stack clear**; When Restore từ dock
- Then modal mở lại đúng A, ở trạng thái **gốc** (Back ẩn) — lịch sử back là tạm thời, không park kèm

## Edge case

- **E1 — Back tới response rồi Back nữa:** ở gốc → đóng modal (AC2/AC3). Không được để "kẹt".
- **E2 — File không load được sau khi Back:** frame lưu là item gốc (vd response in-memory có `text`) → Back tái tạo đủ, hiển thị lại được. File workspace: Back → watcher refetch; nếu file đã bị xoá/đổi ngoài app → hiện status `error`/`binary` bình thường, Back vẫn về được các cấp trên.
- **E3 — Delete file đang xem sâu:** đề xuất delete → **pop 1 cấp** nếu stack>0 (về folder/response cha) thay vì đóng hẳn; ở gốc thì đóng. Folder-tree cha có thể còn hiển thị entry cũ tới khi refresh (chấp nhận / flag).
- **E4 — Dirty edit khi Back:** nếu frame hiện tại có edit chưa lưu, Back phải đi qua **confirm discard** giống `close()` hiện tại (không mất draft âm thầm).
- **E5 — Minimize khi dirty:** đã bị chặn (`canMinimize = !dirty`) — giữ nguyên.
- **E6 — Vòng lặp link (A→B→A→…):** cap mềm 25 frame, drop cũ nhất; không crash/không phình.
- **E7 — Folder-tree sâu:** state expand/selected của tree hiện reset mỗi lần `item` đổi (watcher xoá `treeChildren`/`treeExpanded`). Back về folder → tree load lại từ root, mất trạng thái expand. Chấp nhận cho v1; flag nếu UX muốn giữ.
- **E8 — Esc khi có rename/confirm dialog đang mở:** giữ ưu tiên hiện tại (Esc đóng dialog trước), chỉ khi không có dialog mới xét back/close.
- **E9 — Restore hint (takeRestore) vs Back:** `takeRestore` là one-shot cho minimize-restore; Back không tiêu thụ hint → mặc định về đầu trang (không replay scroll). Xem Enhancement.

## Enhancement (ngoài v1)

- Lưu `{ item, view, scrollTop }` theo từng frame để Back đáp đúng vị trí cuộn/chế độ đang xem trước đó.
- Breadcrumb ở header thay vì chỉ nút Back.
- Park cả stack khi minimize (khôi phục nguyên lịch sử back).

## Ưu tiên & quy mô

- **Ưu tiên:** P2 (Cao-vừa). Là hồi quy UX do fix #3: user mất chỗ đang đọc / mất response, hành vi gây bối rối và đã được report. Không crash nhưng chạm luồng dùng thường xuyên.
- **Quy mô:** **Nhỏ (S).** Khu trú 3 file UI, không đụng sidecar/IPC, không entity mới. Rủi ro thấp; chủ yếu là quản lý mảng stack + wiring nút Back/Esc.

## Local-first / restart-safe

Stack là state UI in-memory, transient — không cần persist, không ảnh hưởng offline, không event log, không auto-commit. App restart: modal đóng, stack mất (chấp nhận). Không chạm approval gate / git / notification.
