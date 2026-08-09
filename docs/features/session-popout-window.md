# Session Popout Window — mở session ra cửa sổ OS riêng

> Trạng thái: Implemented v1 (ui-next + electron). Cho phép "bật" một session ra **một
> cửa sổ Electron riêng**, mở được **nhiều cửa sổ cùng lúc** (mỗi session một cửa sổ).
> Anh em với [preview-popout-window](preview-popout-window.md); liên quan:
> [workspace-panel](workspace-panel.md), [minimize-dock](minimize-dock.md).

## Bối cảnh / vấn đề

Sessions là màn hình một-cột-một-chi-tiết: tại một thời điểm chỉ xem được **một**
transcript. Muốn theo dõi session A đang chạy dài trong khi làm việc với session B, hay
đẩy một session sang màn hình thứ hai, thì không có cách nào — chuyển tab dự án chỉ đổi
qua lại, Minimize Dock chỉ "cất đi rồi quay lại".

**Ý tưởng:** thêm action "Mở ở cửa sổ riêng" cho session, giống hệt cái đã có cho
PreviewModal. Session tách ra thành một cửa sổ OS thực thụ — kéo sang màn hình khác,
alt-tab, đặt cạnh cửa sổ chính — trong khi cửa sổ chính tiếp tục làm việc với session
khác.

## Nguyên tắc thiết kế

- **Một implementation session duy nhất.** Popout **không** là chat thứ hai: nó load
  route `/session` và mount đúng `SessionDetail` mà cửa sổ chính dùng. Composer,
  transcript, workspace panel (Diff/Files/Plan/Terminal/Tasks/Preview), checklist,
  permission gate, fork/export — dùng chung code.
- **HAND-OFF, không phải nhân đôi.** Session đã pop out thuộc quyền **duy nhất** của cửa
  sổ đó: cửa sổ chính hiện placeholder "đang mở ở cửa sổ riêng" thay cho transcript và
  **bỏ qua** mọi engine event của session đó. Nhờ vậy không có hai transcript lệch nhau,
  không có permission prompt hiện ở hai nơi, không gửi trùng.
- **Nhiều cửa sổ, một cửa sổ cho mỗi session.** Main giữ `Map` keyed theo `engineId`: mở
  lại cùng session thì **focus cửa sổ đang có**. Cửa sổ mới cascade lệch 28px.
- **State đi qua URL, không qua bộ nhớ.** Popout nhận `?id=<engineId>` — renderer mới có
  store + bộ đếm id riêng, nên **engineId** (không phải `Session.id` số) là thứ duy nhất
  chuyển được giữa hai cửa sổ.
- **Global host dùng chung.** `AppGlobalHosts.vue` gom stack modal/toast/preview mà
  layout chính vẫn mount; popout mount đúng component đó nên confirm / preview / export /
  "Run as task" chạy y hệt, và không thể "quên" host nào khi thêm mới.

## Kiến trúc

| File | Vai trò |
|---|---|
| [electron/src/session-window.ts](../../apps/desktop/electron/src/session-window.ts) | Tạo/focus BrowserWindow popout theo `engineId`; validate id; cascade; broadcast tập session đang ở cửa sổ riêng |
| [electron/src/ipc.ts](../../apps/desktop/electron/src/ipc.ts) | `session:openWindow`, `session:closeWindow`, `session:listWindows`; **fan-out `engine:event` cho cửa sổ chính + mọi popout session** |
| [electron/src/preload.ts](../../apps/desktop/electron/src/preload.ts) | `openSessionWindow` / `closeSessionWindow` / `listSessionWindows` / `onSessionWindowsChanged` |
| [ui-next/pages/session.vue](../../apps/desktop/ui-next/pages/session.vue) | Route popout (`layout: false`) — parse `?id` → `activateWindowSession()` → `<SessionDetail>` + `<AppGlobalHosts>` |
| [ui-next/components/AppGlobalHosts.vue](../../apps/desktop/ui-next/components/AppGlobalHosts.vue) | Stack host dùng chung giữa layout chính và popout |
| [ui-next/stores/sessions.ts](../../apps/desktop/ui-next/stores/sessions.ts) | `windowedEngineIds` / `windowSessionId` / `ownsSession` (gate event) + `releaseSession` / `reclaimSession` + `openInWindow` / `closeWindowFor` |
| [ui-next/components/session/SessionHandoffCard.vue](../../apps/desktop/ui-next/components/session/SessionHandoffCard.vue) | Placeholder ở cửa sổ chính: Focus cửa sổ / Đưa về đây |

## Luồng

1. Người dùng bấm **Mở ở cửa sổ riêng** (icon `external`) trên header SessionDetail, hoặc
   chọn trong context menu của row trong session list.
2. Renderer gọi `sc.openSessionWindow(engineId, title)` → IPC `session:openWindow`.
3. Main validate `engineId` (charset slug) → trùng session thì focus cửa sổ cũ; ngược lại
   tạo BrowserWindow (preload + contextIsolation + sandbox, `applyNavigationGuards`), load
   `/session?id=…`, rồi **broadcast** tập id đang ở cửa sổ riêng cho mọi renderer.
4. Cửa sổ chính nhận broadcast → `releaseSession`: snap phần text đang gõ dở, bỏ cờ
   streaming, `loaded = false`, và đổi sang `SessionHandoffCard`.
5. Popout mount → `activateWindowSession(engineId)`: bind quyền sở hữu, `hydrate()`,
   `ensureLoaded()` (đọc transcript qua sidecar), set `activeId` — **không** đụng vào tab
   dự án (chúng persist trong localStorage dùng chung với cửa sổ chính).
6. Đóng: nút đóng native của OS (macOS còn ⌘W qua `windowMenu`), hoặc **Đưa về đây** ở
   cửa sổ chính → `session:closeWindow`. Main broadcast lại → cửa sổ chính `reclaimSession`
   (đặt `loaded = false` và nạp lại nếu session đang mở) → transcript hiện đủ những gì đã
   diễn ra ở popout.

## Quyền sở hữu event (điểm cốt lõi)

Trước đây `engine:event` chỉ gửi cho cửa sổ chính. Popout cần stream sống nên main gửi
thêm cho **mọi cửa sổ popout session** — **không** gửi cho tray popover (renderer đó chỉ
đọc snapshot; nếu nó xử lý stream sẽ thành driver thứ hai, ví dụ auto-continue một
background wake mà cửa sổ chính đang continue). Store chặn ở đầu handler:

```ts
const eid = (evt.payload as { sessionId?: unknown } | null)?.sessionId
if (typeof eid === 'string' && !ownsSession(eid)) return
```

- Popout: `ownsSession(eid) === (eid === windowSessionId)` — chỉ session của chính nó.
- Cửa sổ chính: sở hữu mọi session **không** nằm trong `windowedEngineIds`.
- Event không có `sessionId` (`engine.crashed` / `engine.fatal`) áp dụng ở mọi nơi.

Sidecar vốn đã khoá tuần tự mỗi session (`PER_SESSION_LOCKS`), nên đây là lớp bảo vệ
phía UI: đúng **một** transcript sống cho mỗi session.

## Giới hạn / gating

- **Không pop out giữa lượt đang chạy.** Nút bị disable khi session `streaming` /
  `awaiting`: lượt đang chạy stream vào bản sao message của chính renderer hiện tại, bàn
  giao giữa chừng sẽ khiến popout đứng hình tới khi lượt kết thúc. Chờ xong (hoặc huỷ)
  rồi mở. Muốn gỡ giới hạn này cần: popout hỏi `sessions.activeTurns`, bật lại cờ
  `streaming` cho message cuối **và** seed typewriter target bằng phần text đã persist.
- Session chưa từng được lưu (chưa có `engineId`) không pop out được — popout là renderer
  mới, nó đọc lại session từ sidecar.
- Xoá session ở cửa sổ chính **không** tự đóng popout của nó.
- Vị trí/kích thước cửa sổ chưa persist giữa các lần mở (giống preview popout).
- Popout không có shortcut app-wide (⌘K/⌘J/⌘G/⌘H) — chúng thuộc layout chính.
- Native notification "turn xong" (`useNativeNotify`) và **tray indicator** đọc store của
  cửa sổ chính, mà cửa sổ chính không còn theo dõi session đã bàn giao → lượt chạy trong
  popout không đẩy notification / không cộng vào badge tray. (Tray vẫn liệt kê session
  đang chạy khi mở popover, vì nó hỏi `sessions.activeTurns` ở sidecar.)

## Bảo mật

- **Invariant #4** — cửa sổ popout dùng preload chuẩn, `contextIsolation` + `sandbox`,
  không `nodeIntegration`; chịu cùng `applyNavigationGuards` (link ngoài mở bằng browser
  OS, điều hướng nội bộ đổi path bị chặn).
- `engineId` từ renderer là L1: charset-validate (`/^[a-z0-9-]+$/`) **trước khi** tạo cửa
  sổ; nó chỉ đi vào query param, **không** bao giờ thành path ở main (transcript vẫn đọc
  qua sidecar, nơi có kiểm tra path riêng).
- `session:closeWindow` chỉ địa chỉ hoá cửa sổ **theo session id** trong map do chính
  module này tạo → renderer không thể đóng cửa sổ tuỳ ý; `window:closeSelf` vẫn suy ra
  cửa sổ từ `event.sender`.
- Fan-out `engine:event` rộng hơn nhưng **không** thêm dữ liệu mới và không mở rộng ra
  ngoài: người nhận thêm chỉ là popout — cùng renderer AWOG, cùng preload, cùng nguồn
  sidecar; API key vẫn không rời sidecar (invariant #1).
