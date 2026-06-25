# 0052 — NavRail dọc + flat-default surface (UI renew)

- **Trạng thái:** Accepted
- **Ngày:** 2026-06-23
- **Người quyết định:** hoatq + Claude Code (UI renew initiative)

## Bối cảnh

Dự án renew toàn bộ UI/UX AWOG theo prototype HTML đã chốt (xem [docs/features/ui-renew.md](../features/ui-renew.md)). Shell cũ dùng `HeaderTabBar` — một dải tab **ngang** trên đỉnh chứa toàn bộ 13+ mục điều hướng, utility (What's New, Settings, theme) và badge. Khi số trang tăng (Sessions/Tasks/Workflows/Agents/Skills/Commands/Rules/Templates/Projects/Git/Connections/Hooks), dải tab ngang trở nên chật, khó nhóm theo chức năng, và không còn chỗ cho title trang + global search.

Prototype đề xuất chuyển sang **NavRail dọc bên trái**, nhóm điều hướng theo Work / Library / System, thu gọn được thành icon-rail; đồng thời đổi thẩm mỹ nền từ liquid-glass (mặc định bật) sang **phẳng đặc (flat)**, giữ glass thành tùy chọn.

## Quyết định

1. **Thay `HeaderTabBar` ngang bằng `NavRail` dọc** (`components/NavRail.vue`): nhóm Home / Work / Library / System, persist trạng thái thu gọn (`localStorage awog.navrail.collapsed`), port nguyên badge (Sessions unread/awaiting/streaming, Tasks running, Git dirty + ahead/behind).
2. **Thêm `AppTopBar`** (`components/AppTopBar.vue`): title trang theo route + global search ⌘K + What's New + theme toggle + slot action theo trang.
3. **`layouts/default.vue`** chuyển sang flex-row: `NavRail | (AppTopBar + banners + main)`. `SettingsModal` (trước mount trong HeaderTabBar) nay mount ở layout.
4. **Flat-default**: `DEFAULT_APPEARANCE.liquidGlass = false`. Liquid-glass vẫn là 1 toggle trong Appearance (opt-in), không gỡ.

`HeaderTabBar.vue` giữ lại tạm thời để rollback; sẽ xoá sau khi NavRail ổn định qua vài bản.

## Phương án đã cân nhắc

- **Giữ HeaderTabBar ngang, chỉ restyle** — ít rủi ro nhưng không giải quyết được vấn đề chật chỗ + không khớp prototype. Từ chối.
- **Giữ liquid-glass mặc định** — đẹp nhưng tương phản kém trên nhiều nền, và prototype/định hướng "flat default, glass opt-in" đã chốt từ trước (xem memory shadcn redesign). Từ chối làm mặc định, giữ làm tùy chọn.

## Hệ quả

- **Tích cực:** điều hướng nhóm rõ ràng, scale tốt khi thêm trang; có chỗ cho title + global search; thu gọn icon-rail tiết kiệm không gian; flat dễ đọc, glass vẫn dùng được.
- **Tiêu cực / Trade-off:** flat-default chỉ áp cho fresh install — user đã lưu `appearance` vẫn giữ `liquidGlass: true` (chưa có migration 1 lần để flip). Badge/keep-alive phải port thủ công sang NavRail (đã làm).
- **Việc cần làm tiếp:**
  - Xoá `HeaderTabBar.vue` sau khi NavRail ổn định.
  - (Tùy chọn) migration 1 lần flip user cũ sang flat.
  - Nâng `AppSelect` từ native `<select>` sang custom dropdown (task riêng, ~80 call site).

## Tham chiếu

- [docs/features/ui-renew.md](../features/ui-renew.md) — đặc tả UI renew + tiến độ phase
- Prototype: `awog-prototype.html` (scratchpad)
- Liên quan: ADR 0044 (shadcn-vue token bridge), `composables/useGlass.ts`, `composables/useTheme.ts`
