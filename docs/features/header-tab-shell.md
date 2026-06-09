# Header Tab-Bar Shell (đa-tab keep-alive)

## Vấn đề

Shell cũ dùng `NavRail` (sidebar trái) + file-based routing. Mỗi lần đổi mục
(Tasks/Sessions/…), Nuxt **unmount** trang cũ rồi mount trang mới → mất state (scroll,
lựa chọn, soạn dở), và không mục nào "chạy nền" song song. Người dùng muốn một shell kiểu
**cửa sổ đa-tab**: nav nằm trên header, nhiều mục sống cùng lúc, dễ theo dõi.

## Quyết định

- **Bỏ sidebar trái**, nav chuyển lên **thanh tab ngang trên header** (`components/HeaderTabBar.vue`).
- **Mô hình tab:** *fixed strip* — cả 10 mục (Tasks, Sessions, Projects, Workflows, Agents, Skills,
  Git, Connections, Hooks, Commands) luôn hiện như tab cố định, click để chuyển. Tràn → cuộn ngang.
- **Mật độ:** icon + label (giống NavRail mở rộng). Cụm tiện ích bên phải: What's New, Settings,
  theme toggle (icon-only + tooltip). Bỏ nút Collapse và toàn bộ logic mobile drawer (desktop app).
- **Style — Liquid Glass (macOS):** header trong mờ + `backdrop-blur` + đường viền hairline phát sáng
  + specular highlight ở mép trên + đổ bóng nhẹ (nổi như kính). Mỗi tab là **glass pill** (`rounded-xl`,
  cao 32px, cách nhau `gap-1.5`): active = lozenge kính sáng (`glassActive` + ring `glassBorder` + sheen
  + shadow), hover = `glassHover`, idle = trong suốt. Logo + nút tiện ích cũng là glass surface (rounded).
  Phân vùng rõ: logo · tab strip (cuộn ngang, tab `flex-shrink-0` không bị bóp) · divider hairline · tiện ích.
  Token glass thêm vào `utils/themes.ts` (`glassBg/glassBorder/glassHighlight/glassActive/glassHover`,
  dark + light) — màu vẫn đi qua `useTheme()`, không hardcode. **Glass đã trải ra toàn app** qua
  composable `useGlass()` + công tắc Settings → Appearance: xem [liquid-glass.md](liquid-glass.md).
- **State sống lâu dài:** bật **keep-alive** cho các trang section qua `<NuxtPage :keepalive="true" />`
  trong [app.vue](../../apps/desktop/ui/app.vue).

## Cơ chế keep-alive

Với `<KeepAlive>`, `setup()`/`onMounted` của trang chỉ chạy **một lần** ở lần kích hoạt đầu; các
lần đổi tab sau dùng `onActivated`/`onDeactivated`. `onBeforeUnmount`/`onUnmounted` chỉ chạy khi
cache bị evict hoặc app đóng. Hệ quả:

- Trang `subscribe()` trong `onMounted` **không** đăng ký trùng — subscription sống suốt đời app
  (đúng ý "tab đã ghé tiếp tục chạy nền").
- Dữ liệu vẫn tươi qua **fs-watcher app-lifetime** (`app.vue` subscribe `*.fs-changed`) + git subscribe
  ở [layouts/default.vue](../../apps/desktop/ui/layouts/default.vue), không phụ thuộc remount khi điều hướng.

**Opt-out:** các trang fullscreen/param-driven thêm `definePageMeta({ keepalive: false })` để tránh
cache instance cũ khi đổi param: `pages/edit/[taskId].vue`, `pages/projects/[id]/code.vue`,
`pages/__sidecar-debug.vue` (route meta override prop vì `meta.keepalive ?? props.keepalive`).

## Badge sống (theo dõi dễ hơn)

`HeaderTabBar` hiện chỉ báo realtime ngay trên tab:

| Tab | Badge | Nguồn |
|---|---|---|
| Tasks | pill `N` (số task đang chạy) | `useTasksStore().runningCount` (`status === 'running'`) |
| Sessions | chấm pulsing khi có session đang stream | `useSessionsStore().anyStreaming` (`pendingAgentIds` ∋ `SIDECAR_PENDING_TAG`) |
| Git | chấm dirty (conflict/warning) + chip `↑/↓` | `useGitStore().hasUncommitted / hasConflict / ahead / behind` |

## File liên quan

- `components/HeaderTabBar.vue` — shell header (logo + tab strip + cụm tiện ích + badge).
- `layouts/default.vue` — bố cục flex-col (header trên / `UpdateBanner` / content slot).
- `app.vue` — `<NuxtPage :keepalive="true" />`.
- `stores/tasks.ts` (`runningCount`), `stores/sessions.ts` (`anyStreaming`) — getter cho badge.
- Đã xóa: `components/NavRail.vue`, `components/TopBar.vue`.

## Ghi chú

- Git auto-fetch interval (`pages/git/index.vue`) set trong `onMounted` → dưới keep-alive chạy nền cả
  khi không ở tab Git. Chấp nhận được (fetch im lặng 5 phút, có mutex). Tùy chọn polish: gate bằng
  `onActivated`/`onDeactivated` để tạm dừng khi rời tab.
- 11 trang giữ sống đồng thời (không set `max`); nếu sau này nặng, dùng `:keepalive="{ max }"`.
- Không thêm dependency mới — keep-alive là tính năng sẵn có của Nuxt/Vue.
