# Feature Spec — Cải thiện UX các overlay/modal (Session + Library)

> Loại: UI/UX polish (không đổi data model, không đụng sidecar/IPC).
> Phạm vi: `ui-next` renderer. Chỉ frontend Nuxt/Vue.
> Persona: **người dùng cuối** đang sửa prompt / tạo entity qua chat / thêm ghi chú trích dẫn.

## Bối cảnh & tham chiếu code

| # | Chủ đề | File | Dòng |
|---|---|---|---|
| 1 | Textarea creator `rows=2` khó nhìn với prompt dài | `apps/desktop/ui-next/components/library/LibraryCreatorPanel.vue` | 60-67 (template), `.lcp-ta` CSS |
| 2a/2b | Modal: chặn đóng khi click backdrop + ESC toàn cục + auto-focus | `SessionPromptEditOverlay.vue`, `SessionDetail.vue` note popover (267-296) | — |

Ràng buộc convention (bắt buộc tuân thủ, tránh regress):

- **Theme token**: mọi màu qua CSS var `var(--bg)`, `var(--border)`, `var(--accent)`… — không hardcode hex. Cả 2 file hiện đã theo đúng.
- **`<script setup lang="ts">`**, type-only props/emits, `strict` on.
- **Thin template**: pattern lặp giữa nhiều overlay → tách composable (đã áp dụng — xem "Tách composable").
- **Badge/hint dùng `text-[12px]` fixed; body text dùng `text-[1em]`** (ở đây CSS scoped nên áp bằng biến font tương ứng).

---

## Issue 1 — LibraryCreatorPanel textarea `rows=2` khó nhìn với prompt dài

### Hành vi hiện tại

`LibraryCreatorPanel.vue`:

```
<textarea v-model="promptText" class="lcp-ta" rows="2" ... @keydown.enter.exact.prevent="onSend" />
```

CSS `.lcp-ta` có `resize: none`, `rows=2` cố định. Khi người dùng dán/soạn prompt dài, ô chỉ cao 2 dòng, phải cuộn nội bộ → khó đọc lại toàn bộ trước khi gửi. Enter (không kèm modifier) = gửi ngay (`@keydown.enter.exact.prevent="onSend"`); đa dòng nhập bằng Shift+Enter.

### Hành vi mong muốn (đã chốt: auto-grow)

Textarea **tự cao theo nội dung**, từ `min` (~2 dòng) tới `max` (cap 200px) rồi mới cuộn nội bộ. Height reset về min khi gửi và khi mở lại panel.

**Quyết định kỹ thuật:** dùng JS đo `scrollHeight` (deterministic, không phụ thuộc phiên bản Chromium của Electron) thay vì CSS `field-sizing: content`. Cụ thể:

- Template ref `taRef` + hàm `autoGrowTextarea()`: đặt `style.height = 'auto'` rồi `style.height = min(scrollHeight, 200)px`.
- `watch(promptText)` gọi `autoGrowTextarea` trong `nextTick` (bắt cả gõ + dán + reset).
- CSS `.lcp-ta`: `min-height: 2.6em` (sàn ~2 dòng, scale theo font-size), `max-height: 200px`, `overflow-y: auto`.
- Reset về min: `onSend` set `promptText=''` → watch chạy; mở lại panel remount textarea (`v-if="open"`) → về min-height CSS.

### Acceptance Criteria

- **AC1.1** — Given ô nhập trống, When panel mở, Then ô cao tối thiểu ~2 dòng.
- **AC1.2** — Given người dùng nhập/dán prompt nhiều dòng, When nội dung tăng, Then ô cao dần tới `max-height` (200px) rồi mới xuất hiện scrollbar nội bộ.
- **AC1.3** — Given ô đã cao (prompt dài), When người dùng gửi (Enter) và `promptText` reset về rỗng, Then ô co lại về min-height.
- **AC1.4** — Given `isStreaming = true` (ô `:disabled`), When đang chạy, Then auto-grow không gây layout shift che log/nút.
- **AC1.5** — Given ô cao tối đa, When nội dung tiếp tục dài, Then log chat phía trên và hàng nút Send (`.lcp-row`) vẫn hiển thị đầy đủ.

### Edge cases

- Dán 500+ dòng: clamp `max-height` (200px), cuộn nội bộ — không nuốt cả modal.
- Xóa hết nội dung: ô co lại (reset `style.height = 'auto'` trước khi đo lại).
- Enter gửi: gửi → reset height, không mâu thuẫn auto-grow.
- Font-size thay đổi qua Appearance setting (`--font-size-base`): min-height `2.6em` scale đúng; cap `200px` cố định (số dòng hữu dụng giảm ở font lớn — chấp nhận, vẫn cuộn nội bộ).

---

## Issue 2 — Hành vi modal/dialog: chặn đóng khi click backdrop + ESC toàn cục + auto-focus

Áp dụng cho **cả** `SessionPromptEditOverlay.vue` và **note popover** trong `SessionDetail.vue` (267-296).

### 2a. Không đóng khi click ra ngoài (backdrop)

**Hiện tại (trước fix):**

- `SessionPromptEditOverlay.vue`: `<div v-if="state" class="pe-ovl" @click.self="cancel">` — click backdrop **đóng** (hủy chỉnh sửa, mất draft).
- Note popover `SessionDetail.vue`: `<div class="notebackdrop" @mousedown="notePop = null" />` — click backdrop **đóng** popover, mất `noteText` chưa lưu.

**Mong muốn:** chỉ đóng qua **nút close (X) / Cancel / Close** hoặc **phím ESC**. Click backdrop **không** đóng (tránh mất nội dung đang soạn do lỡ tay).

**Đã sửa:**
- `SessionPromptEditOverlay`: bỏ `@click.self="cancel"`.
- Note popover: bỏ `@mousedown="notePop = null"` khỏi `.notebackdrop` (giữ backdrop chỉ để chặn tương tác nền).

### 2b. ESC toàn cục (đóng từ mọi vị trí focus)

**Vấn đề:** ESC trước đây gắn trực tiếp trên `<textarea>` → chỉ bắt được khi focus trong ô. Focus rời ô (nút, drag handle, backdrop) thì ESC mất tác dụng.

**Đã sửa:** chuyển sang **window-level keydown listener** qua composable `useEscToClose` (đăng ký khi mount, gỡ khi unmount, gate theo state mở). Gỡ handler ESC cũ trên textarea để tránh double-fire.

- `SessionPromptEditOverlay`: `useEscToClose(() => !!state.value, cancel)` — `preventDefault` mặc định (chặn ESC lan ra ngoài).
- Note popover: `useEscToClose(() => isActive.value && !!notePop.value, () => { notePop.value = null })` — gate thêm `isActive` để instance `<KeepAlive>` cache (session switch đi khi popover còn mở) **không** nuốt ESC của session đang hiển thị.

### 2c. Auto-focus ô input khi mở

**Đã đạt sẵn** (giữ nguyên, đảm bảo không regress):

- `SessionPromptEditOverlay`: `watch(state, ...)` + `nextTick` + `el.focus()` + `setSelectionRange` (caret cuối).
- Note popover: `focusNoteInput()` gọi trong `openNote()`, caret cuối.

### Acceptance Criteria

- **AC2.1 (backdrop)** — Given overlay/popover đang mở với nội dung đang soạn, When click vào vùng nền (backdrop) ngoài card, Then modal **không** đóng, nội dung giữ nguyên.
- **AC2.2 (ESC)** — Given overlay/popover đang mở, When nhấn ESC (bất kể focus ở textarea hay không), Then modal đóng đúng như nút Cancel/Close.
- **AC2.3 (nút)** — Given modal mở, When click nút X / Cancel / Close, Then modal đóng.
- **AC2.4 (auto-focus)** — Given modal/popover vừa mở, When render xong (`nextTick`), Then ô nhập chính được focus, caret ở cuối nội dung seed (nếu có).
- **AC2.5 (cleanup listener)** — Given đã đăng ký window keydown listener, When component unmount, Then listener được gỡ (không leak).
- **AC2.6 (không nuốt ESC chéo — KeepAlive)** — Given nhiều `SessionDetail` cache dưới `<KeepAlive>`, When nhấn ESC ở session đang hiển thị, Then chỉ instance `isActive` xử lý; instance cache (dù còn `notePop`) không đóng nhầm/nuốt ESC.

### Edge cases

- **Nội dung rỗng**: nút Confirm `:disabled="!draft.trim()"`; ESC/Cancel vẫn đóng được kể cả khi rỗng.
- **IME (tiếng Việt/CJK)**: ESC có thể bị IME nuốt để hủy composition trước — chấp nhận (hành vi trình duyệt chuẩn).
- **`preventDefault`**: session overlay dùng `preventDefault: true` (chặn ESC lan ra); các modal cũ (`SettingsModal`, `LibraryEntityModal`) giữ `preventDefault: false` như trước.
- **Nhiều overlay ở window cùng lắng nghe ESC**: hiện các overlay không mở chồng trong flow → không đóng nhầm. Nếu tương lai cho mở chồng, cần gate z-order.

---

## Ảnh hưởng chéo (cross-cutting)

- **`useCommandPalette`** điều khiển vòng đời `SessionPromptEditOverlay` (`promptEdit`, `confirmPromptEdit`, `cancelPromptEdit`). Fix backdrop/ESC không đổi contract này (vẫn gọi `cancelPromptEdit`/`confirmPromptEdit`); các hàm này idempotent nên bỏ backdrop-close không gây double-resolve.
- **`LibraryCreatorPanel`** dùng chung bởi skills/agents/commands/rules/hooks. Issue 1 (auto-grow) ảnh hưởng **mọi** trang creator → regression check tất cả nơi dùng.
- **AWOG local-first / restart-safe**: các thay đổi thuần UI ephemeral, không đụng persistence/resume/approval gate/trace/git/tray. Không có concern offline/concurrent.
- **KeepAlive**: `SessionDetail` chạy dưới `<KeepAlive>`. Window keydown listener gate theo `isActive` (trong getter `isOpen` của `useEscToClose`) để instance cache không nuốt ESC.

## Tách composable (Rule of Three) — đã áp dụng

Pattern **window ESC + gate theo state mở + mount/unmount cleanup** lặp ở `SettingsModal`, `LibraryEntityModal`, `SessionPromptEditOverlay`, note popover → đủ ngưỡng abstract. Đã tách [`composables/useEscToClose.ts`](../../apps/desktop/ui-next/composables/useEscToClose.ts):

```ts
useEscToClose(isOpen: MaybeRefOrGetter<boolean>, onClose: () => void, options?: { preventDefault?: boolean })
```

Adopt ở cả 4 site; điều kiện gate riêng (`isActive`, `lockScrim`, `state`) truyền qua getter `isOpen`.

## Open Questions (đã chốt)

- **OQ-1 — Bỏ đóng-khi-click-backdrop có cần confirm khi có draft?** → Đóng thẳng qua ESC/Cancel (draft ephemeral, người dùng chủ động).
- **OQ-2 — Auto-grow dùng CSS `field-sizing` hay JS?** → JS đo `scrollHeight` (deterministic, không phụ thuộc phiên bản Chromium).
- **OQ-3 — Cap auto-grow theo px hay `em`?** → min-height `2.6em` (scale theo font); cap `200px` cố định (chấp nhận).
- **OQ-4 — Mở rộng chính sách ESC/focus cho toàn app?** → Đã tách `useEscToClose` dùng chung; các modal khác có thể adopt dần khi chạm tới.

---

## Trạng thái

Đã implement + review (code-reviewer Approve, qa-tester không bug chặn) + lint/typecheck sạch. Spec thuần UI, không đụng kiến trúc/data — không cần ADR.
