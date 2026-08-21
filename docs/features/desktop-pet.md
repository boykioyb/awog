# Desktop Pet (ambient status companion + mini-HUD)

## Overview

Một **con pet pixel-art nhỏ nổi trên mọi cửa sổ**, phản ánh trạng thái tổng hợp của
AWOG (đang chạy / cần bạn duyệt / đã xong) và mở **mini-HUD** khi hover — liệt kê tối
đa 3 việc đang cần chú ý, click để nhảy thẳng vào session/task, và **duyệt permission
ngay tại HUD**. Mục tiêu: **liếc mắt là biết**, không phải mở app đọc log.

Lấy cảm hứng từ Pets của ChatGPT/Codex (5/2026) — về bản chất là một *animated task
monitor*, không phải đồ chơi ảo.

## Vấn đề

AWOG chạy nhiều session + task song song. Ba kênh trạng thái hiện có đều **thụ động
hoặc phải mở ra mới thấy**:

| Kênh hiện có | Hạn chế |
|---|---|
| macOS tray title (`2▶`) + tooltip | 1–2 ký tự, không biết *việc gì*; Windows/Linux không có title |
| Tray popover ([system-tray-status](./system-tray-status.md)) | Phải click mới hiện, rồi tự đóng khi blur |
| Dock badge + native notification | Notification biến mất; badge chỉ đếm unread |

Pet lấp khoảng trống **"luôn hiện, ngoại vi tầm mắt"**: bạn đang làm việc trong IDE,
liếc góc màn hình thấy pet đang chạy → yên tâm; thấy pet vẫy tay → có việc chờ duyệt.

## Ranh giới với tray popover (tránh chồng lấn)

Đây là **hai tầng khác nhau của cùng một nguồn dữ liệu**, không phải hai bản sao:

| | Pet + HUD | Tray popover |
|---|---|---|
| Hiện khi | **Luôn** (nếu bật) | Click icon tray |
| Nội dung | Tối đa **3 dòng** việc cần chú ý + 1 permission | Bảng đầy đủ: rate limits, usage hôm nay, running, attention |
| Rate limit / usage | **Không** | Có (ưu tiên cao nhất) |
| Vai trò | Ambient — "có gì cần tôi không?" | On-demand — "xem chi tiết mọi thứ" |

Nếu một thông tin cần bảng/biểu đồ → thuộc popover, không nhét vào HUD.

## User stories

1. *Là người dùng đang code ở IDE*, tôi muốn biết AWOG chạy xong chưa mà không phải
   ⌘Tab sang app.
2. *Là người dùng*, khi một session dừng lại chờ duyệt tool, tôi muốn thấy ngay và
   **Allow/Deny tại chỗ** thay vì mở app, tìm session, cuộn xuống.
3. *Là người dùng*, tôi muốn click vào việc trong HUD để mở đúng session/task đó.
4. *Là người dùng khó chịu với thứ nổi trên màn hình*, tôi muốn tắt hẳn pet, hoặc kéo
   nó về góc tôi chọn và nó nhớ chỗ đó.

## Kiến trúc

Điểm mấu chốt: **pet KHÔNG phải driver thứ hai**. Nó là một renderer câm — nhận model
đã tính sẵn từ cửa sổ chính và gửi lệnh ngược lại. Đúng mô hình `tray:update` /
`tray:command` đã chạy ([system-tray-status](./system-tray-status.md)), chỉ giàu dữ
liệu hơn.

```
MAIN WINDOW (usePetStatus)                      MAIN PROCESS              PET WINDOW
  computed PetModel ──pet:update (debounce)──▶  petWindow.push() ──────▶  pages/pet.vue
  (sessions + tasks store, sẵn có ở useTrayStatus)                          render sprite + HUD
                                                                                │
  setPermission() / navigateTo() ◀──pet:command── ipcMain.on ◀──pet:navigate────┘
```

Hệ quả thiết kế:

- **Không đụng sidecar.** Không RPC mới, không đổi contract engine.
- **Pet không nhận `engine:event`.** Giữ nguyên fan-out hiện tại ở
  [ipc.ts:88-92](../../apps/desktop/electron/src/ipc.ts#L88-L92) (main window + session
  popout). Pet có mặt trong danh sách đó sẽ tạo driver thứ hai — đúng cái bug mà tray
  popover đã cố tình tránh.
- **Cửa sổ chính đóng (macOS)** → không còn ai push → main tự gửi `{ state: 'offline' }`
  cho pet; click pet gọi `showWindow()`.

## Trạng thái pet

Ưu tiên **giảm dần**, lấy state đầu tiên khớp:

| State | Điều kiện | Hình ảnh |
|---|---|---|
| `offline` | Không có cửa sổ chính / engine chết | Pet ngủ, xám, không animation |
| `awaiting` | `attention > 0` (session `awaiting` + `tasks.awaitingTasks`) | Pet vẫy tay, viền accent nhấp nháy chậm |
| `working` | `running > 0` (session `streaming` + `tasks.runningTasks`) | Pet gõ phím, loop 8 fps |
| `done` | `unread > 0` | Pet ngồi cạnh dấu ✓, có dot đỏ |
| `idle` | còn lại | Pet thở, 1 frame / 2s |

**`special` (skill) KHÔNG phải một state** — nó là hàng thứ 8 của sheet, phát **một
lần** đè lên hàng state đang chạy rồi trả về ngay, nên nó không cạnh tranh với bảng ưu
tiên trên. Xem [§ Skill riêng của mỗi pet](#skill-riêng-của-mỗi-pet).

Nguồn đếm **giống hệt** `useTrayStatus` ([useTrayStatus.ts:26-44](../../apps/desktop/ui-next/composables/useTrayStatus.ts#L26-L44))
— tách chung một composable `usePetStatus` dùng lại phép đếm đó, không copy logic.

## Mini-HUD

Bong bóng nằm cạnh pet (trái/phải tự lật theo mép màn hình gần nhất).

**Khi nào hiện:**

| Trigger | Hành vi |
|---|---|
| Hover pet | Mở, đóng khi rời chuột (delay 250ms chống nháy) |
| Chuyển sang `awaiting` hoặc `done` | **Auto-peek** 6s rồi tự thu (tắt được ở Settings) |
| Click pet | **Ghim** — HUD ở lại tới khi click lần nữa |

**Nội dung** (tối đa 3 dòng, ưu tiên `attention` → `running` → `unread`):

```
┌──────────────────────────────────┐
│ ⏸  Fix auth guard      cần duyệt │   ← click → mở session
│ ▶  refactor-store          62%   │   ← task đang chạy + %
│ ✓  Update changelog     đã xong  │
├──────────────────────────────────┤
│ Bash: pnpm test                  │   ← permission đang chờ (chỉ khi có)
│           [ Deny ]  [ Allow ]    │
└──────────────────────────────────┘
```

- Mỗi dòng **2 tầng**: tiêu đề + hint phải, và dưới là **preview việc đang làm** —
  text model vừa nói, hoặc tool step đang chạy (`previewOf` duyệt ngược message cuối:
  text → step → thinking), rút về 1 dòng ≤ 70 ký tự. Task thì lấy skill của phase đang
  chạy. Không có preview (session chưa nạp msgs) thì chỉ hiện tiêu đề.
- Click dòng → `PetCommand.open` mang đúng `TrayCommand` sẵn có
  ([tray.ts:10-16](../../apps/desktop/electron/src/tray.ts#L10-L16)) → cửa sổ chính
  hiện lên và mở session/task.
- Không có rate limit, không có usage, không cuộn. Quá 3 việc → dòng cuối `+N nữa`
  → mở **Activity** trong app (tray popover neo theo bounds của icon tray nên không
  mở được bằng lệnh; Activity là chỗ xem đầy đủ tương đương).

### Approve tại HUD — vẫn một driver duy nhất

Permission chờ duyệt là **state sống của cửa sổ chính** (`pendingPermission`, resolve
qua `setPermission` — [sessions.ts:3100-3126](../../apps/desktop/ui-next/stores/sessions.ts#L3100-L3126)),
không nằm trong snapshot sidecar. Nên:

1. Cửa sổ chính đưa tóm tắt vào `PetModel.permission` (**tool name + target đã rút gọn**,
   không kèm nội dung nhạy cảm, không kèm full command dài).
2. Pet gửi `PetCommand.permission { requestId, decision }`.
3. **Cửa sổ chính** thực thi: chỉ gọi `setPermission` khi `requestId` **khớp**
   `pendingPermission` hiện tại — chống duyệt nhầm một request đã bị thay thế
   (stale-guard). Không khớp → bỏ qua + hiện toast "yêu cầu đã đổi, mở app để xem".
4. Pet **không** tự gọi RPC `sessions.permission`.

Chống bấm nhầm: nút Allow chỉ hiện khi HUD **mở hẳn** (hover/ghim) — không hiện trong
auto-peek; hai nút cách nhau ≥ 12px; không có "always allow" ở pet (chỉ trong app).

## IPC

| Kênh | Hướng | Payload |
|---|---|---|
| `pet:enabled` | main window → main | `PetPrefs` — tạo/hủy/resize/di chuyển cửa sổ |
| `pet:update` | main window → main | `PetStatus` (= `PetModel` trừ `facing`) |
| `pet:model` | main → pet | `PetModel` (replay model cuối khi cửa sổ vừa load) |
| `pet:navigate` | pet → main | `PetCommand` |
| `pet:command` | main → main window | `PetCommand` (cũng là đường tray menu gửi `toggle`) |
| `pet:interactive` | pet → main | `boolean` — hit-test bật/tắt click-through |
| `pet:drag` | pet → main | `'start' \| 'end'` |
| `pet:moved` | main → main window | `{ x, y }` — vị trí nghỉ sau drag, để persist |

## Data model

```ts
// electron/src/pet-window.ts (export) — dùng chung cho preload + renderer
export type PetState = 'idle' | 'working' | 'awaiting' | 'done' | 'offline'

export type PetItem = {
  kind: 'session' | 'task'
  id: string // session: engineId ("ses-…"/slug); task: task id
  title: string // đã truncate ≤ 48 ký tự ở phía cửa sổ chính
  hint: 'awaiting' | 'running' | 'unread'
  percent?: number // chỉ task đang chạy
  preview?: string // việc đang làm, 1 dòng ≤ 70 ký tự
}

export type PetPermission = {
  requestId: string
  toolName: string
  target?: string // đã rút gọn ≤ 64 ký tự (path/command)
}

export type PetModel = {
  state: PetState
  counts: { running: number; attention: number; unread: number }
  items: PetItem[] // ≤ 3
  permission: PetPermission | null
  // Pref mà PET cần để render. Đi kèm model thay vì mở kênh riêng — cùng một nơi
  // (cửa sổ chính) tính cả hai.
  autoPeek: boolean
  // Cho pet diễn skill của pack (hàng `special`) — xem § Skill riêng của mỗi pet.
  tricks: boolean
  sprite: 'girl'
  // Cỡ SPRITE (chữ không scale theo). Pet tự scale bằng CSS transform — KHÔNG dùng
  // setZoomFactor (zoom Chromium là per-origin → phóng to cả app). Xem "Cửa sổ Electron".
  scale: number
  // Hướng nhìn. Do MAIN quyết vì chỉ nó biết cửa sổ đang ở đâu (xem "Hướng mặt").
  facing: 'left' | 'right'
}

// Cửa sổ chính đẩy mọi thứ TRỪ `facing` — nó không biết vị trí cửa sổ pet.
export type PetStatus = Omit<PetModel, 'facing'>

export type PetCommand =
  | { kind: 'open'; target: TrayCommand }
  | { kind: 'permission'; requestId: string; decision: 'allow' | 'deny' }
  // Tray menu "Toggle desktop pet" → cửa sổ chính lật pref (pref là nguồn sự thật,
  // main không tự bật/tắt sau lưng nó).
  | { kind: 'toggle' }

// Prefs main hành động lên: cửa sổ có tồn tại không, to bao nhiêu, nằm đâu.
export type PetPrefs = { enabled: boolean; scale: number; pos: { x: number; y: number } | null }
```

**Prefs** (localStorage, trong `stores/settings.ts` cùng blob appearance — không cần
IPC riêng để lưu, nhưng **phải push xuống main** vì main mới tạo được cửa sổ):

Slice `pet` trong [stores/settings.ts](../../apps/desktop/ui-next/stores/settings.ts)
(cùng blob localStorage với các slice khác):

| Field | Default | Ghi chú |
|---|---|---|
| `enabled` | `false` | **Opt-in** — thứ nổi trên mọi cửa sổ không được tự bật |
| `sprite` | `'girl'` | Pet built-in trong `PET_SPRITES` (`girl`, `shiba`, `dino`, `chicken`, `miku`); đi xuống pet trong `PetModel`. Tên lạ (pack bị gỡ giữa các bản — `shibasticker` gỡ vì trùng với `shiba`, `bichon` gỡ vì license cấm phát tán file art nên sheet không commit được) được **clamp về pet đầu tiên** lúc load store. Sheet của `shiba` + `dino` + `miku` cắt bằng [tools/sprite-cutter](../../tools/sprite-cutter/README.md): 12 frame/hàng thay vì 10/8, renderer nhận qua class `sheet12` |
| `scale` | `1` | `1 \| 1.25 \| 1.5` (`PET_SCALES`) — **chỉ cỡ sprite**, chữ trong HUD/quip/badge giữ nguyên |
| `tricks` | `true` | Cho pet diễn skill của pack (hàng `special`) — xem [§ Skill](#skill-riêng-của-mỗi-pet) |
| `autoPeek` | `true` | Auto-peek 6s; đi xuống pet **trong `PetModel`**, không phải `PetPrefs` |
| `quips` | `true` | Bong bóng thoại tếu; cũng đi trong `PetModel` |
| `quipLines` | `{}` | Lời thoại người dùng sửa, theo nhóm. Rỗng = dùng default i18n |
| `reminderMinutes` | `30` | Chu kỳ nhắc uống nước/duỗi lưng; `0` = tắt |
| `pos` | `null` | `{x,y}`; `null` = góc dưới-phải màn hình chính |

## Cửa sổ Electron (`pet-window.ts`)

```ts
new BrowserWindow({
  width: 320, height: 200,          // đủ cho sprite + HUD 3 dòng + hàng nút
  frame: false, transparent: true, hasShadow: false, backgroundColor: '#00000000',
  resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
  skipTaskbar: true, focusable: false, alwaysOnTop: true,
  webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false },
})
win.setAlwaysOnTop(true, 'screen-saver')                       // nổi trên cả fullscreen app
win.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
  skipTransformProcessType: true,   // ⚠ BẮT BUỘC — xem "Bẫy Dock icon" bên dưới
})
win.setIgnoreMouseEvents(true, { forward: true })              // mặc định click-through
applyNavigationGuards(win)                                     // bắt buộc — cùng preload
loadAppRoute(win, 'pet')
```

**Click-through + hit-test.** `forward: true` cho renderer vẫn nhận `mousemove` dù
đang xuyên chuột. Renderer hit-test cursor với bounding box của sprite/HUD → gửi
`pet:interactive` → main gọi lại `setIgnoreMouseEvents`. Ngoài hai vùng đó, cửa sổ
trong suốt hoàn toàn với chuột. **Linux**: `forward` không được hỗ trợ → không bật
click-through (cửa sổ interactive suốt); pet vẫn bấm được, đổi lại khung 320×200 ăn
click ở góc đó.

**⚠ Bẫy Dock icon (macOS).** `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen:
true })` mặc định **biến cả tiến trình thành `UIElementApplication`** — Electron làm
vậy để NSWindow nổi được trên app fullscreen, nhưng UIElement app **không có icon
Dock**. Hệ quả: bật pet lên là AWOG âm thầm biến mất khỏi Dock, và `app.dock.show()`
**không** kéo lại được ([electron#26350](https://github.com/electron/electron/issues/26350),
trích đúng `TransformProcessType(&psn, kProcessTransformToUIElementApplication)` trong
`NativeWindowMac::SetVisibleOnAllWorkspaces`). Fix: truyền
**`skipTransformProcessType: true`** — chính typings Electron mô tả cờ này là để tránh
"hide the window and dock".

Đánh đổi: bỏ transform thì **có thể mất luôn khả năng nổi trên app fullscreen** (đó là
lý do Electron transform ngay từ đầu). Chọn giữ Dock icon — nó là cửa chính của app.
Nếu sau này thực sự cần nổi trên fullscreen, đòn bẩy tiếp theo là tạo cửa sổ với
`type: 'panel'` (NSPanel) rồi kiểm tra lại trên máy thật, **không** phải bỏ cờ này.

**Hướng mặt.** Artwork của mọi pack đều **quay phải**, nên pet đặt ở nửa phải màn hình
sẽ nhìn ra ngoài mép — sai. `facing` do **main** tính (`refreshFacing`: tâm cửa sổ so
với tâm `workArea` của display đang chứa nó) và chỉ gửi lại khi **đổi**, kể cả giữa lúc
kéo — nên pet lật mặt ngay khi bạn kéo nó qua giữa màn hình. Renderer chỉ việc
`transform: scaleX(-1)` khi `facing === 'left'`. Gallery trong Settings **không** lật:
ở đó nó là ảnh chân dung, không phải trạng thái.

**Kích thước theo `scale`** — `scale` chỉ phóng **con pet**, **không** phóng chữ: HUD,
bong bóng thoại và badge đếm luôn ở cỡ design, nên đổi cỡ pet không làm chữ to/nhỏ theo.

- Main: đổi **kích thước cửa sổ** theo đúng `scale`. Cửa sổ `resizable: false` ghim
  min/max size vào kích thước hiện tại nên `setSize` bị bỏ qua — phải
  `setResizable(true)` → `setSize` → `setResizable(false)`. Cửa sổ to hơn phần nội dung
  cần là **cố ý**: đó là khoảng chừa (trong suốt, click-through) để con pet cao thêm
  không đẩy HUD ra ngoài khung.
- Renderer: `.pet-canvas` (khung design cố định `320×280`, **phải khớp**
  `BASE_WIDTH`/`BASE_HEIGHT`) **không** transform; chỉ `.pet-sprite` mang
  `transform: scale(var(--pet-scale))` + `transform-origin: bottom right`. `.pet-anchor`
  bọc ngoài lấy đúng cỡ đã scale (`calc(66px * var(--pet-scale))`, phải khớp
  `.sprite-wrap` trong `PetSprite.vue`) để rect **kéo thả + hit-test click-through**
  vẫn trùng với thứ đang vẽ.

> **⚠ KHÔNG dùng `webContents.setZoomFactor`.** Zoom của Chromium là **per-ORIGIN**,
> không per-window: pet và cửa sổ chính cùng origin (`app://bundle` hoặc dev URL) nên
> zoom pet sẽ **phóng to chữ toàn app**. Chính docs Electron ghi rõ chỗ này
> ("the zoom level for a specific domain propagates across all instances of windows
> with the same domain"). Đây là lý do `scale` nằm trong `PetModel`.

**Kéo thả.** `focusable: false` + `-webkit-app-region: drag` không đáng tin khi bật/tắt
click-through, nên drag do **main lái**: `pet:drag 'start'` → main chạy vòng lặp 16ms
đọc `screen.getCursorScreenPoint()` và `setPosition` theo offset đã chốt lúc bấm →
`'end'` dừng, gửi `pet:moved` để cửa sổ chính persist. Không có IPC mỗi frame.

**Đa màn hình.** Lúc khôi phục vị trí: nếu tâm cửa sổ không nằm trong `workArea` của
bất kỳ display nào (rút màn hình ngoài) → đặt lại góc dưới-phải màn hình chính. Clamp
trong `workArea` để không nằm dưới taskbar/Dock.

## Hiệu năng & pin

- Animation theo bậc: `done`/`offline` **tĩnh hoàn toàn**; `idle` thở 4s (nhịp rất
  chậm — đây là thứ khiến nó là *pet* chứ không phải cái icon); `working` nhún 0.9s;
  `awaiting` lắc + nháy đèn 1.4s. Chỉ `transform`/`opacity` (composite trên GPU,
  không relayout). Không `requestAnimationFrame`, không JS trong vòng lặp vẽ.
- Sprite = **PNG spritesheet + CSS `steps()`** (`background-position`), không thư viện
  animation, không canvas, **không dependency mới**. Artwork: pzUH "Cat & Dog Free
  Sprites" — **CC0**, chi tiết + công thức ghép sheet ở
  [public/pet/CREDITS.md](../../apps/desktop/ui-next/public/pet/CREDITS.md).
  Cell `132×128` (2× cỡ hiển thị ~64px cho retina). Hàng: idle / working / awaiting /
  **done** / offline + **2 hàng cảnh phụ** (working-alt, idle-alt) + **hàng `special`**
  (skill, chỉ pack cắt bằng sprite-cutter mới có). Hai layout: pack cũ `1320×896`
  (10 cột × 7 hàng), pack sprite-cutter `1584×1024` (12 cột × **8 hàng**) — renderer nhận
  layout thứ hai qua class `sheet12`. `done` có hàng riêng — pack nào có tư thế ăn mừng
  (nháy mắt, giơ biển "OK!") thì dùng, pack không có thì lặp lại một frame bình thường.
- **`chicken.png`** là sheet duy nhất **mọi hàng đều là animation thật** (artwork đặt
  riêng, 9 khối chu kỳ có nhãn): chạy khi `working`, nhảy khi `awaiting`, **đẻ trứng khi
  `done`**, mổ đất ở cảnh phụ `idle`. Nó cũng là sheet duy nhất ngoài `girl.png`
  **commit được vào git** (tự tạo, không ràng buộc phát tán). Công thức cắt + 4 cái bẫy
  (caption đè khối, đường chân theo bàn chân, ranh giới frame ở cột trống, gà không bao
  giờ bị cắt) ở [public/pet/CREDITS.md](../../apps/desktop/ui-next/public/pet/CREDITS.md).

**Lớp chuyển động (quan trọng nhất để pet trông "sống").** Mỗi state chạy **hai
animation cùng lúc**: một cái bước qua *frame* (`background-position`), một cái tạo
*chuyển động thân* (`transform` — thở, nhún, rung). Chúng đụng hai property khác nhau
nên chồng được lên nhau.

Vì sao cần: sheet loại sticker/AI được **vẽ rời từng frame**, không có khối lượng nhất
quán giữa các frame — chạy trần frame ra là mắt đọc thành "lật sticker". Nhịp thở và
nhún chính là phần liên tục mà artwork không có. Bóng đổ cũng co lại theo nhịp nhún,
nếu không thì cú nhún trông như cả tấm sticker trượt lên chứ không phải con vật đạp đất.

Hệ quả: **không cần "chế độ tĩnh" riêng**. Pack chỉ có ảnh tĩnh thì hàng của nó chỉ có
1 pose lặp lại — `steps(n)` vẫn chạy (không quét ô rỗng vì frame được nhân bản), và lớp
transform lo phần sống động.

**Mỗi ô phải chừa 3px trong suốt.** Sheet đi qua hai lần thu phóng (`background-size`
nửa kích thước, rồi `transform: scale()` theo cỡ pet). Ở tỉ lệ lẻ, bộ lấy mẫu đọc lố
qua biên ô → **lòi mảnh frame kế bên và cắt cụt frame hiện tại**. Dải trong suốt khiến
phần đọc lố rơi vào chỗ trống.

**Canh frame theo trọng tâm, không theo bbox.** Frame vẽ rời thì cái đuôi hay vệt tốc
độ kéo tâm bounding box lệch hàng chục pixel → thân trượt ngang mỗi frame ("boiling").
Canh theo **trọng tâm khối alpha** đưa dao động từ ±37px xuống ≤ ±4px. Offset phải
**kẹp trong ô** — frame rộng canh theo trọng tâm có thể ra offset âm, tràn sang ô bên
cạnh rồi bị cắt.

**Idle chỉ nên có 1 pose.** Khối idle của pack thường là nhiều tư thế *khác hẳn nhau*
(ngồi / đứng / vẫy đuôi); lật qua lại không đọc ra "đang thở" mà ra "đang đổi sticker".
Một pose + nhịp thở CSS trông sống hơn hẳn.

**Đổi cảnh.** Một lượt chạy dài mà lặp mãi một animation thì nhìn như treo, nên trong
cùng một state pet luân phiên giữa hàng chính và hàng phụ: `working` đổi mỗi **7s**
(chạy ↔ đi bộ), `idle` chủ yếu thở và **16s** mới đi dạo **3.5s**. Pack không có
animation thay thế thì hàng phụ trùng hàng chính (không đổi cảnh, không bao giờ trống).

**Pet nói chuyện.** Bong bóng thoại nhỏ phía trên pet, **nằm ngoài HUD** để pet lên
tiếng được giữa lượt chạy dài mà không phải bung cả bảng; ẩn khi HUD mở (cùng chỗ).
Hiện 6.5s, bốc ngẫu nhiên. Chỉ `working`/`awaiting` mới lặp lại (mỗi 50s) — pet lải
nhải lúc rảnh là pet bị tắt.

**Lời thoại là dữ liệu của người dùng**, sửa ở Settings → Pet: 6 nhóm (5 state +
`reminder`), mỗi nhóm một textarea, mỗi dòng một câu, có nút khôi phục mặc định từng
nhóm. Nhóm chưa đụng tới thì **không lưu gì** và chạy theo default i18n
(`pet.quip.<bucket>.<n>` trong `pet.json`, en + vi) — nên bản cài mới đổi ngôn ngữ app
là đổi luôn giọng pet; sửa rồi thì đó là chữ của bạn, không dịch nữa.

> Editor giữ **draft cục bộ, chỉ ghi khi rời ô**. Nếu computed ghi thẳng vào store mỗi
> lần gõ thì dòng trống bị cắt ngay lúc bấm Enter — không bao giờ xuống dòng được.

**Nhắc nhở định kỳ** (`reminderMinutes`, mặc định **30 phút**, chọn Tắt/15/30/60):
uống nước, duỗi lưng, nghỉ mắt. Chạy trên **đồng hồ riêng**, không reset theo state —
điểm của nó là thời gian trôi. Không bắn khi pet `offline` (không ai ở đó mà nhắc).

Ai resolve lời thoại: **cửa sổ chính**, không phải pet. Model chỉ mang `quipLines` của
state hiện tại + `reminders` + `reminderMs` — pet là renderer câm, không đọc store,
không đọc i18n.
- Tôn trọng `prefers-reduced-motion`: mọi state về ảnh tĩnh, chỉ đổi màu/badge.
- `pet:update` debounce 300ms ở cửa sổ chính (giống `sendTrayUpdate`).
- `powerMonitor` `suspend` → `win.hide()`, `resume` → `show()`.

## Skill riêng của mỗi pet

Mỗi tấm art gốc có **nhiều hơn 7 animation rất nhiều** (dino 28, miku 36, shiba 15) —
`tools/sprite-cutter` cắt hết, nhưng sheet chỉ mang được số hàng renderer biết. Hàng thứ
8 `special` là chỗ cho **một** animation "đặc sản" của pack:

| Pack | Skill | Khối nguồn |
|---|---|---|
| `dino` | phun lửa | `FIRE BREATH` (khai frame tay — xem dưới) |
| `miku` | xoay tròn, vòng năng lượng dưới chân | `SPIN` |
| `shiba` | rũ mình rồi lộn một vòng | `SHAKE` |
| `girl`, `chicken` | **không có** | tấm gốc không nằm trong repo ⇒ không cắt lại được |

**Ba trigger** (đều trong [pet.vue](../../apps/desktop/ui-next/pages/pet.vue), pet tự
quyết — không có IPC nào cho việc này):

1. **Vừa xong việc** — state đổi sang `done`. Đây là trigger đáng giá nhất: `done` là
   state người dùng vui khi thấy, và vốn là hàng ít chuyển động nhất.
2. **Bấm vào pet** — cùng cú click pin/unpin HUD.
3. **Thỉnh thoảng lúc rảnh** — `TRICK_IDLE_MS` = 3 phút, **chỉ khi `idle`**. Lúc đang
   chạy thì hàng state đã động sẵn và người dùng đang nhìn HUD, diễn thêm là tranh chỗ.

Công tắc: **Settings → Pet → "Khoe skill"** (`settings.pet.tricks`, mặc định BẬT) →
`PetModel.tricks`. Tắt là dừng cả timer, không chỉ frame kế tiếp.

Cơ chế: hàng `special` là hàng **duy nhất không loop** —
`animation: play12 1s steps(12) 1 both`. Page bật cờ `special`, hết `SPECIAL_MS` (1s,
**phải khớp** duration trong CSS) thì tắt để pet về hàng state. Gọi lại lúc đang diễn thì
**bỏ qua**, không xếp hàng: CSS animation không restart được nếu không nhả class một
frame, và không ai cần một hàng đợi trò. Pack không có hàng đó thì `PetSprite` **phớt lờ**
cờ này (danh sách `SHEET_12`) chứ không vẽ ô trong suốt.

> **Vì sao hàng lửa của dino phải khai frame tay.** Tấm gốc vẽ hàng `FIRE BREATH` như một
> cuộn phim của *viên đạn*: "dino + lửa" là **một** component 142px, rồi ba quả cầu lửa và
> khói là các pose **không có con dino**. Để bộ tách frame tự chạy thì (a) nó chặt đôi
> chính component đó — con dino rời khỏi tia lửa của nó, và (b) pet **biến mất 6/12 frame**.
> Còn gộp cả 142px vào một ô thì `plan_layout` phải hạ tỉ lệ **cả sheet** 22% (một tỉ lệ
> cho mọi hàng) ⇒ dino teo lại ở **mọi** state chỉ vì một hàng. Nên preset khai
> `frame_regions` tay: 3 pose lấy đà, rồi **cắt ngắn chính tia lửa ngay trong ô**
> (56→96px, đều ≤ 111px = ngân sách rộng ở tỉ lệ hiện tại) cho tia phun ra rồi rút lại,
> cuối là pose thu người. Chi tiết + toạ độ:
> [presets/dino.yaml](../../tools/sprite-cutter/presets/dino.yaml).

## Settings UI

**Mục riêng "Pet"** trong nav Settings ([SettingsPet.vue](../../apps/desktop/ui-next/components/settings/SettingsPet.vue)),
không nhét vào Appearance: pet là một **surface riêng** (cửa sổ trên desktop) và phần
chọn sprite cần chỗ để lớn thành gallery thật.

- Toggle bật/tắt · **gallery chọn pet** · segmented kích thước · toggle auto-peek ·
  toggle "Nói linh tinh" · toggle **"Khoe skill"** · nhắc nhở định kỳ · nút "Đặt lại vị trí".
- Gallery render **chính `PetSprite`** đang chạy vòng idle — cái bạn chọn đúng là cái
  sẽ hiện trên desktop, và không có bản preview thứ hai để lệch với thật.
- Chuỗi: `settings.pet.*` trong `settings.json`; chuỗi trong cửa sổ pet ở `pet.json`.

## Bảo mật

Chiếu 8 invariant ([.claude/rules/security.md](../../.claude/rules/security.md)):

- **#4 IPC boundary** — pet là renderer chuẩn: `contextIsolation` + `sandbox` +
  `applyNavigationGuards`. Không `fs`/`child_process`.
- **#1 API key** — `PetModel` chỉ chứa tiêu đề, số đếm, tool name. Không token, không
  path tuyệt đối đầy đủ, không nội dung file.
- **L1 từ pet** — `PetCommand` đi từ renderer nên **cửa sổ chính validate trước khi
  hành động**: `requestId` phải khớp pending hiện tại; `TrayCommand` đi qua đúng
  đường resolve sẵn có (`openByEngineId`, `selectTask`).
- Không cổng mạng, không telemetry, không sidecar RPC mới → không mở surface mới.

Không cần ADR: không thêm dependency, không đổi contract sidecar, không đổi mô hình dữ
liệu. Nếu sau này pet đọc/ghi trực tiếp qua sidecar → lúc đó mới cần ADR.

## File chạm

**Electron** (nhớ: sửa `electron/src/*` phải rebuild + restart, UI thì hot-reload):

- `src/pet-window.ts` **(mới)** — vòng đời cửa sổ, click-through, drag loop, clamp màn hình, `push(model)`, `markOffline()`.
- `src/main.ts` — `setupPetBridge()` (5 kênh `pet:*`), `offline`/close khi mất cửa sổ chính, `petWindow.close()` ở `before-quit`.
- `src/preload.ts` — `sendPetPrefs`, `sendPetUpdate`, `onPetModel`, `sendPetCommand`, `onPetCommand`, `onPetMoved`, `setPetInteractive`, `sendPetDrag`.
- `src/tray.ts` — dep `togglePet` + mục "Toggle desktop pet" trong menu native (fallback khi lỡ tắt/mất pet).

**Renderer (ui-next):**

- `pages/pet.vue` **(mới)** — `definePageMeta({ layout: false })`, nền trong suốt, hit-test + drag + auto-peek.
- `components/pet/PetSprite.vue`, `components/pet/PetHud.vue` **(mới)**.
- `public/pet/{cat,dog}.png` + `public/pet/CREDITS.md` **(mới)** — spritesheet CC0 đã ghép + nguồn/license/công thức sinh lại.
- `composables/usePetStatus.ts` **(mới)** — chạy ở cửa sổ chính: push prefs + `PetModel`, xử lý `pet:command` (open / permission / toggle) + `pet:moved`.
- `composables/useStatusSummary.ts` **(mới)** — `useStatusCounts()` + `useStatusRouting()` dùng chung cho tray và pet (trước đó nằm inline trong `useTrayStatus`).
- `composables/useTrayStatus.ts` — chuyển sang dùng composable chung.
- `layouts/default.vue` — mount `usePetStatus()`.
- `stores/settings.ts` — slice `pet` + `updatePet` + `PET_SCALES`.
- `components/settings/SettingsPet.vue` **(mới)** — mục Settings riêng: toggle / gallery chọn pet / size / auto-peek / reset vị trí.
- `components/settings/sections.ts` + `SettingsPane.vue` — đăng ký mục nav `pet` (icon `smile`).
- `types/awog-bridge.d.ts` — `AwogPet*` + method bridge (optional để shell cũ degrade).
- `i18n/locales/{en,vi}/pet.json` **(mới)** + key `settings.appearance.pet.*` trong `settings.json`.

## Edge case

| Tình huống | Xử lý |
|---|---|
| Cửa sổ chính đóng (macOS) | Main gửi `state: 'offline'`; click pet → `showWindow()` |
| Cửa sổ chính đóng (Win/Linux) | **Đóng luôn pet** — app quit ở cửa sổ cuối, một pet còn mở sẽ khiến `window-all-closed` không bao giờ bắn và app treo trong tray |
| Session đã pop-out sang cửa sổ riêng | Cửa sổ chính bỏ qua event của session đó (`ownsSession`) → đếm có thể **stale**. P1 chấp nhận + ghi nhận; xem Open questions |
| Engine chết / heartbeat kill | `offline` |
| Browser-dev (không bridge) | `usePetStatus` no-op; route `/pet` mở được nhưng câm |
| Permission bị thay thế trước khi bấm | Stale-guard → bỏ qua + toast ở app |
| Rút màn hình ngoài | Clamp về màn hình chính |
| Screen sharing / trình chiếu | P1 không tự ẩn (xem Out of scope) |
| Bật pet làm mất icon Dock (macOS) | **Đã fix** — `skipTransformProcessType: true`; đừng bỏ cờ này |
| Đổi size pet phóng to chữ cả app | **Đã fix** — bỏ `setZoomFactor` (per-origin), scale bằng CSS transform trong pet |
| Mở 1 session từ HUD làm session khác mất dấu unread | **Đã fix** (bug có sẵn ở store `sessions`, pet làm nó lộ ra): click ở HUD gọi `showWindow()` → cửa sổ `focus` → listener cũ xoá unread của session **đang mở** ngay lập tức, dù cú click đó nhắm tới session khác. Giờ hoãn `READ_DWELL_MS` và `activate()` huỷ hẳn lệnh hoãn đó |
| Kéo pet → "An object could not be cloned" | **Đã fix** — `pos` từ `pet:moved` đi qua contextBridge nên **không** phải plain object; dựng lại field-by-field ngay tại handler trước khi cất vào store, và pick primitive khi gửi `pet:enabled`. Quy tắc chung: **giá trị nhận từ IPC không được cất rồi gửi ngược lại nguyên trạng** |
| Pet có nổi trên app fullscreen không | Chưa xác nhận trên máy thật sau khi bỏ transform — nếu không, dùng `type: 'panel'` |
| Linux không hỗ trợ `forward: true` | Không bật click-through — cửa sổ interactive suốt (`SUPPORTS_CLICK_THROUGH` trong pet-window.ts) |

## Out of scope (P2+)

- **Import** spritesheet tùy chỉnh của người dùng (kể cả sheet tải từ ChatGPT), pet
  marketplace. *(Chọn giữa các sprite **có sẵn** thì đã có: cat/dog — pack CC0 kèm 2
  nhân vật nên picker gần như miễn phí.)*
- Rate limit / usage trong HUD (thuộc tray popover).
- "Always allow" từ pet.
- Tự ẩn khi đang chia sẻ màn hình.
- Pet trên Mobile Remote Control PWA.
- Pet "nói chuyện"/tương tác chat.

## Open questions

1. ~~**Ai vẽ sprite?**~~ **Đã chốt**: dùng pack CC0 của pzUH (mèo + chó, 8 state gốc →
   AWOG dùng 4). Xem [CREDITS.md](../../apps/desktop/ui-next/public/pet/CREDITS.md).
   Còn một điểm thẩm mỹ để bạn quyết: state `offline` đang dùng tư thế `Dead` của pack
   (nằm, mắt X) ở 45% opacity — đọc như "đang ngủ" ở cỡ nhỏ, nhưng nếu thấy phản cảm
   thì đổi sang frame `Idle` làm mờ.
2. **Session pop-out làm đếm stale** — sửa bằng cách để mỗi popout push `PetModel` phần
   của nó rồi main merge? Sẽ có nhiều nguồn; cần cân nhắc ở P2.
3. **Mặc định bật hay tắt?** Spec đang chọn **tắt** (opt-in). Nếu muốn discoverability
   cao hơn thì bật lần đầu kèm tooltip hướng dẫn tắt.
4. Windows: `focusable: false` + `alwaysOnTop('screen-saver')` có bị hạ khi app khác
   vào fullscreen exclusive không — cần thử trên máy thật.
