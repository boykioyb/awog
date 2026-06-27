# System Tray Status (styled tray popover)

Biến **system tray** thành một bảng trạng thái **có style đẹp**: hiển thị
**Provider rate limits** (thanh % màu), **Usage hôm nay**, **Running**, **Cần xử lý**
— click để nhảy thẳng vào app — kèm **chỉ báo số đang chạy** cạnh icon (macOS) và
**notification** khi có việc cần chú ý.

## Vì sao là popover window (không phải native menu)

Menu native của Electron (`Tray`/`Menu`) chỉ render **text rows của OS — không thêm
được CSS, progress bar, màu, layout**. Để có giao diện đẹp (bar % màu như trong
Activity, card), phần nội dung phải nằm trong một **cửa sổ popover không khung
(frameless `BrowserWindow`)** neo dưới icon tray, render bằng Nuxt route
`/tray-popover` → tái dùng được component `ActivityRateLimit`, theme token, v.v.

- **Click trái** icon tray → mở/đóng **popover đẹp** (UI chính).
- **Click phải** icon tray → **menu native tối giản** (Show AWOG / Toggle browser / Quit) làm fallback.

## Phạm vi (đã chốt)

| Phần | Quyết định |
|---|---|
| UI | Popover window có style; rate limits → usage → running → attention. |
| Rate limits | **Ưu tiên cao nhất** — section đầu, dùng `ActivityRateLimit` (bar màu + reset). |
| Chỉ báo icon | **Số đang chạy** cạnh icon (macOS `tray.setTitle`, vd `2▶`; rỗng khi 0) + tooltip. |
| Notification | Giữ turn-complete; **bắn thêm** khi có session/`task` mới cần xử lý. |

## Kiến trúc

Hai renderer + main:

```
MAIN WINDOW (useTrayStatus)                MAIN PROCESS
  push {macTitle, tooltip} ──tray:update──▶ updateTray() → setTitle + setToolTip
  onTrayCommand ◀─────tray:command──────── relay (showWindow + send)
  → openActivity / setActive / selectTask          ▲
                                                    │ tray:navigate
TRAY POPOVER WINDOW (pages/tray-popover.vue)        │
  tự fetch rate limits + usage + running/attention  │
  click item ──window.awog.sendTrayCommand──────────┘   (main: hide popover + showWindow + send tray:command)

TRAY (tray.ts):  left-click → popover.toggle(bounds)   right-click → native menu
```

Lý do popover **tự fetch** thay vì nhận model từ main: nó là **renderer riêng**, và
main chỉ forward `engine:event` cho main window — nên popover không có live event;
nó load snapshot khi mount + refresh mỗi lần cửa sổ được focus (mỗi lần mở).

### IPC

| Kênh | Hướng | Payload |
|---|---|---|
| `tray:update` | main window → main | `{ macTitle, tooltip }` |
| `tray:navigate` | popover → main | `TrayCommand` |
| `tray:command` | main → main window | `TrayCommand` |

```ts
type TrayCommand =
  | { kind: 'activity' }
  | { kind: 'session'; id: number }
  | { kind: 'task'; id: string }
```

## Nguồn dữ liệu (popover renderer)

| Section | Nguồn |
|---|---|
| Rate limits | `ActivityRateLimit` (per account Anthropic/OpenAI) → `account.usage`. |
| Usage hôm nay | `activity.summary` range `1d` → `totals.totalTokens` + `totals.costUsd`. |
| Running | `tasks.runningTasks` (+ `progressOf` → %) + sessions `status==='streaming'`. |
| Cần xử lý | sessions `status==='awaiting'` + `tasks.awaitingTasks`. |

## Notification (mở rộng `useNativeNotify`)

- Giữ: turn settle (streaming/awaiting → done/error) khi cửa sổ ẩn.
- Thêm: session mới vào `awaiting` + task mới vào `awaitingTasks`. Cùng gate: cửa sổ
  ẩn + permission; click → focus. Seed lần đầu để không bắn cho snapshot hydrate.

## File chạm

**Electron:**
- `src/popover.ts` (mới) — `TrayPopover`: tạo/đặt vị trí/show/hide frameless window dưới icon.
- `src/window.ts` — `loadAppRoute(win, route)` (dev URL / `app://`).
- `src/tray.ts` — left-click → popover; right-click → native menu; `updateTray({macTitle,tooltip})`.
- `src/main.ts` — wire popover vào tray deps + `ipcMain.on('tray:update' | 'tray:navigate')`.
- `src/preload.ts` — `sendTrayUpdate` / `onTrayCommand` / `sendTrayCommand`.

**Renderer (ui-next):**
- `pages/tray-popover.vue` (mới) — popover có style (layout:false), reuse `ActivityRateLimit`.
- `composables/useTrayStatus.ts` — push indicator + route `tray:command` (main window).
- `composables/useNativeNotify.ts` — thêm attention notification.
- `layouts/default.vue` — mount `useTrayStatus()`.
- `i18n/locales/{en,vi}/tray.json` (mới) + `command-palette.json` (key notify).

## Ghi chú

- Browser-dev (không bridge): `useTrayStatus` no-op; route `/tray-popover` vẫn mở được nhưng không có dữ liệu sidecar.
- `tray.setTitle` chỉ macOS; Win/Linux dùng tooltip + vị trí popover phía trên taskbar.
- Cửa sổ popover **opaque** (bg theme tự vẽ) cho ổn định đa nền tảng — không bo góc trong suốt.
- Đổi `electron/src/*` cần **rebuild + restart app** (UI hot-reload, main/preload thì không).
