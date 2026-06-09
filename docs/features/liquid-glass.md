# Liquid Glass — giao diện kính toàn app

## Vấn đề & quyết định

Sau khi header chuyển sang Liquid Glass ([header-tab-shell.md](header-tab-shell.md)), người dùng muốn
trải phong cách "kính mờ macOS" ra **toàn app**. Đây là thay đổi lớn nên làm theo tầng + có công tắc.

Quyết định đã chốt: intensity **Medium** (cân bằng đẹp/đọc) · **CSS-only** (không đụng Electron vibrancy)
· **công tắc Settings → Appearance, mặc định BẬT** (tắt = y hệt giao diện solid cũ → regression-safe).

## Kiến trúc — `composables/useGlass.ts`

Một composable mode-aware là **điểm đòn bẩy duy nhất**, dẫn xuất từ `useTheme().t` + cờ
`appearance.liquidGlass`. BẬT → surface kính (translucent + `backdropFilter` qua inline style + viền
hairline + inset sheen + shadow); TẮT → đúng style solid cũ. Component migrate **một lần** sang
`useGlass()`, công tắc lật toàn app từ một chỗ — không điều kiện rải rác.

Dùng giống `useTheme`: destructure để template auto-unwrap (`const { panel, overlay, pill } = useGlass()`).

| Khoá | Vai trò | Có blur? |
|---|---|---|
| `appBackground` | Nền root (ambient): `t.bg` + 2 radial-gradient ánh `accent`/`accentMuted` alpha thấp → tạo chiều sâu cho kính refract | — |
| `panel` | sidebar / list-pane / chrome lớn | blur(20) |
| `elevated` | card / node / bubble nổi | blur(18) |
| `overlay` | modal / panel nổi / floating bar | blur(28) |
| `menu` | context menu / popover | blur(24) |
| `input` | form control — **gần đặc** (chỉ viền hairline, không blur) để chữ rõ | không |
| `parts` `{ bg, blur, border, sheen, shadow }` | chrome **in-flow** có viền một phía (list-pane, header, sidebar) | **không** (xem ⚠️) |
| `pill(active, hovered)` | list row / tab / filter chip — **tint only, KHÔNG blur** | không |

Token kính nằm ở [utils/themes.ts](../../apps/desktop/ui/utils/themes.ts) (`glassBg/glassBorder/glassHighlight/glassActive/glassHover`, dark+light).
Target Chromium (Electron + dev Chrome) → `backdrop-filter` không cần prefix `-webkit-`.

## Công tắc
`AppearanceSettings.liquidGlass: boolean` ([types/index.ts]) + `DEFAULT_APPEARANCE` ([stores/settings.ts])
+ sanitize trong [useAppearance.ts](../../apps/desktop/ui/composables/useAppearance.ts) + toggle UI ở
[SettingsAppearanceSection.vue](../../apps/desktop/ui/components/settings/SettingsAppearanceSection.vue) (dùng `AppToggle`).

## Phạm vi đã áp (theo tầng)
- **Nền tảng:** ambient ở [layouts/default.vue](../../apps/desktop/ui/layouts/default.vue); HeaderTabBar route qua `useGlass`.
- **Overlay/nổi:** BaseModal (→ mọi modal), ContextMenu (→ mọi menu), PromptCreatorPanel, SessionAutocomplete, SessionChipsPopover, SkillsBulkActionBar, agents bulk bar.
- **Shell & chrome:** MasterDetailShell list-pane (→ frosted sidebar **mọi trang**; detail-pane giữ `t.bg` làm nền sau kính), SessionHeader, GitSidebar, GitPageHeader, WorkflowInspectorPane.
- **List item → glass pill:** Task/Agent/Skill/Workflow/Git list item + list inline ở pages sessions/projects/connections/hooks/commands/tasks/agents/settings (selected = glassActive, hover = glassHover).
- **Form:** AppInput/AppSelect/SearchInput → viền hairline kính.
- Boy-Scout: dot trạng thái `#22c55e` → `t.statusOk` ở ToggleCard/ToggleField.

## ⚠️ Stacking context — KHÔNG blur chrome in-flow
`backdrop-filter` tạo **stacking context + containing block mới** → "nhốt" mọi dropdown/popover
absolute **không Teleport** nằm trong phần tử đó, khiến chúng vẽ **bên dưới** panel anh em (vd: project/
branch picker trong Git header bị che bởi sidebar working-tree). Vì vậy `parts` (chrome in-flow:
header/sidebar/list-pane) **không** đặt `backdrop-filter` — chỉ tint `glassBg` + viền + sheen (trên ambient
mượt, blur gần như không thấy). Blur thật chỉ ở `overlay`/`menu` — đều Teleport ra `<body>` (BaseModal,
ContextMenu) hoặc là popover lá → không nhốt gì.

## Ràng buộc Performance (bắt buộc)
`backdrop-filter` tốn GPU + xấu khi xếp chồng. **Chỉ** đặt blur trên surface bao lớn, số lượng giới hạn
(panel/overlay/menu/header/card-đơn). **List row / pill KHÔNG blur** — chỉ tint translucent. Tránh blur
lồng blur. Vì vậy: docked panel chứa code/terminal/diff (workspace/info) và card lặp lại nhiều
(PhaseCard/KeyValueCard/message bubble) **giữ đặc** để bảo toàn legibility + perf.

## Chưa làm / để sau
- Vibrancy macOS thật (Electron `transparent` + `vibrancy`) — chồng lên CSS nếu muốn kính thật mờ desktop.
- WorkflowCanvas info overlay đã có translucency+blur riêng (chưa qua `useGlass`, không theo công tắc).
