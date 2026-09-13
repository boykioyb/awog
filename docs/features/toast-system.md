# Hệ thông báo (toast)

App có **đúng một** bề mặt toast: composable `useToast()` + host `AppToaster.vue`.
API call-site cố ý giống [Toast của Nuxt UI](https://ui.nuxt.com/docs/components/toast),
nhưng **không** cài `@nuxt/ui` — dựng trên primitive Toast của `reka-ui` (đã có sẵn
trong `package.json`).

- Composable: [`composables/useToast.ts`](../../apps/desktop/ui-next/composables/useToast.ts)
- Host: [`components/common/AppToaster.vue`](../../apps/desktop/ui-next/components/common/AppToaster.vue),
  mount trong [`AppGlobalHosts.vue`](../../apps/desktop/ui-next/components/AppGlobalHosts.vue)

## Vì sao không cài `@nuxt/ui`

Nuxt UI v4 cài bằng `@import "tailwindcss"; @import "@nuxt/ui";` — đó là cú pháp
**Tailwind v4**, trong khi repo ở **Tailwind 3.4**. Kèm theo, module tự đăng ký
`@nuxt/icon` + `@nuxt/fonts` + `@nuxtjs/color-mode`, cả ba **trùng vai** với thứ AWOG
đã tự làm: icon là SVG sprite (`Icon.vue` → `<use href="#i-name">`), font là
`@fontsource-variable/geist` bundle offline (local-first), theme là `useTheme()` +
`body[data-theme-family]`. Cộng thêm token `--ui-*` của Nuxt UI đè lên
`--fs-*` / `--r-*` / `--icon-*` mà `scripts/check-design-tokens.mjs` đang canh.

`reka-ui` có đủ `ToastProvider / ToastViewport / ToastRoot / ToastTitle /
ToastDescription / ToastAction / ToastClose` — chính là thứ Toast của Nuxt UI bọc lại.
Nên ta lấy được **cùng API + cùng hành vi** với **zero dependency mới**.

## Trước đó có 5 hàng đợi toast

| Hệ cũ | Vấn đề |
|---|---|
| `useToasts()` — per-caller, 163 call / 17 file | 19 bản sao markup `.toast`; `.toast` là `position:fixed; bottom:28px; left:50%` **không có wrapper stacking** ⇒ toast thứ hai **đè lên** toast thứ nhất |
| `pushActionToast()` — singleton | Tồn tại chỉ vì `position:fixed` trong ancestor có `transform` (composer) neo theo ancestor, không theo viewport |
| `useQuotaGuard()` | Queue + host riêng |
| `useCodeWorkspace()` | Queue riêng, TTL 2600ms, style `.codetoast` riêng |
| `pages/schedules.vue` | Queue inline trong page |

Ngoài ra chỉ `pushActionToast` tôn trọng `settings.notifications.toastPosition`;
19 queue kia ghim cứng bottom-center.

## API

```ts
const toast = useToast()

toast.add({ title: 'Đã lưu', color: 'success' })

toast.add({
  title: 'Push thất bại',
  description: "error: failed to push some refs\nhint: Updates were rejected…",
  color: 'error',
  duration: 10_000,
  close: true,
  actions: [{ label: 'Pull rồi thử lại', icon: 'refresh', onClick: retry }],
})

const t = toast.add({ id: 'sync', title: 'Đang đồng bộ…', duration: 0 })
toast.update('sync', { title: 'Xong', color: 'success', duration: 3000 })
toast.remove(t.id)
toast.clear()
```

| Field | Ý nghĩa |
|---|---|
| `id` | Ổn định ⇒ `add` lần hai **update tại chỗ** thay vì đẻ dòng mới |
| `title` | Một dòng, truncate — giữ tính quét nhanh |
| `description` | **Xuống dòng được** (`white-space: pre-wrap`) — lỗi git nhiều dòng phải đọc được nguyên vẹn |
| `icon` | Tên sprite (`components/Icon.vue`), **không** phải id Iconify. Mặc định theo `color` |
| `color` | `primary` · `success` · `error` · `warning` · `info` · `neutral` → map sang token theme, không bao giờ hex |
| `duration` | ms. **`0` = không tự tắt** (reka-ui bỏ timer khi `<= 0`). Mặc định 5000, hoặc 8000 nếu có `actions`/`onClick` |
| `close` | Nút ✕. **Tự bật khi `duration: 0`** — toast không hết hạn mà không đóng được là vật cản vĩnh viễn |
| `actions` | Nút trong toast |
| `onClick` | Bấm cả toast = chạy rồi đóng (kiểu thông báo GitHub) |
| `type` | A11y của reka-ui: `foreground` (mặc định) ngắt lời, `background` xếp hàng |

Cap `MAX_VISIBLE = 5`: đẩy quá thì bỏ cái cũ nhất, không để cột cao quá cửa sổ.

## Hình thức

Thân toast **trung tính** (`background: var(--bgEl)`, `border: 1px solid var(--border)`).
Màu ngữ nghĩa chỉ nằm ở **icon** và **thanh tiến trình 2px** dưới đáy — giống toast thật
của Nuxt UI. Bản đầu tô `border-color` theo `color` (kế thừa thói quen của `.toast` cũ và
`ActionToastHost`) và bị bác: một vòng sáng quanh cả thẻ là thứ chói nhất trên màn hình,
cho một thông điệp thường chỉ là "đã xong".

Thanh tiến trình lấy `remaining / duration` từ slot của `ToastRoot` (reka chạy
`useRafFn` 60fps và **đóng băng** giá trị khi timer pause, nên thanh dừng theo). Đổi lại,
mỗi toast đang hiện re-render 60 lần/giây — chấp nhận được với cap 5, và Nuxt UI cũng làm
đúng vậy. `duration: 0` ⇒ không có thanh.

## Những điều host phải giữ

- **Timer thuộc về `ToastRoot`**, không phải `useToast`. Nhờ vậy có sẵn
  pause-on-hover, pause khi cửa sổ mất focus, swipe-to-dismiss, và landmark `F8`.
- **`<style>` KHÔNG scoped.** `ToastViewport`/`ToastRoot` của reka-ui render qua
  `Primitive` (root là fragment lúc compile) nên Vue không đóng được `data-v-*` vào
  chúng — `<style scoped>` khớp **không gì cả** và toaster render thành `<ol>` trần ở
  cuối document (đã đo). Tên class `.tst*` là duy nhất nên global an toàn, và
  `theme-cute.css` vốn đã nhắm `.tst` từ stylesheet global.
- **Viewport `pointer-events: none`, toast `pointer-events: auto`.** Viewport luôn
  mount và rộng bằng toast rộng nhất có thể ⇒ nếu nhận click thì nó nuốt click ở góc
  đó ngay cả khi rỗng.
- **`retire()` hoãn `remove` 140ms.** Lúc `update:open` bắn ra thì `open` đã `false` và
  `ToastRoot` đang chạy exit; xoá khỏi queue ngay sẽ unmount item `v-for` giữa chừng.
- **`box-shadow: var(--shadow-md)`**, không phải `rgba(0,0,0,.5)` của prototype — giá
  trị đó chỉ đúng cho dark, sang light đọc thành mảng xám nặng.
- **Theme Cute phải gate animation theo `[data-state='open']`.** Rule cũ đặt
  `animation: cute-pop` thẳng lên `.toast`; toast lại **có** trạng thái `closed`, nên
  animation *vào* bị phát lại lúc *ra* — toast nhấp hiện lại rồi mới biến mất.

## Vị trí

Đọc `settings.notifications.toastPosition` (Settings → Thông báo). Mỏ neo dưới xếp
ngược lên (`column-reverse`) để cái mới nhất luôn sát mép; mỏ neo trên xếp xuống và
chừa 56px cho thanh top 44px. Hướng swipe đi ra xa tâm màn hình theo góc đang chọn.

## Cái gì KHÔNG phải toast

- **Lỗi validate trong form** (`SettingsModels.apiKeyError`, `SettingsProviderCard.error`,
  `SettingsAccountEditDialog.error`, `SettingsKeymap.error`, `SettingsOAuthDialog.error`,
  `SettingsCodexDialog.error`) — ở cạnh field, chuyển thành toast là làm tệ đi.
- **`useConfirm()` / `ConfirmDialogHost`** — hộp thoại chặn, khác hẳn thông báo thoáng qua.
- **Native notification** (`useNativeNotify`) — cấp OS, dùng khi cửa sổ mất focus.
