# Feature Spec: Chặn thao tác phá huỷ transcript trong Sessions

> **Brief:** [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md)
> **Status:** Draft — Q1/Q2/Q3 **và TL-1** đã chốt (§12). Không còn open question.
> **Last updated:** 2026-08-26
> **Layer:** UI + **một** thay đổi có chủ đích ở `stores/sessions.ts` (vá bug persist của `rewind`, §4.8). Không sidecar mới, không RPC mới, không storage, **không ADR**, không infosec.
> **Ship làm 2 lát (TL-1):** **B1** = gate + danger hover + i18n (**độc lập, ship ngay**) · **B2** = §4.8 vá persist `rewind` (**sau T0c** của Brief A). Xem §12.2 + §16.
> **Spec anh em:** [session-transcript-navigation.md](./session-transcript-navigation.md) (Brief A) — **phải khớp thứ tự cắt** (§6) **và** là **dependency** của B2 (T0c: `eid` cho user/system).

## 1. Tóm tắt

Footer của mỗi message trong Sessions hiện có tới **9 nút** (assistant) / **6 nút** (user bubble),
cùng màu `textDim`, cùng cỡ 13px, **luôn hiện**. Trong số đó có những nút **cắt transcript không
hoàn tác được** nằm sát cạnh những nút hoàn toàn vô hại (copy, quote, fullscreen).

Feature này **không thêm nút nào, không dựng modal nào**. Nó làm bốn việc:

1. Chèn `await confirm({...})` — dùng lại `useConfirm()` + `ConfirmDialogHost` đã có — trước **4**
   hành động cắt transcript: `rewind`, `resend`, `edit & resend`, `regenerate`; **chỉ khi thao tác
   thật sự làm mất message** (`lostCount ≥ 1`, §4.4).
2. Hộp thoại nêu **con số cụ thể** số message sẽ mất, và với 3 hành động chạy lại thì thêm một dòng
   nhắc **tốn thêm một lượt gọi model**.
3. Tô `danger` khi hover cho **5 hành động** destructive — 4 hành động trên **+ `retryModel`**
   (nó cũng cắt transcript, chỉ là không bị gate — §4.3).
4. **Vá bug persist của `rewind`** (§4.8): hôm nay `rewind` chỉ cắt trên đĩa ở một phần các ca, khiến
   câu "Không thể hoàn tác" trong hộp thoại không đúng sự thật.

**6 hành động còn lại** (`copy`, `quote`, `fullscreen` ×2, `fork`, `branch`, `retryModel`) **không**
bị hỏi — ràng buộc cứng chống confirm-fatigue, xem §4.3.

> **Việc (4) tách sang lát B2** vì nó phụ thuộc `eid` cho user/system (Brief A **T0c**) — xem TL-1 (§12.2).
> Hệ quả bắt buộc: trong lát **B1**, hộp thoại `rewind` **không được** chứa câu "Không thể hoàn tác"
> (§7.1) — một hộp thoại an toàn không được nói điều mình chưa làm được.

## 2. Hiện trạng đã verify (bằng chứng file:line)

Mọi khẳng định dưới đây đọc trực tiếp từ code, không suy đoán.

### 2.1. Hạ tầng confirm

| Sự thật | Bằng chứng |
|---|---|
| `confirm(opts)` trả `Promise<boolean>`, option: `title`, `description`, `confirmLabel`, `cancelLabel`, `kind: 'danger' \| 'primary'` (mặc định `'danger'`) | [`composables/useConfirm.ts:11-53`](../../apps/desktop/ui-next/composables/useConfirm.ts) |
| Singleton module-level: mở confirm thứ hai khi còn một cái đang chờ ⇒ **cái cũ tự resolve `false`** | `useConfirm.ts:40-43` |
| `settle(ok)` chỉ chạy một lần (`if (!state.open) return`) — không có double-resolve | `useConfirm.ts:57-63` |
| Host bind vào singleton, render qua `LibraryConfirmDelete` | [`components/common/ConfirmDialogHost.vue:5-20`](../../apps/desktop/ui-next/components/common/ConfirmDialogHost.vue) |
| Nhãn nút confirm mặc định = `common.delete` khi `kind='danger'`, **override được** bằng `confirmLabel` | [`components/library/LibraryConfirmDelete.vue:29`](../../apps/desktop/ui-next/components/library/LibraryConfirmDelete.vue) |
| `description` render với `white-space: pre-wrap` ⇒ **xuống dòng bằng `\n` hoạt động** (dùng cho dòng phụ nhắc chi phí) | `LibraryConfirmDelete.vue:106-111` |
| Esc = cancel; click ra ngoài scrim = cancel; `Teleport to body`, z-index 200 | `LibraryConfirmDelete.vue:3, 62-66, 71-78` |
| Tiền lệ ngay trong Sessions: `SessionList`, `SessionListItem`, `SessionDetail`, `SessionTabBar` đều đã `const { confirm } = useConfirm()` | `SessionList.vue:336,344,665`; `SessionListItem.vue:162`; `SessionDetail.vue:447`; `SessionTabBar.vue:590` |

### 2.2. Câu hỏi mở #1 của brief — popout CÓ mount `ConfirmDialogHost`

**Trả lời dứt khoát: CÓ.** Không có nguy cơ treo promise.

- [`components/AppGlobalHosts.vue:11`](../../apps/desktop/ui-next/components/AppGlobalHosts.vue) — `<ConfirmDialogHost />` nằm trong stack host dùng chung.
- [`pages/session.vue:7`](../../apps/desktop/ui-next/pages/session.vue) — cửa sổ popout mount `<AppGlobalHosts />` (route `layout: false`, `pages/session.vue:29`).
- [`layouts/default.vue:43`](../../apps/desktop/ui-next/layouts/default.vue) — cửa sổ chính mount **cùng** component đó.
- Comment tại `AppGlobalHosts.vue:28-38` nói rõ mục đích: *"a confirm(), a toast, a preview … must work identically in both windows"*.

⇒ Rủi ro "popout không có host ⇒ `confirm()` treo vĩnh viễn ⇒ hành động im lặng không chạy" **không tồn tại**.
Vẫn giữ **AC-G15** như một **test hồi quy** để lần refactor sau không lỡ tay gỡ host ra khỏi popout.

Lưu ý phụ (đúng, không ảnh hưởng): mỗi renderer có **một singleton `useConfirm()` riêng** (module-level
trong từng cửa sổ). Cửa sổ chính và popout không chia sẻ state dialog — đúng mô hình hand-off của
[session-popout-window.md](./session-popout-window.md) (`ownsSession` gate).

### 2.3. Store — hành vi thật của 6 action

Tất cả ở [`stores/sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts):

| Action | Dòng | Sự thật đã verify |
|---|---|---|
| `regenerate(id, index)` | 3595-3637 | `async`. Guard **kép**: `if (regenInFlight.has(id)) return` (3600) + `if (s.msgs.some(m => m.role==='assistant' && m.streaming)) return` (3601). Cắt `msgs.slice(0, index)` (3604) → lùi tìm user turn gần nhất `ui` (3607-3608) → cắt tiếp `slice(0, ui)` (3611) → **`await sc.request('sessions.truncate')`** (3623) → `void sendMessage(...)` (3628). `finally` xoá `regenInFlight` (3635). |
| `resend(id, index, overrideText?)` | 3667-3693 | `async`. Chặn khi có turn đang streaming (3673) — **không** có `regenInFlight`. Cắt `slice(0, index)` (3678) → `await sessions.truncate` (3687) → `void sendMessage` (3692). `overrideText` chính là đường "edit & resend". |
| `rewind(id, index)` | 3651-3661 | **Đồng bộ**, **không** có guard streaming. Cắt `slice(0, index)` (3654). Chỉ gửi RPC `sessions.rewind` khi `msgs[index-1]` là **assistant có `eid`** (3656-3659) ⇒ **bug persist**, xem §4.8. |
| `retryModel(id, index)` | 3639-3649 | Dưới IPC (chế độ chạy thật) nó **gọi thẳng `regenerate(id, index)`** (3642-3644) ⇒ **cắt transcript + tốn 1 lượt model**, y hệt `regenerate`. Không gate (§4.3) nhưng **có** tô danger. |
| `fork(id, index, suffix)` | 3695-3747 | Clone `msgs.slice(0, index + 1)` sang **session mới**; session gốc **không đổi**. An toàn thật. `branch` = cùng hàm, `suffix='branch'` (`SessionMessageItem.vue:459`). |
| `addQuote` / `removeQuote` | 3759-3789 | Chỉ đụng `s.followups`, không đụng `msgs`. |

> **Boy Scout (bắt buộc sửa trong PR này):** comment ở `sessions.ts:3598-3599` viết *"same guard `resend` uses"*
> khi nói về `regenInFlight` — **sai**. `regenInFlight` chỉ xuất hiện ở 3593 / 3600 / 3602 / 3635, toàn bộ
> nằm trong `regenerate`; `resend` **chỉ** có guard streaming (3673). Sửa comment cho đúng, **không** thêm
> `regenInFlight` vào `resend` (việc đó nằm ngoài phạm vi — và §4.6 đã chặn ca re-entry thực tế).

**Nguồn message KHÔNG persist (quan trọng cho §4.8):** store tự chèn message hệ thống cục bộ
`{ role: 'system', text: ENGINE_UNAVAILABLE }` ở **3 chỗ** — `sessions.ts:2934` (không có bridge),
`3632` (regenerate thất bại), `3647` (retryModel thất bại). Những message này **không bao giờ** đi ra
sidecar ⇒ **không có `id` trên đĩa** ⇒ **không bao giờ có `eid`**, kể cả sau T0c. §4.8 phải chịu được chúng.

### 2.4. UI — footer message

Tất cả ở [`components/session/SessionMessageItem.vue`](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue):

- Footer **user bubble**: 6 nút cứng trong template, dòng 46-63.
- Footer **assistant**: render từ mảng `msgActions` (503-518), qua `v-for` ở 137-141.
- Nút `maximize` của assistant **chỉ xuất hiện khi có prose** (`plainText.value.trim()`, 505-508) ⇒ assistant có **8 hoặc 9** nút.
- Footer assistant **ẩn khi turn đang streaming**: `showBottomActions = !streaming` (349) + `v-if="!streamingActive"` (126). Footer **user bubble KHÔNG có guard này** ⇒ trong lúc một turn đang chạy, các nút `edit`/`send`/`rewind` của mọi bong bóng user **vẫn bấm được** (xem E4).
- Có **một call site thứ hai** của `regenerate` ngay trong file: nút "Thử lại" trong khối lỗi (`@click="regen"`, dòng 114) — xem §4.4.
- Style hover hiện tại **giống nhau cho cả 9 nút**: `.hoveract .ha:hover { background: var(--bgHover); color: var(--text) }` (617-620) ⇒ đúng như brief nói, không phân biệt an toàn/nguy hiểm.
- Token màu có sẵn: `--danger`, `--dangerBg`, `--dangerDim`, `--dangerBorder` (khai ở [`assets/css/prototype.css:30`](../../apps/desktop/ui-next/assets/css/prototype.css) và [`assets/css/theme-cute.css:87-90, 157-160`](../../apps/desktop/ui-next/assets/css/theme-cute.css)) ⇒ theme "Cute" cũng có, không cần token mới.
- **User/system message KHÔNG có `eid`**: `engineMessageToSessionMessage` (`sessions.ts:1050-1063`) chỉ gán `eid: m.id` cho **assistant**. Đây là ràng buộc quyết định của §4.8 — và là thứ Brief A **T0c** gỡ bỏ.
- Call site khác của `regenerate` ngoài file này: [`SessionGateCard.vue:312-315`](../../apps/desktop/ui-next/components/session/SessionGateCard.vue) (`onRetry` của khối lỗi trong gate card).
- Call site khác của `fork`: [`SessionList.vue:594`](../../apps/desktop/ui-next/components/session/SessionList.vue) (`'copy'` — nhân bản session, không đụng session gốc).

### 2.5. Sidecar — `sessions.rewind` KHÔNG phải là `sessions.truncate`

Quan trọng cho §4.8, đọc từ sidecar:

| Sự thật | Bằng chứng |
|---|---|
| `truncateSession(sessionId, keepThroughId)`: giữ **đến hết** `keepThroughId`; **`null` ⇒ xoá sạch transcript**; **id lạ ⇒ NO-OP** (không bao giờ wipe vì id rác) | [`sidecar/src/sessions/store.ts:55-80`](../../apps/desktop/sidecar/src/sessions/store.ts) (`null` → `messages = []` ở 70-71; `idx < 0` → `return` ở 73-75) |
| `sessions.rewind` làm **nhiều hơn** truncate: `removeSdkSession` dọn transcript SDK mồ côi (ADR 0058) **+ restore file workspace từ snapshot** (ADR 0038) khi có `projectId` | [`sidecar/src/methods/sessions.rewind.ts:20-61`](../../apps/desktop/sidecar/src/methods/sessions.rewind.ts) |
| `sessions.rewind` bắt buộc `messageId: z.string().min(1)` ⇒ **không diễn đạt được** ca "cắt sạch" | `sessions.rewind.ts:14-18` |
| Call site UI hiện **không truyền `projectId`** ⇒ nhánh restore file chưa từng chạy từ nút rewind | `stores/sessions.ts:3658` |
| **Snapshot keyed theo assistant message id, chụp ở CUỐI turn** ⇒ `restoreSnapshot(sessionId, messageId)` trong `sessions.rewind` khôi phục file về trạng thái **sau lượt được giữ lại**. Đảo ngữ nghĩa `messageId` sẽ khôi phục nhầm sang lượt **bị bỏ** — xem §12.2 (lối thứ ba bị loại) | `sessions.send-message.ts:1454-1458`, `sessions/snapshots.ts:193-196` |

## 3. Bảng phân loại — mọi hành động trong footer

Bảng chuẩn để QA đếm. "Cắt?" = có xoá message khỏi `msgs` không. "Tốn tiền?" = có sinh một lượt gọi
model không. "Danger?" = có tô đỏ khi hover không.

### 3.1. Footer bong bóng **user** (6 nút, `SessionMessageItem.vue:46-63`)

| # | Hành động | Icon | Handler | Cắt? | Tốn tiền? | **Confirm?** | **Danger hover?** |
|---|---|---|---|---|---|---|---|
| 1 | Sao chép | `copy` | `copyText` (440) | Không | Không | Không | Không |
| 2 | Toàn màn hình | `maximize` | `openFullscreen` (471) | Không | Không | Không | Không |
| 3 | Sửa & gửi lại | `edit` | `editMsg` (446-452) → `store.resend(…, next)` | **Có** | **Có** | **CÓ** (khi `lostCount ≥ 1`) | **Có** |
| 4 | Gửi lại | `send` | `resend` (454) | **Có** | **Có** | **CÓ** (khi `lostCount ≥ 1`) | **Có** |
| 5 | Tua về đây | `rewind` | `rewind` (457) | **Có** | Không | **CÓ** (luôn) | **Có** |
| 6 | Fork | `fork` | `fork` (458) | Không (tạo session mới) | Không | Không | Không |

### 3.2. Footer turn **assistant** (8-9 nút, `msgActions` 503-518)

| # | Hành động | Icon | Handler | Cắt? | Tốn tiền? | **Confirm?** | **Danger hover?** |
|---|---|---|---|---|---|---|---|
| 1 | Sao chép | `copy` | `copyText` | Không | Không | Không | Không |
| 2 | Toàn màn hình (chỉ câu trả lời) | `maximize` | `openFullscreen` — *chỉ hiện khi có prose* | Không | Không | Không | Không |
| 3 | Toàn màn hình cả lượt | `layers` | `openTurnFullscreen` (486) | Không | Không | Không | Không |
| 4 | Trích dẫn (follow-up) | `quote` | `quote` (441) | Không | Không | Không | Không |
| 5 | Tạo lại | `refresh` | `regen` (455) → `store.regenerate` | **Có** | **Có** | **CÓ** (khi `lostCount ≥ 1`) | **Có** |
| 6 | Thử model khác | `settings` | `retry` (456) → `store.retryModel` → **`regenerate`** dưới IPC | **CÓ** | **CÓ** | **Không** — xem ghi chú | **Có** |
| 7 | Tua về đây | `rewind` | `rewind` (457) | **Có** | Không | **CÓ** (luôn) | **Có** |
| 8 | Tạo nhánh | `branch` | `branch` (459) → `store.fork(…,'branch')` | Không | Không | Không | Không |
| 9 | Fork | `fork` | `fork` (458) | Không | Không | Không | Không |

> **Ghi chú bắt buộc về `retryModel` (hàng #6)** — lý do miễn confirm **không phải** "nó vô hại".
> Giả định đó **sai**: `stores/sessions.ts:3639-3648` cho thấy dưới IPC nó gọi thẳng `regenerate(id, index)`,
> tức **có truncate transcript** và **có tốn 1 lượt gọi model**, y hệt nút `refresh`.
> Lý do thật sự miễn confirm: **"Thử model khác" là thao tác rất chủ đích** — người dùng phải cố ý muốn
> đổi model mới bấm nó, xác suất bấm nhầm thấp hơn hẳn các nút còn lại; thêm ma sát ở đây chỉ nuôi
> confirm-fatigue mà không đổi lại được gì. **Bù lại bằng tín hiệu thị giác**: nó nằm trong nhóm tô
> `danger` hover (AC-G31) — người dùng nhìn thấy nó nguy hiểm trước khi click.

### 3.3. Tổng kết đếm được

- **Hành động CÓ THỂ bị gate: đúng 4** — `rewind`, `resend`, `edit & resend`, `regenerate`.
  Hộp thoại chỉ bật khi `lostCount ≥ 1` (§4.4).
- **Điểm bấm có thể mở hộp thoại: 5** (vì `rewind` có ở **cả hai** footer): user `edit`, user `send`,
  user `rewind`, assistant `refresh`, assistant `rewind`.
- **Hành động KHÔNG bao giờ bị gate: 6** — `copy`, `quote`, `fullscreen` (cả 2 biến thể tính là 1
  khái niệm), `fork`, `branch`, `retryModel`.
- **Hành động tô `danger` hover: 5** — 4 hành động gate **+ `retryModel`**.
  Quy ra **6 điểm bấm**: user `edit`/`send`/`rewind`, assistant `refresh`/`settings`/`rewind`.
- **Điểm bấm giữ hover trung tính: 8** — user `copy`/`maximize`/`fork`, assistant
  `copy`/`maximize`/`layers`/`quote`/`branch`/`fork` (assistant `maximize` có thể vắng ⇒ 8 hoặc 9 tuỳ turn).

## 4. Quyết định thiết kế (đã chốt)

### 4.1. Đơn vị đếm = **message**, không phải turn

Khớp đúng đơn vị mà store thao tác (`msgs.slice()`). Một turn assistant nhiều block vẫn là **1 message**.
System divider cũng tính là 1 message (nó nằm trong `msgs`).

`lostCount` = **số message bị gỡ khỏi transcript mà KHÔNG quay lại**. Hai thứ **không** tính là mất:
tin nhắn user được **gửi lại**, và câu trả lời đang được **thay thế có chủ đích** (đó chính là mục
đích của `regenerate`).

Với `msgs = store.active.msgs`, `i = msgIndex`:

| Hành động | Điểm neo | `lostCount` | Giải thích |
|---|---|---|---|
| `rewind` | `i` | `msgs.length - i` | Gỡ `msgs[i..end]`, **không có gì quay lại** ⇒ luôn **≥ 1**. |
| `resend` / `edit & resend` | `i` (bong bóng user) | `msgs.length - i - 1` | Gỡ `msgs[i..end]`; message tại `i` được **gửi lại** ⇒ trừ 1. |
| `regenerate` | `ui` = index user turn gần nhất **trước** `i` | `msgs.length - ui - 2` | Gỡ `msgs[ui..end]`; message tại `ui` được **gửi lại** (−1) và câu trả lời tại `i` được **thay thế có chủ đích** (−1). |

Công thức `regenerate` **không** rút gọn thành `msgs.length - i - 1`: giữa `ui` và `i` **có thể** còn
message khác (system divider, một turn assistant khác sau khi rewind) — những message đó **cũng bị gỡ**
và **phải** được đếm. Ví dụ `[… user@18, assistant@19, system@20, assistant@21]`, bấm `regenerate` tại 21:
`lostCount = 22 - 18 - 2 = 2` (assistant@19 + system@20) — đúng, trong khi "số message sau tin nhắn này"
sẽ ra 0 và **giấu mất** hai message.

`ui` tìm đúng như store: lùi từ `i - 1`, dừng ở `role === 'user'` đầu tiên. Nếu **không có** `ui` ⇒
**không mở hộp thoại, không gọi store** (E6).

> **Ràng buộc chống drift:** quy tắc tìm `ui` bị **nhân đôi** giữa UI (để đếm) và store (để chạy).
> Chấp nhận theo Rule of Three (2 bản), nhưng **bắt buộc** đặt comment chéo ở cả hai chỗ. Nếu tech-lead
> muốn tách hàm thuần, chỗ đúng là [`utils/session-turns.ts`](../../apps/desktop/ui-next/utils/session-turns.ts) — đây là lựa chọn implement, không phải yêu cầu.

### 4.2. Nhãn nút xác nhận **đặt riêng**, không dùng "Xoá"

`LibraryConfirmDelete.vue:29` cho phép override `confirmLabel`. Bắt buộc dùng:

- `rewind` → **"Cắt về đây"** / *"Rewind here"*
- `resend` / `edit & resend` / `regenerate` → **"Chạy lại"** / *"Re-run"*

Lý do: nhãn "Xoá" tái tạo đúng sự nhầm lẫn mà mục *Đính chính phạm vi* của brief đang gỡ — ở đây
**không có hành động "xoá message"** nào cả.

`cancelLabel` để trống ⇒ rơi về `common.cancel` ("Hủy" / "Cancel"). `kind` để mặc định `'danger'`
(nút đỏ), không truyền tường minh.

### 4.3. Ràng buộc CỨNG: 6 hành động kia **không được** thêm confirm

Đây là yêu cầu sản phẩm, không phải "chưa làm tới". Confirm-fatigue là rủi ro thật: hỏi ở khắp nơi
⇒ người dùng bấm Enter phản xạ ⇒ hộp thoại mất tác dụng **đúng vào lúc cần nhất**. Dev **không được**
"tiện tay" thêm confirm cho `copy` / `quote` / `fullscreen` / `fork` / `branch` / `retryModel`.
**AC-G2** kiểm chứng bằng cách đếm.

`retryModel` nằm trong danh sách này **dù nó thật sự cắt transcript** — lý do và bù trừ: §3.2 ghi chú.

### 4.4. Quy tắc bật hộp thoại: **`lostCount ≥ 1`**

Hộp thoại chỉ hiện khi thao tác **thật sự làm mất message**. `lostCount === 0` ⇒ **chạy thẳng, không hỏi**.

Diễn đạt theo **điều kiện**, không theo vị trí nút — nhờ vậy quy tắc tự đúng cho mọi ca "không có gì để mất":

| Ca | `lostCount` | Kết quả |
|---|---|---|
| "Thử lại" trên lượt **lỗi cuối cùng** (`SessionMessageItem.vue:114`, `SessionGateCard.vue:312-315`) | 0 | **Không hỏi** — thứ bị bỏ đúng là lượt hỏng đang được thử lại. |
| `regenerate` câu trả lời **cuối cùng**, phía sau không còn gì | 0 | **Không hỏi** — ca `regenerate` phổ biến nhất, không mất gì. |
| `resend` / `edit & resend` bong bóng user **cuối cùng** chưa có trả lời | 0 | **Không hỏi**. |
| "Thử lại" trên lượt lỗi **giữa** transcript (phía sau còn message) | ≥ 1 | **Hỏi**, con số đúng. |
| `regenerate` giữa transcript | ≥ 1 | **Hỏi**. |
| `rewind` bất kỳ | luôn ≥ 1 | **Luôn hỏi**. |

Hệ quả gọn: **không cần** biến thể text "0 message", **không cần** ngoại lệ hardcode theo nút, và
`SessionGateCard.vue` **không phải sửa** — cùng một quy tắc áp cho mọi call site của `regenerate`.

### 4.5. `edit & resend` — confirm đặt **sau** overlay sửa nội dung

Luồng hiện tại: `editMsg` (446-452) mở `openPromptEdit` trước, người dùng sửa text rồi bấm xác nhận,
sau đó mới `store.resend`. Hộp confirm chèn **giữa** overlay và `resend`.

Lý do: overlay là nơi người dùng *soạn*, chưa phải nơi *cam kết*. Con số message sẽ mất chỉ có ý
nghĩa ngay trước khi cắt. Hỏi trước khi mở overlay sẽ khiến người dùng phải xác nhận một thứ họ chưa
quyết định làm. Huỷ overlay (`next == null`, dòng 449) vẫn giữ nguyên hành vi cũ: thoát im lặng,
**không** hiện confirm.

Phương án bị loại: nhét cảnh báo vào chính `SessionPromptEditOverlay` — sẽ tạo bề mặt cảnh báo thứ hai,
lệch với 3 hành động còn lại, và trái tinh thần "không phát sinh modal mới".

### 4.6. Kiểm tra lại transcript **sau** khi confirm (chống lệch số)

Thêm `await` làm **dài thêm cửa sổ đua** — đúng như brief cảnh báo. Quy tắc chốt:

1. Trước khi gọi `confirm()`, chụp `lenAtOpen = msgs.length` (và `sessionId` + `index`).
2. Sau khi `confirm()` trả `true`, **so lại** `msgs.length === lenAtOpen` **và** session đang active vẫn là session đó.
3. Khác ⇒ **không thực thi gì**, hiện toast `sessions.guard.stale` qua `pushActionToast(text, 'error')`
   ([`composables/useActionToasts.ts:29`](../../apps/desktop/ui-next/composables/useActionToasts.ts), host `ActionToastHost` đã nằm trong `AppGlobalHosts.vue:17` ⇒ chạy được cả trong popout).

Một quy tắc này xử lý **bốn** ca cùng lúc:
- Người dùng gửi tin mới khi modal đang mở ⇒ `msgs.length` tăng ⇒ huỷ (E2).
- Người dùng chuyển sang session khác rồi mới xác nhận ⇒ huỷ (E3).
- Một lượt mới bắt đầu streaming ⇒ append 1 message ⇒ huỷ, **kể cả `rewind`** (vốn **không** có guard streaming ở store) (E4).
- Double-click `resend` (store **không** có `regenInFlight` cho `resend`, §2.3) ⇒ lần thứ hai thấy `msgs.length` đã đổi ⇒ huỷ (E1).

Toast là **bắt buộc**: im lặng không làm gì sau khi người dùng đã bấm "Chạy lại" còn khó hiểu hơn cả
hiện trạng. Không dựng UI mới — dùng host toast sẵn có.

### 4.7. Nơi đặt gate: **component**

`useConfirm()` là composable **UI**. Store là state + IPC, không được biết tới DOM/dialog
(SoC, `.claude/rules/principles.md`). Hệ quả cố ý:

- Gate nằm ở `SessionMessageItem.vue` ⇒ `retryModel` (đi thẳng vào `store.regenerate`) **không** bị
  gate lây — đúng phạm vi đã chốt (§4.3).
- Đường **mobile remote** (`sessions.*` qua gateway, [ADR 0067](../decisions/0067-mobile-remote-control-transport.md)) không đi qua component ⇒ không bị ảnh hưởng, đúng mục *Out of scope* của brief.
- `stores/sessions.ts` **chỉ** đổi đúng một chỗ, và không phải vì gate — mà vì §4.8.

### 4.8. Vá bug persist của `rewind` (Q2 — **lát B2**, sau T0c)

**Bug.** `sessions.ts:3651-3661` cắt `msgs` trong bộ nhớ **luôn**, nhưng chỉ gửi RPC khi
`msgs[index-1]` là **assistant có `eid`**. Vì `rewind` trên một **turn assistant** có message trước
thường là **user**, và user message **không có `eid`** (`sessions.ts:1050-1063`), nên ca phổ biến nhất
**không persist**: reload app là message quay về, và lượt sau vẫn resume từ JSONL đầy đủ. Câu
"Không thể hoàn tác" trong hộp thoại vì thế **không đúng sự thật**.

**Hướng mirror `resend` do PO đề xuất — SAI ở hai chi tiết. Không được implement như vậy:**

1. **Sai chí mạng (mất dữ liệu).** `keepThroughId = prev.role === 'assistant' ? (prev.eid ?? null) : null`:
   với `rewind` trên turn assistant, `prev` là **user** ⇒ rơi vào nhánh `null` ⇒
   `truncateSession(sessionId, null)` ⇒ **`messages = []`** (`sidecar/src/sessions/store.ts:70-71`) ⇒
   **xoá sạch transcript trên đĩa** trong khi bộ nhớ chỉ cắt tới `index`. Bug "không persist" biến thành
   bug "wipe toàn bộ" — tệ hơn nhiều lần. (Trong `resend`/`regenerate` nhánh này gần như không chạm tới
   vì `index` luôn là user message nên `prev` gần như luôn là assistant; ở `rewind` thì **ngược lại**.)
2. **Thu hẹp hợp đồng.** `sessions.rewind` **không** tương đương `sessions.truncate`: nó còn
   `removeSdkSession` (dọn transcript SDK mồ côi, ADR 0058) **và** restore file workspace từ snapshot
   (ADR 0038) khi có `projectId` — `sidecar/src/methods/sessions.rewind.ts:20-61`. Đổi hết sang
   `truncate` là âm thầm bỏ hai hành vi đó.

**Hướng sửa đúng — MỘT quy tắc duy nhất (chốt TL-1, §12.2):**

Sau khi Brief A **T0c** merge, mọi message đến từ đĩa đều mang `eid`. Khi đó R-a/R-b/R-c gộp lại thành
**một** quy tắc, diễn đạt bằng *"neo vào message được persist gần nhất phía trước"*:

```
anchorId = eid của message CÓ eid gần nhất trong msgs[0 .. index-1]   (lùi dần từ index-1)

anchorId có   → sessions.rewind({ sessionId, messageId: anchorId })
anchorId không → sessions.truncate({ sessionId, keepThroughId: null })
```

| Ca | Rơi vào nhánh nào | Vì sao đúng |
|---|---|---|
| `index === 0` (cũ: **R-a**) | `null` | Không có message nào phía trước ⇒ cắt sạch **đúng ý định**. (`sessions.rewind` không dùng được: `messageId` bắt buộc `min(1)`, `sessions.rewind.ts:14-18`.) |
| `msgs[index-1]` có `eid`, **bất kể role** (cũ: **R-b**) | `sessions.rewind` | Sau T0c đây là **đa số tuyệt đối**. Giữ RPC này để không mất `removeSdkSession` + đường file-restore. |
| `msgs[index-1]` là message hệ thống cục bộ **không persist** (`ENGINE_UNAVAILABLE`, §2.3) | lùi tiếp tới `eid` gần nhất | Message đó **không nằm trên đĩa**, nên "giữ đến hết message persist trước nó" chính là trạng thái đĩa đúng. |
| Toàn bộ `msgs[0..index-1]` đều không có `eid` | `null` | Cả tiền tố **không** nằm trên đĩa ⇒ đĩa vốn đã rỗng ở đoạn đó ⇒ `null` khớp bộ nhớ, **không** mất gì. |

**Ràng buộc an toàn — đọc kỹ, đây là ranh giới giữa đúng và thảm hoạ:**

- **`keepThroughId: null` chỉ hợp lệ khi KHÔNG tìm được `eid` nào trong toàn bộ tiền tố `msgs[0..index-1]`.**
  Tuyệt đối **không** dùng `null` làm fallback cho "message ngay trước không phải assistant" hay
  "không tiện tìm id" — đó chính là cái bẫy wipe ở mục 1 phía trên. Điều kiện `null` phải được viết
  bằng kết quả của vòng lùi, không bằng `role`.
- **Giữ `rewind` là hàm đồng bộ.** Nó không chạy lại lượt nào sau đó nên **không cần** `await` — dùng
  `pushRequest` (fire-and-forget, như hiện tại). Không đổi chữ ký ⇒ không sinh cửa sổ đua mới.
  Vòng lùi tìm `eid` là O(k) trên mảng có sẵn trong bộ nhớ, không I/O.
- **An toàn sẵn có:** id lạ ⇒ `truncateSession` **no-op** (`store.ts:73-75`), không wipe. Đây là lưới
  an toàn, **không** phải lý do để gửi id bừa.
- **Điều kiện tiên quyết phải verify trước khi ship B2:** sau `ensureLoaded`, **mọi** message trong
  `s.msgs` phải có `eid` **trừ** message hệ thống cục bộ ở §2.3. Nếu dev phát hiện một nguồn nào khác
  persist message mà **không** mang `eid` ra tới UI ⇒ **dừng, báo tech-lead** — đừng tự ý mở rộng vòng
  lùi, vì khi đó neo sẽ nhảy qua một message có thật trên đĩa và cắt **nhiều hơn** ý định. Kiểm chứng
  bằng **AC-R7**.

## 5. User flow

### 5.1. Golden path — `rewind` (tua về đây)

1. Người dùng ở Sessions, transcript có 30 message, đang xem message #18.
2. Hover footer → icon `rewind` **chuyển sang đỏ** (`--dangerBg` + `--danger`) ⇒ tín hiệu nguy hiểm **trước** khi click.
3. Click → hộp thoại: tiêu đề **"Tua về đây?"**, nội dung **"Sẽ xoá 12 tin nhắn từ điểm này trở đi."** (+ **" Không thể hoàn tác."** từ lát **B2** trở đi — §7.1), nút **"Cắt về đây"** (đỏ) + **"Hủy"**.
4. Bấm **"Cắt về đây"** → kiểm tra lại `msgs.length` (§4.6) → prune bookmark (§6) → `store.rewind(id, 18)` → transcript còn 18 message **và (từ B2) đã cắt trên đĩa** (§4.8).
5. Bấm **"Hủy"** / Esc / click ra ngoài → **không có gì thay đổi**, transcript vẫn 30 message.

### 5.2. `resend` (gửi lại, bong bóng user)

1. Click icon `send` ở bong bóng user #12 trong transcript 30 message ⇒ `lostCount = 30 - 12 - 1 = 17`.
2. Hộp thoại: **"Gửi lại tin nhắn này?"** / **"Sẽ xoá 17 tin nhắn sau tin nhắn này. Không thể hoàn tác.\nLượt chạy lại sẽ tốn thêm một lần gọi model."** / nút **"Chạy lại"**.
3. Xác nhận → cắt + `sessions.truncate` + gửi lại nội dung cũ → một lượt mới chạy.
4. Nếu bong bóng user đó là message **cuối** (`lostCount = 0`) ⇒ **không hỏi**, gửi lại ngay.

### 5.3. `edit & resend`

1. Click icon `edit` → **overlay sửa nội dung** mở ra (hành vi cũ, không đổi).
2. Sửa text, bấm xác nhận trong overlay.
3. **Bây giờ** mới hiện hộp thoại (nếu `lostCount ≥ 1`): **"Sửa & gửi lại?"** + cùng nội dung như §5.2.
4. Xác nhận → chạy `store.resend(id, i, textMới)`.
5. Huỷ ở **overlay** ⇒ thoát im lặng, **không** hiện hộp thoại. Huỷ ở **hộp thoại** ⇒ không cắt gì; nội dung vừa sửa **bị bỏ** (không lưu nháp — xem *Out of scope*).

### 5.4. `regenerate` (tạo lại)

1. Click icon `refresh` ở turn assistant #21 (transcript 30 message; user turn gần nhất trước đó là #20)
   ⇒ `lostCount = 30 - 20 - 2 = 8` (chính là các message #22…#29).
2. Hộp thoại: **"Tạo lại câu trả lời?"** / **"Câu trả lời này sẽ bị thay thế và 8 tin nhắn khác bị xoá. Không thể hoàn tác.\nLượt chạy lại sẽ tốn thêm một lần gọi model."** / nút **"Chạy lại"**.
3. Xác nhận → `store.regenerate(id, 21)`; guard `regenInFlight` + guard streaming của store **vẫn chạy nguyên vẹn sau `await`**.
4. Nếu #21 là turn **cuối** (`lostCount = 0`) ⇒ **không hỏi**, tạo lại ngay — kể cả khi đó là lượt lỗi và người dùng bấm "Thử lại" trong khối lỗi.

### 5.5. Flow phụ

- **`lostCount === 0`** ⇒ chạy thẳng, không hộp thoại (§4.4).
- **Transcript đã đổi trong lúc modal mở** ⇒ không thực thi + toast (§4.6).
- **`regenerate` không có user turn phía trước** ⇒ không hỏi, không chạy (E6).

## 6. Thứ tự thực thi (khớp với spec anh em Brief A)

[session-transcript-navigation.md §5.4](./session-transcript-navigation.md) quy định khi transcript bị
cắt có chủ đích thì phải **tính tập id còn sống TRƯỚC khi cắt** rồi mới prune bookmark. Feature này chèn
thêm hai bước **trước cả hai bước đó**. Thứ tự bắt buộc cho cả 4 đường (`/compact` không thuộc spec này):

```
0. tính lostCount            ← §4.1. lostCount === 0 ⇒ BỎ QUA bước 1-2, chạy thẳng bước 3.
1. await confirm({...})      ← feature này. false ⇒ DỪNG, không làm gì tiếp.
2. so lại msgs.length + session ← §4.6. lệch ⇒ DỪNG + toast.
3. tính survivingIds = new Set(idsOf(msgs.slice(0, index)))   ← Brief A §5.4 bước 2
4. pruneBookmarksTo(...) + sessions.updateBookmarks           ← Brief A §5.4 bước 3-4
5. msgs.slice(...) + cắt trên đĩa (sessions.truncate / sessions.rewind — §4.8)
```

Hệ quả cần hai spec cùng tôn trọng:

- **Huỷ hộp thoại ⇒ bookmark KHÔNG bị prune** (vì bước 3-4 chưa chạy). AC-G5 + AC-P1 của Brief A phải cùng đúng.
- Bước 0-2 nằm ở **component**; bước 3-5 nằm ở **store**. Không đảo.
- Nếu Brief A ship trước, feature này chỉ thêm bước 0-2 ở đầu chuỗi — không phải sửa lại prune.

## 7. Nội dung hộp thoại (vi + en)

`description` render `pre-wrap` (`LibraryConfirmDelete.vue:110`) ⇒ ghép ở call site theo **ba mảnh**:

```
description = t(body, { n })
            + (' ' + t('sessions.guard.irreversible'))   ← câu "Không thể hoàn tác."
            + ('\n' + t('sessions.guard.costNote'))      ← chỉ 3 hành động chạy lại
```

Tách câu **"Không thể hoàn tác."** thành khoá riêng (`sessions.guard.irreversible`) thay vì nhúng vào
từng `body` là **có chủ đích**: nó cho phép `rewind` **không** khẳng định điều đó ở lát B1 (khi §4.8
chưa merge) rồi thêm vào ở B2 — **một dòng diff, không khoá nào bị sửa hai lần**. Ba hành động chạy lại
dùng nó **ngay từ B1** vì đường persist của chúng (`sessions.truncate`) đã đúng sẵn (§2.3).

**Không có biến thể "0 message"** — `lostCount === 0` thì hộp thoại không hiện (§4.4), nên chuỗi
"0 tin nhắn" không bao giờ được render.

### 7.1. `rewind`

| Trường | Tiếng Việt | English |
|---|---|---|
| Tiêu đề | Tua về đây? | Rewind to here? |
| Nội dung (B1 + B2) | Sẽ xoá **{n}** tin nhắn từ điểm này trở đi. | This removes **{n}** messages from here on. |
| Câu bổ sung — **chỉ từ B2** | Không thể hoàn tác. | This cannot be undone. |
| Nút xác nhận | Cắt về đây | Rewind here |
| Nút huỷ | Hủy (`common.cancel`) | Cancel |

`{n}` = `msgs.length - i`, **luôn ≥ 1**.

> **Ràng buộc không thương lượng:** ở lát **B1**, hộp thoại `rewind` **KHÔNG được** chứa câu
> "Không thể hoàn tác" — vì lúc đó §4.8 chưa merge và ca phổ biến nhất chỉ cắt trong bộ nhớ (message
> quay lại sau khi khởi động lại app). Một hộp thoại an toàn nói sai **một lần** là mất uy tín ở **mọi**
> hộp thoại còn lại, kể cả 3 cái đang nói đúng. Câu này được thêm vào ở **B2**, khi nó trở thành đúng
> vô điều kiện (AC-R1…AC-R3). Kiểm chứng: **AC-G36** (B1) và **AC-R9** (B2).

### 7.2. `resend` / `edit & resend`

| Trường | Tiếng Việt | English |
|---|---|---|
| Tiêu đề — `resend` | Gửi lại tin nhắn này? | Resend this message? |
| Tiêu đề — `edit & resend` | Sửa & gửi lại? | Edit & resend? |
| Nội dung | Sẽ xoá **{n}** tin nhắn sau tin nhắn này. | This removes the **{n}** messages after it. |
| Câu bổ sung (B1 trở đi) | Không thể hoàn tác. | This cannot be undone. |
| Dòng phụ | Lượt chạy lại sẽ tốn thêm một lần gọi model. | Re-running costs one more model call. |
| Nút xác nhận | Chạy lại | Re-run |
| Nút huỷ | Hủy | Cancel |

### 7.3. `regenerate`

| Trường | Tiếng Việt | English |
|---|---|---|
| Tiêu đề | Tạo lại câu trả lời? | Regenerate this reply? |
| Nội dung | Câu trả lời này sẽ bị thay thế và **{n}** tin nhắn khác bị xoá. | This reply will be replaced and **{n}** other messages removed. |
| Câu bổ sung (B1 trở đi) | Không thể hoàn tác. | This cannot be undone. |
| Dòng phụ | Lượt chạy lại sẽ tốn thêm một lần gọi model. | Re-running costs one more model call. |
| Nút xác nhận | Chạy lại | Re-run |
| Nút huỷ | Hủy | Cancel |

Nội dung của `regenerate` **cố ý khác** `resend`: nó phải nói rõ hai chuyện tách bạch — câu trả lời
đang xem **bị thay thế** (đúng ý định), và **{n} message khác** bị xoá (thiệt hại thật). Dùng chung
câu "sau tin nhắn này" sẽ **giấu mất** các message nằm giữa user turn và câu trả lời (§4.1).

Dòng phụ nhắc chi phí là **quyết định của PO** — giữ đúng một dòng, **không** hiện số tiền/token ước
tính (thuộc [session-cost-budget.md](./session-cost-budget.md)).

## 8. Acceptance criteria

Tiền tố **AC-G** (guard, lát **B1**) và **AC-R** (rewind persist, lát **B2**). QA tham chiếu bằng ID.

### 8.1. Phạm vi gate — đếm được

- **AC-G1.** *Given* transcript mà mọi điểm bấm đều có `lostCount ≥ 1` (ví dụ 30 message, thao tác ở
  giữa), *when* lần lượt bấm `rewind` (bong bóng user), `send` (resend), `edit` (edit & resend) và
  `refresh` (regenerate), *then* **cả 4** đều mở hộp thoại xác nhận trước khi bất kỳ message nào biến mất.
- **AC-G2.** *Given* cùng session đó, *when* lần lượt bấm `copy`, `quote`, `maximize` (fullscreen câu trả
  lời), `layers` (fullscreen cả lượt), `fork`, `branch` và `settings` (retryModel), *then* **không nút nào**
  mở hộp thoại — đúng **7 điểm bấm / 6 hành động**, đếm bằng mắt.
- **AC-G3.** *Given* footer assistant giữa transcript, *when* đếm số điểm bấm mở hộp thoại, *then* đúng
  **2** (`refresh`, `rewind`); *and given* footer user bubble, *then* đúng **3** (`edit`, `send`, `rewind`).
- **AC-G4.** *Given* toàn bộ codebase sau khi ship, *when* grep `useConfirm` trong `components/session/`,
  *then* **không** có file modal xác nhận mới nào được thêm — chỉ dùng lại `useConfirm()` + `ConfirmDialogHost`.

### 8.2. Quy tắc `lostCount === 0` (Q3)

- **AC-G5.** *Given* turn cuối cùng của transcript là một lượt **lỗi**, *when* bấm nút "Thử lại" trong
  khối lỗi, *then* chạy lại **ngay**, **không** hộp thoại (`lostCount = 0`).
- **AC-G6.** *Given* câu trả lời **cuối cùng** (không lỗi) và phía sau không còn message nào, *when* bấm
  `refresh`, *then* tạo lại **ngay**, không hộp thoại.
- **AC-G7.** *Given* bong bóng user **cuối cùng** chưa có câu trả lời, *when* bấm `send` (resend),
  *then* gửi lại **ngay**, không hộp thoại.
- **AC-G8.** *Given* một lượt lỗi **không phải** message cuối (đã có message sau nó), *when* bấm "Thử lại"
  trong khối lỗi đó, *then* hộp thoại `regenerate` hiện ra với con số đúng.
- **AC-G9.** *Given* bất kỳ hộp thoại nào trong §7, *when* đọc nội dung, *then* **không bao giờ** xuất hiện
  chuỗi "0 tin nhắn" / "0 messages".

### 8.3. Huỷ = không mất gì

- **AC-G10.** *Given* transcript 30 message và hộp thoại `rewind` tại index 18 đang mở, *when* bấm "Hủy",
  *then* transcript vẫn **đủ 30 message**, **không** RPC `sessions.rewind`/`sessions.truncate` nào được gửi,
  và **không** bookmark nào bị prune.
- **AC-G11.** *Given* hộp thoại đang mở, *when* nhấn **Esc** hoặc click ra vùng scrim, *then* kết quả y hệt
  bấm "Hủy" (không cắt gì) — hành vi kế thừa từ `LibraryConfirmDelete.vue:3, 62-66`.
- **AC-G12.** *Given* hộp thoại `edit & resend` đang mở sau khi người dùng đã sửa nội dung, *when* bấm "Hủy",
  *then* transcript nguyên vẹn **và** tin nhắn gốc giữ **nội dung cũ** (bản sửa bị bỏ).

### 8.4. Con số phải đúng

- **AC-G13.** *Given* transcript **30** message và bấm `rewind` tại index **18**, *when* hộp thoại hiện,
  *then* nội dung nêu đúng **12** (`30 - 18`).
- **AC-G14.** *Given* transcript **30** message và bấm `resend` ở bong bóng user index **12**, *when* hộp
  thoại hiện, *then* nội dung nêu đúng **17** (`30 - 12 - 1`) — **không** tính chính tin nhắn được gửi lại.
- **AC-G15.** *Given* transcript **30** message, bấm `regenerate` tại turn assistant index **21** mà user
  turn gần nhất trước đó là index **20**, *when* hộp thoại hiện, *then* nội dung nêu đúng **8**
  (`30 - 20 - 2`) — trừ cả tin nhắn user được gửi lại **và** chính câu trả lời đang được thay thế.
- **AC-G16.** *Given* transcript `[…, user@18, assistant@19, system@20, assistant@21]` (tổng **22** message),
  *when* bấm `regenerate` tại **21**, *then* nội dung nêu đúng **2** — hai message nằm **giữa** user turn và
  câu trả lời **phải** được đếm, không được giấu.
- **AC-G17.** *Given* giữa điểm neo và cuối transcript có **system divider**, *when* đếm, *then* divider
  **được tính** là một message (đơn vị = phần tử của `msgs`, khớp `msgs.slice()`).
- **AC-G18.** *Given* một turn assistant gồm **5 block** (tool + thinking + text), *when* nó nằm trong vùng
  bị cắt, *then* nó được đếm là **1**, không phải 5.

### 8.5. Popout

- **AC-G19.** *Given* một session đã pop out ra cửa sổ riêng (`/session?id=…`), *when* bấm `rewind` trong
  cửa sổ đó, *then* hộp thoại **hiện lên trong chính cửa sổ popout** và bấm "Cắt về đây" cắt đúng
  transcript — không treo, không im lặng. *(Hồi quy cho `AppGlobalHosts.vue:11` + `pages/session.vue:7`.)*
- **AC-G20.** *Given* hộp thoại đang mở trong popout, *when* nhìn sang cửa sổ chính, *then* cửa sổ chính
  **không** hiện hộp thoại nào (mỗi renderer có singleton `useConfirm` riêng) và vẫn ở trạng thái hand-off.
- **AC-G21.** *Given* toast huỷ vì transcript đổi (§4.6) được kích hoạt trong popout, *when* quan sát,
  *then* toast hiện **trong popout** (`ActionToastHost` nằm trong `AppGlobalHosts.vue:17`).

### 8.6. Guard re-entry vẫn đúng sau khi thêm `await`

- **AC-G22.** *Given* một turn đang **streaming**, *when* người dùng bấm `refresh`/`send`/`rewind` ở một
  bong bóng user cũ (footer user bubble không bị ẩn khi streaming) và xác nhận, *then* **không message nào
  bị cắt** — chặn bởi §4.6 (số message đã đổi) và/hoặc guard streaming của store (`sessions.ts:3601, 3673`);
  người dùng thấy toast giải thích.
- **AC-G23.** *Given* đã xác nhận một `regenerate` và nó đang trong cửa sổ `await sessions.truncate`,
  *when* bấm `refresh` lần nữa và xác nhận, *then* **không** có lượt model thứ hai được sinh ra —
  `regenInFlight` (`sessions.ts:3593, 3600, 3635`) vẫn chặn đúng.
- **AC-G24.** *Given* code sau khi sửa, *when* đọc `stores/sessions.ts`, *then* thay đổi **duy nhất** về
  logic là phần vá persist của `rewind` (§4.8, lát B2) — `regenInFlight`, guard streaming, thứ tự
  `await sessions.truncate` → `sendMessage` của `regenerate`/`resend` giữ **nguyên xi**; **không** có lời
  gọi `useConfirm`/DOM nào lọt vào store.
- **AC-G25.** *Given* người dùng double-click **cùng một** nút destructive, *when* quan sát, *then* chỉ có
  **một** hộp thoại trên màn hình (cái đầu tự resolve `false` theo `useConfirm.ts:40-43`) và tối đa **một**
  hành động được thực thi.
- **AC-G26.** *Given* hộp thoại `rewind` đang mở, *when* người dùng click nút `refresh` của message khác,
  *then* hộp thoại `rewind` biến mất **và không cắt gì**, thay bằng hộp thoại `regenerate`.

### 8.7. Tín hiệu thị giác

- **AC-G27.** *Given* footer message, *when* hover **6 điểm bấm destructive** (user `edit`/`send`/`rewind`,
  assistant `refresh`/`settings`/`rewind`), *then* icon đổi sang nền `var(--dangerBg)` + màu `var(--danger)`.
- **AC-G28.** *Given* footer assistant, *when* hover riêng nút `settings` (**"Thử model khác"** / retryModel),
  *then* nó ra màu **danger** y như `refresh` và `rewind` — dù nó **không** mở hộp thoại (AC-G2). Đây là AC
  riêng vì nó là điểm dễ bị bỏ sót nhất của Q1.
- **AC-G29.** *Given* footer message, *when* hover các nút an toàn (`copy`, `quote`, `maximize`, `layers`,
  `fork`, `branch`), *then* giữ nguyên hover trung tính `var(--bgHover)` + `var(--text)`
  (`SessionMessageItem.vue:617-620`).
- **AC-G30.** *Given* theme family **Cute** đang bật, *when* hover nút destructive, *then* vẫn ra màu danger
  (token `--dangerBg`/`--danger` có sẵn ở `theme-cute.css:87-90, 157-160`) — không cần token mới, không hardcode hex.
- **AC-G31.** *Given* nút destructive, *when* đọc DOM, *then* `title` (tooltip) **không đổi** so với hiện tại
  — feature này không đổi nhãn nút, chỉ đổi màu hover.

### 8.8. Chi phí & i18n

- **AC-G32.** *Given* hộp thoại `resend` / `edit & resend` / `regenerate`, *when* đọc nội dung, *then* có
  **đúng một** dòng phụ nhắc tốn thêm một lượt gọi model.
- **AC-G33.** *Given* hộp thoại `rewind`, *when* đọc nội dung, *then* **không** có dòng nhắc chi phí
  (rewind không gọi model).
- **AC-G34.** *Given* ngôn ngữ app là `en`, *when* mở bất kỳ hộp thoại nào trong §7, *then* toàn bộ tiêu đề,
  nội dung, nhãn hai nút đều là tiếng Anh — **không** còn chuỗi hardcode tiếng Việt.
- **AC-G35.** *Given* nút xác nhận, *when* đọc nhãn, *then* là **"Cắt về đây"** hoặc **"Chạy lại"** —
  **không bao giờ** là "Xoá" / "Delete".
- **AC-G36.** *(chỉ lát B1)* *Given* **B1 đã ship nhưng B2 chưa**, *when* mở hộp thoại `rewind`, *then* nội
  dung **KHÔNG** chứa câu "Không thể hoàn tác" / "This cannot be undone" — trong khi 3 hộp thoại `resend` /
  `edit & resend` / `regenerate` **CÓ** chứa câu đó. *(Hộp thoại an toàn không được hứa điều chưa làm được —
  §7.1.)*

### 8.9. Persist của `rewind` (§4.8) — điều kiện merge của lát **B2**

- **AC-R1.** *Given* transcript 30 message và `msgs[17]` là **assistant có `eid`**, *when* `rewind` tại
  index **18** và xác nhận, *then* **khởi động lại app**, transcript mở ra còn **đúng 18 message**.
- **AC-R2.** *Given* transcript 30 message và `msgs[17]` là **user** (ca `rewind` trên turn assistant —
  phổ biến nhất), *when* `rewind` tại index **18** và xác nhận, *then* **khởi động lại app**, transcript
  còn **đúng 18 message** — **không** 30 (bug cũ) và **không** 0 (bẫy `keepThroughId: null`).
- **AC-R3.** *Given* transcript bất kỳ, *when* `rewind` tại index **0** và xác nhận, *then* khởi động lại
  app, transcript **rỗng** — cắt sạch đúng ý định.
- **AC-R4.** *Given* mọi ca AC-R1…AC-R3, *when* kiểm tra payload RPC, *then* `keepThroughId: null` **chỉ**
  xuất hiện khi **không** tìm được `eid` nào trong `msgs[0..index-1]` — không ca nào khác.
- **AC-R5.** *Given* payload rewind mang một `messageId` mà engine không biết, *when* RPC chạy, *then*
  transcript trên đĩa **không đổi** (no-op, `sidecar/src/sessions/store.ts:73-75`) — không wipe.
- **AC-R6.** *Given* `rewind` sau khi vá, *when* đọc chữ ký hàm, *then* nó vẫn **đồng bộ** (không thêm
  `async`/`await`) — không sinh cửa sổ đua mới.
- **AC-R7.** *(điều kiện tiên quyết)* *Given* một session dài mở qua `ensureLoaded`, *when* duyệt `s.msgs`,
  *then* **mọi** message đều có `eid`, **trừ** message hệ thống cục bộ `ENGINE_UNAVAILABLE` (§2.3). Nếu tìm
  thấy bất kỳ message **persist** nào thiếu `eid` ⇒ **dừng, báo tech-lead** trước khi ship B2 (§4.8).
- **AC-R8.** *Given* transcript có một message `ENGINE_UNAVAILABLE` cục bộ ngay trước điểm rewind, *when*
  `rewind` và xác nhận, *then* neo lùi tới message **có `eid`** gần nhất phía trước; khởi động lại app,
  transcript khớp đúng phần đáng lẽ còn lại — **không** wipe, **không** giữ nguyên 30.
- **AC-R9.** *(chỉ lát B2)* *Given* B2 đã merge, *when* mở hộp thoại `rewind`, *then* nội dung **CÓ** câu
  "Không thể hoàn tác" — và AC-R1…AC-R3 đồng thời pass, tức câu đó **đúng sự thật** (đảo của AC-G36).

## 9. Edge case

| ID | Tình huống | Hành vi bắt buộc |
|---|---|---|
| **E1** | **Double-click** nút destructive | Hộp thứ hai làm hộp thứ nhất resolve `false` (`useConfirm.ts:40-43`) ⇒ tối đa 1 hộp, tối đa 1 hành động. Nếu click thứ hai xảy ra **sau** khi hành động thứ nhất đã cắt, §4.6 bắt được lệch `msgs.length` ⇒ huỷ + toast. Việc này **vá luôn** lỗ re-entry sẵn có của `resend` (store chỉ có guard streaming, không có `regenInFlight` — §2.3). |
| **E2** | **Người dùng gửi tin mới trong lúc modal đang mở** | `msgs.length` tăng ⇒ §4.6 huỷ thao tác + toast `sessions.guard.stale`. Con số đã hiện trên hộp thoại **không bao giờ** được dùng để cắt một transcript khác với lúc nó được tính. |
| **E3** | Hộp thoại mở, người dùng **đi sang session khác** rồi mới xác nhận | Chốt `sessionId` + `index` tại lúc mở hộp thoại; nếu `store.activeId` đã khác ⇒ **huỷ + toast**. Không được cắt nhầm session. |
| **E4** | Bấm hành động trên message **đang streaming** | Footer assistant đã bị ẩn khi streaming (`SessionMessageItem.vue:126, 349`) ⇒ không bấm được. Footer **user bubble không bị ẩn** ⇒ vẫn bấm được: hộp thoại hiện, nhưng khi xác nhận thì §4.6 và/hoặc guard store (`3601`, `3673`) chặn ⇒ **không cắt gì** + toast. `rewind` **không có** guard streaming ở store ⇒ §4.6 là lớp bảo vệ **duy nhất**, bắt buộc phải có. |
| **E5** | **`lostCount === 0`** — "Thử lại" lượt lỗi cuối, `regenerate` câu trả lời cuối, `resend` bong bóng user cuối | **Không hỏi, chạy thẳng** (§4.4). Không có biến thể text "0 tin nhắn" nào tồn tại. Quy tắc theo **điều kiện**, không theo vị trí nút ⇒ tự đúng cho cả `SessionGateCard.vue:312-315` mà không phải sửa file đó. |
| **E6** | **`regenerate` không tìm thấy user turn phía trước** (message đầu tiên là assistant/system) | **Không mở hộp thoại, không gọi store.** Đây còn là cải thiện thật: `store.regenerate` hiện `slice(0, index)` **trước** khi biết có `ui` hay không (`sessions.ts:3604` trước `3607-3608`) ⇒ nếu không có `ui` thì transcript bị cắt trong bộ nhớ mà **không** chạy lại và **không** cắt trên đĩa. Gate ở component làm nhánh đó **không thể chạm tới từ footer**. |
| **E7** | **`rewind` tại index 0** (message đầu tiên) | `lostCount = msgs.length` (toàn bộ) ⇒ **luôn hỏi**. Xác nhận ⇒ vòng lùi của §4.8 không tìm được `eid` nào ⇒ `sessions.truncate` với `keepThroughId: null` ⇒ cắt sạch **cả trên đĩa** (AC-R3). |
| **E8** | **`rewind` mà `msgs[index-1]` không có `eid`** | Sau **T0c**, chỉ còn đúng một nguồn: message hệ thống cục bộ `ENGINE_UNAVAILABLE` (§2.3) — vốn **không nằm trên đĩa**. Xử lý: **lùi tiếp** tới `eid` gần nhất phía trước (§4.8, AC-R8). **Không** được rơi về `keepThroughId: null` chỉ vì message ngay trước thiếu id. Trước T0c thì ca này là đa số ⇒ đó là lý do B2 xếp sau T0c (TL-1). |
| **E9** | **Session chưa `loaded`** / đang `loading` / là placeholder hand-off (đã pop out) | Footer không render vì không có message ⇒ không có đường bấm. Vẫn bắt buộc guard phòng thủ: `store.active == null` hoặc `i < 0` hoặc `i >= msgs.length` ⇒ **không mở hộp thoại, không làm gì**. |
| **E10** | **Offline / sidecar chết** | Hộp thoại là 100% client-side ⇒ vẫn hiện, vẫn huỷ được. Nếu người dùng xác nhận, phần cắt trên đĩa thất bại thì rơi về hành vi hiện có của store (`console.warn` tại `3625`/`3689`) — feature này **không** đổi xử lý lỗi đó. |
| **E11** | **App crash / restart giữa chừng** | Hộp thoại không persist — mở lại app thì không còn dialog nào, và vì bước 5 (cắt) chưa chạy nên **transcript nguyên vẹn**. Restart-safe theo nghĩa "fail về phía không mất dữ liệu". |
| **E12** | **Transcript rất dài** (5.000 message) | `lostCount` là phép trừ số nguyên, **không** duyệt mảng. Riêng `regenerate` phải lùi tìm `ui`, và §4.8 phải lùi tìm `eid` — cả hai bị chặn bởi khoảng cách tới phần tử hợp lệ gần nhất, thực tế < 20 bước, thuần in-memory. |
| **E13** | **Message bị xoá/đổi từ cửa sổ khác** (popout đang sở hữu session) | Cửa sổ chính hiển thị placeholder hand-off, không render footer ⇒ không có đường bấm. Bảo vệ bởi `ownsSession` gate ([session-popout-window.md](./session-popout-window.md)). |

## 10. UI behavior

- **Component chạm:** [`components/session/SessionMessageItem.vue`](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue) — nơi duy nhất phải sửa logic UI.
- **Component dùng lại (không sửa):** `ConfirmDialogHost.vue`, `LibraryConfirmDelete.vue`, `AppGlobalHosts.vue`, `ActionToastHost`, `SessionGateCard.vue`.
- **Route mới:** không.
- **State mới ở store:** **không**. Không thêm field vào `Session`/`SessionMessage`, không thêm ref nào. Store chỉ đổi phần persist của `rewind` (§4.8, lát B2).
- **Theme token mới:** **không** — `--danger`, `--dangerBg` đã có ở cả hai theme family.
- **Trạng thái hiển thị:**
  - *Empty:* session chưa có message ⇒ không có footer ⇒ không áp dụng.
  - *Loading:* session đang hydrate ⇒ không có footer (E9).
  - *Error:* thao tác bị huỷ vì transcript đổi ⇒ toast `kind: 'error'`, TTL mặc định 3.6s.
- **Gợi ý implement (không bắt buộc):** `msgActions` (`SessionMessageItem.vue:503-518`) là mảng
  `{ icon, title, run }` ⇒ thêm cờ `danger?: boolean` cho từng item rồi bind style hover là cách rẻ nhất
  (nhớ bật cờ cho **cả** `settings`/retryModel — AC-G28); footer user bubble là template cứng nên đánh
  dấu trực tiếp trên 3 span tương ứng.

## 11. Data shape / Non-functional

**Data shape:** không có entity mới, không đổi entity cũ, không thêm event log, không đổi **định dạng**
file trên đĩa. Thay đổi duy nhất chạm đĩa: `rewind` giờ **thực sự** cắt JSONL ở mọi ca (§4.8) — dùng
RPC đã có (`sessions.rewind` / `sessions.truncate`), **không thêm method, không đổi schema**.
`types/index.ts` không đổi. (Trường `eid` cho user/system message thuộc **Brief A T0c**, không phải spec này.)

| Tiêu chí | Mục tiêu |
|---|---|
| Latency UI | Hộp thoại hiện < 1 frame sau click (state đồng bộ, không I/O). Tính `lostCount` = O(1) trừ nhánh tìm `ui` (E12). |
| Offline | **Có** — hộp thoại hoàn toàn client-side. Phần cắt đĩa là IPC nội bộ, không network. |
| Restart-safe | **Có** — huỷ giữa chừng ⇒ transcript nguyên vẹn (E11); xác nhận ⇒ trạng thái đã cắt **sống sót qua restart** (AC-R1…R3, từ lát B2). |
| Storage | Không tăng. `rewind` đúng ra còn **giảm** dung lượng JSONL vì giờ mới thực sự cắt. |
| i18n | en + vi đầy đủ (AC-G34). |
| A11y | Kế thừa `role="dialog"` + `aria-modal="true"` (`LibraryConfirmDelete.vue:4`) + Esc để huỷ. |
| Bảo mật | Không chạm filesystem trực tiếp từ UI, không network, không exec, không parse input ngoài ⇒ **không cần infosec audit**. Payload rewind vẫn đi qua zod schema sẵn có ở sidecar (`sessions.rewind.ts:14-18`). |

## 12. Open questions

### 12.1. Q1 / Q2 / Q3 — **đã chốt**

| Q | Chốt | Đã phản ánh ở |
|---|---|---|
| **Q1** — `retryModel` | **KHÔNG gate**, nhưng **CÓ** tô `danger` hover. Lý do miễn confirm được ghi lại cho đúng: **thao tác rất chủ đích, ít bấm nhầm** — **không phải** "vô hại" (nó thật sự truncate + tốn 1 lượt model). | §3.2 (ghi chú), §3.3 (4 gate / 5 danger), §4.3, AC-G2, **AC-G28** |
| **Q2** — bug persist `rewind` | **Sửa cùng PR này**, nhưng **tách lát B2** (TL-1). Hướng mirror `resend` bị **bác bỏ ở 2 chi tiết** (wipe sạch khi `prev` là user; `sessions.rewind` ≠ `sessions.truncate`). Hướng đúng: **một** quy tắc "neo vào `eid` gần nhất phía trước". | §2.5, **§4.8**, E7, E8, **AC-R1…AC-R9**, AC-G24 |
| **Q3** — "Thử lại" lượt lỗi | **Miễn confirm khi `lostCount === 0`** — diễn đạt theo điều kiện, không theo vị trí nút. Kéo theo: `regenerate` câu trả lời cuối và `resend` bong bóng user cuối cũng không hỏi. | §4.4, §5.5, E5, **AC-G5…AC-G9** |

### 12.2. TL-1 — **ĐÃ CHỐT 2026-08-26 (tech-lead): phương án (i)**

**Câu hỏi:** ca R-c — `rewind` khi `msgs[index-1]` không có `eid` (hôm nay là ca **phổ biến nhất**:
rewind trên turn assistant ⇒ `prev` là user ⇒ user chưa có `eid`). Không có id nào diễn đạt được
"giữ đến hết message này", và `keepThroughId: null` là **cấm** (wipe sạch).

**Chốt: (i) — §4.8 phụ thuộc Brief A `T0c`.** Spec này ship làm **hai lát**:

| Lát | Nội dung | Phụ thuộc | Ghi chú |
|---|---|---|---|
| **B1** | Gate 4 hành động + danger hover 6 điểm bấm + i18n + §4.6 + toast | **Không** — độc lập, ship ngay | AC-G1…AC-G36 |
| **B2** | §4.8 vá persist `rewind` + thêm câu "Không thể hoàn tác" vào hộp thoại `rewind` | **T0c** (Brief A) | AC-R1…AC-R9 |

**Lý do chọn (i), không chọn (ii):** phương án (ii) ship một **hộp thoại an toàn nói sai** ở đúng ca
phổ biến nhất. Cái giá không phải là "một dòng chữ hơi lệch" — mà là **niềm tin vào mọi hộp thoại còn
lại**: người dùng phát hiện nó sai một lần sẽ ngừng đọc cả ba cái đang nói đúng, và feature mất sạch
tác dụng đúng theo cơ chế confirm-fatigue mà §4.3 đang chống. Trong khi đó T0c **rẻ và đã được duyệt**:
id đã nằm sẵn trên đĩa cho cả 3 role (`sidecar/src/types/shared.ts:268-270`), T0c chỉ là *đọc lại thứ
đã có* — xem [ADR 0074 §Q1](../decisions/0074-session-message-anchor-and-transcript-navigation.md).

**Hệ quả bắt buộc mà (i) kéo theo — không được bỏ qua:** trong cửa sổ B1→B2, hộp thoại `rewind`
**không được** chứa câu "Không thể hoàn tác" (§7.1, AC-G36). Đây là lý do câu đó được tách thành khoá
i18n riêng `sessions.guard.irreversible` (§7, §13): B2 thêm nó bằng **một dòng diff**, không khoá nào
bị sửa hai lần.

**Ba lối thứ ba đã cân nhắc và LOẠI** (ghi lại để không ai đề xuất lại):

1. **Đảo ngữ nghĩa `messageId` của `sessions.rewind` thành "cắt từ đây" (`cutFromId`).** Thoạt nhìn rất
   hấp dẫn: `msgs[index]` — chính message người dùng bấm rewind — **có `eid` ngay hôm nay** trong ca
   phổ biến nhất (turn assistant), nên có vẻ né được T0c. **Loại vì hai lẽ.** (a) Nó **đổi hợp đồng IPC**
   của một method đang chạy ⇒ cần ADR, cần sửa sidecar — đắt hơn hẳn T0c. (b) **Nguy hiểm hơn:**
   `sessions.rewind` dùng chính `messageId` đó cho `restoreSnapshot`, mà snapshot được chụp ở **cuối
   turn** và keyed theo assistant message id (`sessions.send-message.ts:1454-1458`). Đảo ngữ nghĩa ⇒
   khôi phục file về trạng thái **sau lượt bị bỏ** — tức đúng thứ rewind đang muốn undo. Sai lệch **một
   turn**, im lặng, và biểu hiện trên **file workspace thật**. Muốn giữ đúng thì phải truyền **hai** id
   trong một lời gọi — dễ đảo nhầm, hậu quả vô hình.
2. **Đọc id thật từ đĩa ngay lúc rewind** (`sessions.get` rồi map theo vị trí). Loại: cần map index
   bộ nhớ ↔ mảng trên đĩa **theo vị trí** — đúng thứ [ADR 0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md)
   đã bác; lại biến `rewind` thành `async` (trái ràng buộc §4.8) và thêm một round-trip. Nó là bản
   **tệ hơn** của T0c cho cùng kết quả.
3. **Bốc một lát của T0c vào PR này** (chỉ lấy phần gán `eid` cho user/system). Loại: R-b muốn phủ **mọi**
   ca thì còn cần cả phần *mint `userMessageId` lúc gửi* — nếu không, message user gửi **trong phiên hiện
   tại** vẫn chưa có `eid` cho tới lần reload, và "rewind ngay sau lượt vừa chạy" lại rơi vào R-c. Mà
   phần mint đó chạm sidecar **và** mang theo yêu cầu **infosec** (regex chặn path sink). Bốc sang đây
   không làm B độc lập — chỉ **đổi nhãn** T0c và xé một thay đổi mạch lạc thành hai nửa, mỗi nửa đều
   thiếu.

**Không cần ADR mới.** §4.8 **không** thêm/đổi RPC, **không** đổi schema, **không** đổi hình dạng entity —
nó dùng đúng hai method sẵn có theo đúng ngữ nghĩa đã tài liệu hoá, và thứ khiến nó chạy được (`eid` cho
mọi role) đã được [ADR 0074 §Q1](../decisions/0074-session-message-anchor-and-transcript-navigation.md)
quyết. Đây là **thứ tự ship + tái dùng một task đã duyệt**, ghi trong spec là đủ.

**Không còn open question nào.**

## 13. i18n keys cần thêm

Thêm vào [`i18n/locales/vi/sessions.json`](../../apps/desktop/ui-next/i18n/locales/vi/sessions.json) và
[`i18n/locales/en/sessions.json`](../../apps/desktop/ui-next/i18n/locales/en/sessions.json) — key **phẳng**,
đúng convention file hiện có (`sessions.delete.*` ở dòng 105-108).

| Key | vi | en | Lát |
|---|---|---|---|
| `sessions.guard.rewind.title` | Tua về đây? | Rewind to here? | B1 |
| `sessions.guard.rewind.body` | Sẽ xoá {n} tin nhắn từ điểm này trở đi. | This removes {n} messages from here on. | B1 |
| `sessions.guard.rewind.confirm` | Cắt về đây | Rewind here | B1 |
| `sessions.guard.resend.title` | Gửi lại tin nhắn này? | Resend this message? | B1 |
| `sessions.guard.editResend.title` | Sửa & gửi lại? | Edit & resend? | B1 |
| `sessions.guard.resend.body` | Sẽ xoá {n} tin nhắn sau tin nhắn này. | This removes the {n} messages after it. | B1 |
| `sessions.guard.regen.title` | Tạo lại câu trả lời? | Regenerate this reply? | B1 |
| `sessions.guard.regen.body` | Câu trả lời này sẽ bị thay thế và {n} tin nhắn khác bị xoá. | This reply will be replaced and {n} other messages removed. | B1 |
| **`sessions.guard.irreversible`** | Không thể hoàn tác. | This cannot be undone. | **B1** (dùng cho 3 hành động chạy lại) → **B2** thêm cho `rewind` |
| `sessions.guard.rerun.confirm` | Chạy lại | Re-run | B1 |
| `sessions.guard.costNote` | Lượt chạy lại sẽ tốn thêm một lần gọi model. | Re-running costs one more model call. | B1 |
| `sessions.guard.stale` | Transcript đã thay đổi — thao tác bị huỷ. | The transcript changed — action cancelled. | B1 |

**12 key × 2 ngôn ngữ = 24 dòng — toàn bộ thêm ở lát B1.** B2 **không** thêm khoá nào, chỉ thêm một lời
gọi `t('sessions.guard.irreversible')` vào nhánh `rewind` (§7.1). Không cần key cho nút huỷ (dùng
`common.cancel` sẵn có, `common.json:9`), **không** cần key biến thể "0 message" (§4.4 khiến nó không tồn tại).

## 14. File chạm

| File | Việc | Lát |
|---|---|---|
| [`apps/desktop/ui-next/components/session/SessionMessageItem.vue`](../../apps/desktop/ui-next/components/session/SessionMessageItem.vue) | `const { confirm } = useConfirm()`; hàm tính `lostCount` + `ui` (§4.1); bọc `rewind`/`resend`/`editMsg`/`regen` bằng `await confirm(...)` **chỉ khi `lostCount ≥ 1`** + so lại `msgs.length`/session (§4.6); đánh dấu `danger` cho **6 điểm bấm** (gồm `settings`/retryModel) + rule hover mới trong `<style scoped>`. | **B1** |
| ⤷ cùng file | Thêm `t('sessions.guard.irreversible')` vào `description` của nhánh `rewind` (§7.1) | **B2** |
| [`apps/desktop/ui-next/stores/sessions.ts`](../../apps/desktop/ui-next/stores/sessions.ts) | **Boy Scout**: sửa comment sai ở 3598-3599 (*"same guard `resend` uses"* — `resend` không có `regenInFlight`). | **B1** |
| ⤷ cùng file | Vá persist của `rewind` theo quy tắc "neo vào `eid` gần nhất phía trước" (§4.8, dòng 3651-3661) — giữ hàm **đồng bộ**. **Không** thêm gì khác. | **B2** |
| [`apps/desktop/ui-next/i18n/locales/vi/sessions.json`](../../apps/desktop/ui-next/i18n/locales/vi/sessions.json) | +12 key (§13). | **B1** |
| [`apps/desktop/ui-next/i18n/locales/en/sessions.json`](../../apps/desktop/ui-next/i18n/locales/en/sessions.json) | +12 key (§13). | **B1** |

**KHÔNG chạm (bắt buộc):**

- `components/session/SessionGateCard.vue` — quy tắc `lostCount === 0` (§4.4) tự phủ `onRetry` (312-315), không cần sửa.
- `composables/useConfirm.ts`, `components/common/ConfirmDialogHost.vue`, `components/library/LibraryConfirmDelete.vue` — dùng lại nguyên trạng.
- `apps/desktop/sidecar/**`, `apps/desktop/electron/**` — **không** RPC mới, không đổi schema; §4.8 chỉ dùng lại `sessions.rewind` / `sessions.truncate` đã có. (Phần sidecar của T0c thuộc **Brief A**, không thuộc PR này.)
- `types/index.ts` — không có entity mới.
- `docs/features/session-transcript-navigation.md` và mọi ADR — do tech-lead / Brief A sở hữu.

**Trước khi báo xong:** `cd apps/desktop/ui-next && pnpm lint:fix && pnpm format && pnpm lint && pnpm typecheck`.

## 15. Out of scope (giữ nguyên chốt cứng của brief)

- **Undo / khôi phục transcript đã cắt** — cần lưu bản sao trước khi truncate (chạm JSONL + dung lượng đĩa). Spec này **ngăn** tai nạn, không **sửa** hậu quả. (Riêng `sessions.rewind` đã có đường restore **file workspace** từ snapshot, ADR 0038 — nhưng UI không truyền `projectId`, và bật nó lên **không** thuộc phạm vi này.)
- **"Đừng hỏi lại nữa"** (nhớ trong settings) — YAGNI; thêm sớm sẽ vô hiệu hoá chính feature này.
- **Sắp lại bố cục / gom 9 nút vào menu `…`** — việc của refactor UI.
- **Confirm cho bề mặt khác** (xoá session/tab/project) — đã có confirm riêng.
- **Cảnh báo ngân sách chi tiết** (số tiền, token ước tính) — thuộc [session-cost-budget.md](./session-cost-budget.md); ở đây đúng **một dòng** định tính.
- **Đường mobile remote** — `sessions.*` mutating đi qua gateway theo policy riêng ([ADR 0067](../decisions/0067-mobile-remote-control-transport.md)). Gate nằm ở component nên không ảnh hưởng đường đó (§4.7). **Lưu ý:** phần vá §4.8 nằm trong store nên **có** cải thiện đường nào gọi `store.rewind`, nhưng không mở/đổi allowlist gateway.
- **Thêm `regenInFlight` cho `resend`** — §4.6 đã chặn ca thực tế; chỉ sửa comment sai (§2.3).
- **Lưu nháp nội dung `edit & resend` khi huỷ hộp thoại** (AC-G12) — hành vi hiện tại giữ nguyên.
- **Bật `projectId` cho `sessions.rewind` để restore file** — hành vi lớn hơn hẳn, cần brief riêng.
- **Đổi ngữ nghĩa `messageId` của `sessions.rewind` / mở rộng schema `sessions.truncate`** — đã cân nhắc và **loại** ở §12.2 (lối thứ ba #1): đắt hơn T0c và làm hỏng `restoreSnapshot`.

## 16. Dependencies

| Loại | Chi tiết |
|---|---|
| **Entity hiện có** | `Session.msgs` (`SessionMessage`) — đọc để đếm; `SessionMessage.eid` — đọc để chọn nhánh persist (§4.8). Không chạm Task / Project / Workflow / Agent / Skill / Artifact. |
| **Phụ thuộc vào (UI)** | `useConfirm()` + `ConfirmDialogHost` + `LibraryConfirmDelete`; `pushActionToast` (`useActionToasts.ts:29`); `AppGlobalHosts` (host có ở cả 2 cửa sổ). |
| **Phụ thuộc vào (sidecar, đã có)** | `sessions.rewind` (`methods/sessions.rewind.ts`), `sessions.truncate` → `truncateSession` (`sessions/store.ts:55-80`). **Không đổi cả hai.** |
| **DEPENDENCY CỨNG — `B2 → T0c`** | [session-transcript-navigation.md](./session-transcript-navigation.md) **T0c** (`eid` cho user/system + mint `userMessageId` lúc gửi). **Lát B2 không được bắt đầu trước khi T0c merge** — chốt TL-1 (§12.2). **Lát B1 hoàn toàn không phụ thuộc T0c.** |
| **Feature phải khớp** | Brief A §5.4 — **thứ tự** `lostCount` → `confirm()` → so lại → `survivingIds` → prune bookmark → cắt (§6). |
| **Feature liên quan (không chặn)** | [session-popout-window.md](./session-popout-window.md), [session-cost-budget.md](./session-cost-budget.md), [human-approval.md](./human-approval.md) (cùng triết lý approval checkpoint, cấp vi mô), [sessions.md](./sessions.md). |
| **ADR** | **Không cần ADR mới** (lý do: §12.2). Chỉ để đọc: [0074](../decisions/0074-session-message-anchor-and-transcript-navigation.md) (`eid` là neo persistence — nền của T0c), [0038](../decisions/) (snapshot/rewind file restore), [0058](../decisions/) (drop `sdkSessionId` khi truncate), [0067](../decisions/0067-mobile-remote-control-transport.md), [0072](../decisions/0072-cute-theme-family.md). |
| **External** | Không. Không API model, không Git CLI, không OS notification. |
| **Thứ tự ship (chốt)** | **B1** (gate + danger hover + i18n, ship ngay, độc lập) → *chờ T0c merge* → **B2** (§4.8 + câu "Không thể hoàn tác" cho `rewind`). |

## 17. Liên kết

- **Brief:** [session-destructive-action-guard.brief.md](./session-destructive-action-guard.brief.md)
- **Spec anh em (khớp thứ tự cắt + dependency B2 → T0c):** [session-transcript-navigation.md](./session-transcript-navigation.md)
- **ADR nền cho T0c:** [0074 — Neo tin nhắn bền + hợp đồng điều hướng transcript](../decisions/0074-session-message-anchor-and-transcript-navigation.md)
- **Bối cảnh:** [sessions.md](./sessions.md), [session-popout-window.md](./session-popout-window.md), [session-cost-budget.md](./session-cost-budget.md), [human-approval.md](./human-approval.md)
- **VISION:** [artifacts/VISION.md](../../artifacts/VISION.md) — *"Humans remain in control through approval checkpoints"*
- **MVP scope:** [mvp-scope.md](../requirements/mvp-scope.md) — tiêu chí thành công #9 (state persistent trên đĩa)
- **Convention UI:** `.claude/rules/nuxt-vue.md` (nút destructive hover `dangerBg` + `danger`), [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md)
- **Kiến trúc:** [system-overview](../architecture/system-overview.md), [data-model](../architecture/data-model.md), [execution-model](../architecture/execution-model.md)
