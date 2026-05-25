# Tray Menu & Notification Flow

Đặc tả UX và luồng dữ liệu cho system tray và native notification của AWOG. Bám sát mục tiêu của [ADR 0006](../decisions/0006-tauri-shell-for-nuxt.md): task chạy dài tiếp tục sống khi đóng cửa sổ, người dùng được kéo trở lại khi cần.

## Mục tiêu UX

- Người dùng có thể đóng cửa sổ và yên tâm task vẫn chạy.
- Người dùng nhìn vào tray là biết hệ thống đang ở trạng thái nào (idle / running / cần chú ý).
- Notification chỉ bắn ra khi đáng để ngắt — không spam.
- Một click vào notification đưa người dùng đến đúng artifact / task liên quan.

## Trạng thái Tray Icon

Icon thay đổi theo trạng thái tổng hợp của tất cả task trong workspace:

| Trạng thái | Khi nào | Hình ảnh gợi ý |
|---|---|---|
| **Idle** | Không task nào ở `Running` hay `WaitingApproval` | Logo AWOG đơn sắc |
| **Running** | Có ít nhất 1 task `Running`, không có cảnh báo | Logo + indicator xanh / spinner nhỏ |
| **Waiting Approval** | Có ít nhất 1 task `WaitingApproval` | Logo + dot cam |
| **Failed** | Có task `Failed` chưa được xem | Logo + dot đỏ |

Quy tắc ưu tiên (cao → thấp): **Failed > Waiting Approval > Running > Idle**.

## Tray Menu

```
┌─────────────────────────────────────┐
│  AWOG                               │
│  Workspace: ~/awog-workspace        │
├─────────────────────────────────────┤
│  Mở AWOG                            │
├─────────────────────────────────────┤
│  2 task đang chạy            ▸      │
│    feature-pipeline #a3b1            │
│    refactor-auth     #c882           │
├─────────────────────────────────────┤
│  1 task chờ approval         ▸      │
│    architecture review #a3b1         │
├─────────────────────────────────────┤
│  Task gần đây                ▸      │
│    ✓ qa-report #f01a (5 phút trước) │
│    ✗ deploy-check #b211 (1g trước)  │
├─────────────────────────────────────┤
│  Settings                           │
│  Quit AWOG                          │
└─────────────────────────────────────┘
```

### Quy tắc menu

- **Mở AWOG** — bật cửa sổ chính, focus.
- **Section "đang chạy"** — chỉ hiện khi có task `Running`. Click vào item → mở cửa sổ tại trace view của task đó.
- **Section "chờ approval"** — chỉ hiện khi có task `WaitingApproval`. Click → mở cửa sổ tại artifact đang chờ duyệt.
- **Section "gần đây"** — 5 task `Completed`/`Failed` gần nhất. Tự xóa khi đã đóng cửa sổ chính sau khi xem.
- **Settings** — mở cửa sổ tại tab Settings.
- **Quit AWOG** — yêu cầu xác nhận nếu còn task `Running` (ngăn vô tình tắt khi đang chạy).

## Triggers Notification

Native notification (Tauri notification API) bắn ra khi:

| Trigger | Title | Body | Click action |
|---|---|---|---|
| Task chuyển `WaitingApproval` | "Cần phê duyệt" | `{workflow}` — `{artifact}` | Mở artifact ở approval view |
| Task chuyển `Completed` | "Task xong" | `{workflow}` hoàn tất sau `{duration}` | Mở trace view của task |
| Task chuyển `Failed` | "Task thất bại" | `{workflow}` — `{error tóm tắt}` | Mở trace view tại bước fail |
| Sidecar crash / restart | "AWOG engine đã khởi động lại" | Một số task có thể cần rerun | Mở dashboard |

### Quy tắc không spam

- **Im lặng khi cửa sổ đang focus** — không bắn notification cho task user đang nhìn.
- **Throttle**: tối đa 1 notification mỗi 10 giây cho cùng một task; gộp nếu nhiều event cùng task xảy ra trong cửa sổ này.
- **Batch khi >3 task hoàn tất trong 30 giây**: gộp thành "N task vừa hoàn tất" thay vì N notification riêng.
- **Không notify cho event nội bộ** — tool call, sub-agent, artifact read/write. Chúng chỉ hiển thị trong trace, không quấy người dùng.

## Luồng dữ liệu

```
Execution Engine (sidecar)
   │
   │  emit notification JSON-RPC qua stdout
   │  { method: 'event', params: { type: 'task_status', taskId, status, ... } }
   ▼
Tauri Shell (Rust)
   │
   │  1. Cập nhật state tray (re-render menu nếu cần)
   │  2. Đánh giá trigger → có bắn notification không?
   │  3. Throttle/batch logic
   │  4. Nếu có:  emit OS notification qua Tauri notification API
   │  5. Forward event tới webview qua emit (`engine_event`)
   ▼
Webview (Nuxt UI)
   │
   │  listen('engine_event') → cập nhật UI realtime
```

### Khi user click notification

```
OS notification click
   │
   ▼
Tauri Shell
   │  1. Show window (nếu đang ẩn)
   │  2. Focus window
   │  3. emit('navigate', { route: '/tasks/:id', ... }) tới webview
   ▼
Webview (Nuxt)
   │  router.push() đến đúng route
```

## Hành vi đóng cửa sổ

- Click "X" trên cửa sổ chính → **ẩn cửa sổ**, không thoát app. Tray icon vẫn còn.
- Lần đầu user đóng cửa sổ trong khi có task `Running`, hiện toast trong window 3 giây: *"AWOG vẫn chạy ở tray. Click icon trên menu bar để mở lại."*
- macOS: theo convention OS, app vẫn ở dock; click dock icon = "Mở AWOG".
- Windows / Linux: chỉ còn tray icon; toast hướng dẫn được hiển thị một lần duy nhất.

## Quit Confirmation

Khi user chọn **Quit AWOG**:

- Nếu không task `Running`: thoát luôn.
- Nếu có task `Running`: hiện dialog:
  > **Còn `N` task đang chạy. Thoát ngay sẽ dừng các task đó.**
  > [Thoát anyway] [Hủy]
- `WaitingApproval` không chặn quit — task tự lưu state và resume khi mở lại app.

## Câu hỏi mở

- Notification có cần "Approve / Reject" action button trực tiếp không (OS có hỗ trợ — macOS có, Windows tùy version)? Có thể giảm friction nhưng phá vỡ nguyên tắc "review artifact trước khi quyết".
- Có hỗ trợ "Do Not Disturb" mode trong app (user tắt mọi notification trừ Failed)?
- Khi máy sleep và app tiếp tục chạy (model API call dài), behavior khi máy wake lên thế nào?
