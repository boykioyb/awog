# 0075 — Phạm vi transcript theo "surface": `scrollToMessage` query trong root, không query `document`

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-26
- **Người quyết định:** Tech Lead (AWOG)
- **Quan hệ:** **Amend phần T0a / §Q2 của [ADR 0074](0074-session-message-anchor-and-transcript-navigation.md)** (hợp đồng "mở render-window rồi scroll"). Phần còn lại của ADR 0074 — Q1 (neo bằng id bền), Q3 (rename `FindBar`), ranh giới data-find ↔ DOM-highlight — **giữ nguyên hiệu lực**. Chỗ nào ADR 0074 §Q2 nói khác ADR này thì **ADR này thắng**.
- **Chặn:** task **T0a** của [session-transcript-navigation.md](../features/session-transcript-navigation.md) — phát hiện sau khi ADR 0074 được chấp nhận, trước khi dev bắt đầu code.

## Bối cảnh

ADR 0074 §Q2 chốt rằng `useSessionScroll().scrollToMessage(i)` trở thành async, gọi một *revealer* do `SessionTranscript` đăng ký, rồi query `[data-mi="i"]`. Bản gốc quy định:

- registry là **singleton cấp module**, đăng ký ở `onMounted` + `onActivated`, huỷ ở `onDeactivated` + `onUnmounted`, "bản activate sau cùng thắng";
- bước query giữ nguyên `document.querySelector('[data-mi="i"]')` như code hiện tại (`composables/useSessionScroll.ts:9`).

Cả hai giả định đó **sai** khi có nhiều `SessionTranscript` cùng sống. Verify tận file:

| Sự thật | Nơi verify |
|---|---|
| `SessionTranscript` được mount ở **hai** nơi, cả hai đều bind `store.active` (**cùng một session**) | `components/session/SessionDetail.vue:261`, `components/ssh/SshSessionPanel.vue:89` |
| `SshWorkspace` giữ **mọi** terminal tab bằng **`v-show`**, kèm comment chủ đích: *"Terminal tabs stay MOUNTED (v-show, never v-if) so switching tabs never disconnects a live SSH shell"* | `components/ssh/SshWorkspace.vue:62-64, 102-104` |
| Mỗi tab có thể bật dock co-pilot độc lập (`activeDock[tab.id] === 'session'`) → mỗi tab một `SshSessionPanel` | `components/ssh/SshWorkspace.vue:184-190` |
| `data-mi` là **chỉ số mảng**, gắn ở cả 3 nhánh role | `components/session/SessionMessageItem.vue:3, 11, 69` |
| `SshSessionPanel` **không** có vòng đời `onActivated`/`onDeactivated` — nó mount rồi ở yên trong tab bị `display:none` | `components/ssh/SshSessionPanel.vue` (không dùng `<KeepAlive>`) |

Hệ quả cụ thể, không phải giả thuyết:

1. Mở co-pilot ở **hai** tab SSH ⇒ **nhiều `SessionTranscript` của cùng một session** nằm trong document sống, trùng nguyên dải giá trị `data-mi`.
2. `document.querySelector` trả về phần tử **đầu tiên theo document order** — rất có thể thuộc một tab đang `display:none`.
3. `scrollIntoView` trên phần tử trong subtree `display:none` là **no-op**.

⇒ Click bookmark / anchor follow-up **không làm gì cả, im lặng**. Đây **đúng là** dạng lỗi mà ADR 0074 tồn tại để diệt ("thất bại im lặng"), chỉ đổi nguyên nhân: không phải "chưa mount" mà là "trúng nhầm bản sao đang ẩn".

Quan trọng: **root-scoped thôi là chưa đủ.** Sửa `document.querySelector` thành `root.querySelector` chỉ chữa *phạm vi query*, không chữa *chọn nhầm transcript* — vì "singleton, bản activate sau cùng thắng" không có tín hiệu nào để phân định khi nhiều `SshSessionPanel` mount song song mà không bao giờ activate/deactivate. Phải giải cả hai.

Rủi ro này **đã tồn tại từ trước** với anchor badge của follow-up quote. Đó là lý do **phải sửa**, không phải lý do được bỏ qua: T0a là lần đầu tiên có người chạm đúng vào hàm này.

## Quyết định

**Registry kèm `root`, VÀ chọn transcript theo cấu trúc cây (`provide`/`inject`) — bỏ hẳn singleton cấp module. `document.querySelector` bị gỡ khỏi `useSessionScroll`.**

Ba phần, cả ba bắt buộc:

### 1. Registry mang theo root — query không bao giờ chạm `document`

`registerTranscriptRevealer` nhận **một entry có root**, không phải một hàm trần:

```
type TranscriptEntry = {
  root: () => HTMLElement | null      // = msgsEl của SessionTranscript (.msgs)
  reveal: (msgIndex: number) => Promise<void>
}
registerTranscriptRevealer(entry: TranscriptEntry): () => void
```

Bước 3 trong chuỗi `scrollToMessage` của ADR 0074 §Q2 đổi từ `document.querySelector(...)` thành `entry.root()?.querySelector('[data-mi="i"]')`. **Không có entry ⇒ `return 'not-found'` ngay**, không bao giờ rơi về `document`.

### 2. Chọn transcript bằng `provide`/`inject` theo *surface*

- Composable mới `composables/useTranscriptSurface.ts` giữ đúng **một** injection key và cung cấp `provideTranscriptSurface()` (tạo `shallowRef<TranscriptEntry | null>(null)` rồi `provide`).
- **`SessionDetail.vue` và `SshSessionPanel.vue`** mỗi cái gọi `provideTranscriptSurface()` đúng **một lần** ở setup. Đây là hai — và chỉ hai — "surface" hợp lệ hiện nay.
- `SessionTranscript` `inject` ref đó và ghi entry của chính nó ở `onMounted`; `onUnmounted` chỉ clear khi con trỏ **vẫn là chính nó**.
- `useSessionScroll()` `inject` **cùng** ref ⇒ mọi caller tự động phân giải về transcript **của surface chứa nó**: anchor badge trong `SessionMessageItem` (con của transcript), follow-up card trong `SessionComposer` (anh em của transcript), thanh bookmark và thanh find (con của `SessionDetail`). **Không caller nào phải biết mình đang ở surface nào.**

### 3. Phần tử ẩn cũng là `'not-found'`

Sau khi tìm được `el`, nếu `el.getClientRects().length === 0` (nằm trong subtree `display:none`) thì **trả `'not-found'`**, không gọi `scrollIntoView`. Một `scrollIntoView` no-op im lặng chính là dạng lỗi cả feature này đi chống; biến nó thành giá trị trả về để caller còn phản ứng được (bookmark → toast + hiển thị dangling; find → bỏ qua match). Guard này chạy **sau** reveal + `nextTick`, không phải trước.

## Phương án đã cân nhắc

- **Giữ `document.querySelector` + thêm một ca QA.** Loại. Đây không phải rủi ro xác suất thấp mà là **sai theo cấu trúc**: `v-show` giữ tab mount là hành vi *chủ đích* của `SshWorkspace`, nên chỉ cần người dùng mở co-pilot ở hai tab là lỗi xảy ra **tất định**. Đổi một dòng selector để đóng vĩnh viễn rẻ hơn nhiều so với một dòng trong bảng QA phải nhớ mãi.
- **Root-scoped nhưng vẫn singleton cấp module.** Loại. Chữa được *phạm vi query* mà không chữa được *chọn nhầm transcript*: nhiều `SshSessionPanel` mount song song không phát ra tín hiệu activate/deactivate nào để phân định "cái nào đang dùng".
- **Truyền `surfaceId` làm tham số của `scrollToMessage`.** Loại. Buộc mọi call site phải biết mình thuộc surface nào — kể cả `SessionMessageItem` nằm sâu trong cây ⇒ prop-drilling xuyên nhiều tầng, đúng thứ ADR 0074 §Q2 đã loại khi bác phương án template ref (Law of Demeter).
- **Đặt `data-mi` thành khoá phức (`data-mi="{engineId}:{i}"`).** Loại. Không giải được gì: hai transcript của **cùng** session vẫn trùng khoá — mà đó chính là ca đang hỏng. Đồng thời phải đổi một attribute nhiều nơi đang đọc.
- **Đổi `SshWorkspace` sang `v-if` cho terminal tab.** Loại. Nằm ngoài phạm vi feature và phá đúng thứ `SshWorkspace` cố ý bảo vệ (không disconnect shell đang sống khi chuyển tab). Feature phải **thích ứng** với `v-show`, không bắt `v-show` thích ứng với feature.

## Hệ quả

**Tích cực**

- Đóng vĩnh viễn một lớp lỗi "click im lặng" cho **mọi** caller hiện tại và tương lai của `scrollToMessage`, kể cả anchor follow-up sẵn có trong SSH co-pilot.
- **T0a ĐƠN GIẢN HƠN bản gốc, không phức tạp hơn.** Vì phạm vi giờ là **cấu trúc** chứ không phải **thời gian**, cặp `onActivated` / `onDeactivated` mà ADR 0074 §Q2 yêu cầu **bị bỏ**; đăng ký chỉ còn `onMounted` / `onUnmounted`. `SessionDetail` bị `<KeepAlive>` deactivate vẫn giữ surface ref trỏ đúng transcript của nó — vô hại, vì không có ai trong subtree đó đang bấm.
- Không đụng `SshWorkspace`, không đụng `data-mi`, không đụng call site nào.

**Tiêu cực / Trade-off**

- Thêm 1 file composable rất nhỏ + 2 lời gọi `provideTranscriptSurface()`.
- Đổi chữ ký `registerTranscriptRevealer` so với ADR 0074 §Q2 — **chi phí bằng 0 tại thời điểm này** vì T0a chưa có dòng code nào; nhưng ai đọc ADR 0074 mà bỏ qua ADR này sẽ code sai chữ ký. Đã ghi con trỏ ở dòng Trạng thái của 0074 và trong bảng index.

**Rủi ro còn lại**

- Một surface **mới** trong tương lai mount `SessionTranscript` mà **quên** `provideTranscriptSurface()` → mọi lần nhảy trả `'not-found'`. Fail **loud** (có toast), không fail silent — chấp nhận được. AC-N9 canh đúng chỗ này.

**Việc cần làm tiếp**

- **Dev (T0a):** implement 3 phần trên. **Điều kiện review:** grep `apps/desktop/ui-next/composables/useSessionScroll.ts` **không được còn chuỗi `document.querySelector`**.
- **File chạm thêm** so với danh sách T0a của ADR 0074: `composables/useTranscriptSurface.ts` (mới), `components/session/SessionDetail.vue` (+ `provideTranscriptSurface()`), `components/ssh/SshSessionPanel.vue` (+ `provideTranscriptSurface()` — **bắt buộc**, thiếu là anchor follow-up trong SSH co-pilot luôn trả `'not-found'`).
- **BA:** đã phản ánh vào [spec](../features/session-transcript-navigation.md) §4 T0a, §5.0, §10.1, §10.5, §12.1, §13, §16, §17.
- **QA — AC bắt buộc:**
  - **AC-N9:** *Given* mở co-pilot SSH ở **2 tab** (cả hai mount `SessionTranscript` của **cùng** session, 1 tab đang ẩn vì `v-show`), *when* ở `SessionDetail` click một bookmark/anchor trỏ tới tin nhắn ngoài render-window, *then* transcript **của `SessionDetail`** cuộn tới đúng tin nhắn + flash; **không** thao tác nào tác động lên transcript trong tab ẩn; hàm **không** trả `'ok'` khi phần tử nằm trong subtree ẩn.
  - **AC-N10:** *Given* T0a đã xong, *when* grep `useSessionScroll.ts`, *then* **không còn** `document.querySelector`.
- **infosec:** không áp dụng — thuần UI, không chạm filesystem / network / exec / parse, không mở bề mặt mới.

## Tham chiếu

- [ADR 0074](0074-session-message-anchor-and-transcript-navigation.md) — ADR bị amend (phần T0a / §Q2)
- [ADR 0064](0064-session-ssh-link.md) — SSH co-pilot, surface thứ hai mount `SessionTranscript`
- [session-transcript-navigation.md](../features/session-transcript-navigation.md) — spec tiêu thụ hợp đồng này (T0a)
- `components/ssh/SshWorkspace.vue:62-64, 102-104` — lý do `v-show` (giữ shell sống khi chuyển tab)
