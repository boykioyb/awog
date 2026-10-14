# UI Redesign — Dense Dark (Linear/Raycast)

Spec cho đợt redesign UI theo hướng **dense, dark, keyboard-first** (tham chiếu Linear / Raycast). Phạm vi đợt này chỉ **shell + Sessions + Tasks**; các trang khác giữ nguyên đến phase rollout sau.

## Bối cảnh

- Direction đã chốt với user: Linear/Raycast — dense, tối, keyboard-first.
- Path: visual exploration trước (2–3 mockup HTML tĩnh) → user chọn 1 → mới implement.
- AWOG hiện theo [ADR 0079](../decisions/0079-native-macos-shell-and-design-tokens.md) — native macOS + design tokens. Redesign này đi qua token, không phá hạ tầng.

## Ràng buộc kỹ thuật phải giữ

- Design tokens `--fs-*`/`--lh-*`/`--r-*`/`--icon-*` + `check-design-tokens.mjs` fail lint → direction mới phải mở rộng token, không hardcode. Cần giá trị ngoài thang → thêm token + ghi ADR.
- Selection state = accent-tint `--accentDim` + `--accentBorder` + thanh accent 2px (giữ).
- Icon-only style cho header buttons trong `*Detail.vue` (giữ).
- Hairline trên thanh cao cố định: `box-shadow: inset 0 -1px 0 var(--border)` (giữ).

## Direction đã chốt

**IDE workbench** (chọn sau vòng mockup `ui-redesign-dense-dark-mockups.html` → `ui-redesign-dense-dark-layouts.html`):

- Session = **tab ngang** dưới header mỏng 36px; list dọc hiện tại thành trang Sessions index (rail mở trang list, click → activate tab).
- Toàn bộ workspace tools (Terminal/Files/Diff/Browser/Plan) dời xuống **bottom dock** tabbed; dock đóng = strip 30px, ⌘J toggle, height persist per-session.
- Bỏ cột phải hoàn toàn; transcript căn giữa measure 780; bỏ status bar (branch/context meter vào header + composer).
- Checklist pin ở cột phải của dock (luôn thấy); Plan tab badge khi có item chờ.
- Browser tab gắn `WebContentsView` vào rect `.bview` trong dock — tái dùng `browser:attach|bounds`, chỉ đổi host rect; popout giữ nguyên.
- Deep spec + anatomy: [ui-redesign-ide-workbench.html](ui-redesign-ide-workbench.html); **full-feature port** (mọi feature SessionDetail map lên workbench + bảng feature map): [ui-redesign-ide-workbench-full.html](ui-redesign-ide-workbench-full.html) — **frame CHỐT: F5** (explorer sidebar trái 236px + document tabs kiểu VS Code: file/web/Trao đổi một strip, file tab render Monaco trên stage; Files rời dock lên sidebar, reuse pattern `/code/[id].vue`).

Rule mono được nới: metadata tabular (context usage, token, duration, ids, chip model) dùng `var(--code)` — ghi vào ADR amend.
- Mono chỉ cho content copy-paste được — direction Linear/Raycast có thể đòi nới cho metadata (ID/hash/timestamp); nếu chọn, phải ghi vào ADR amend có chủ đích.
- Browser `WebContentsView` + occlusion: đổi geometry shell/panel phải kiểm lại `OVERLAYS` selector list + `clampRect`.
- Session popout window + KeepAlive surfaces: style phải đồng bộ.
- Không thêm dependency mà không có ADR — direction này chỉ cần CSS + markup.

## Phase

|Phase|Việc|Đầu ra|
|---|---|---|
|0 — Audit|Chụp shell/Sessions/Tasks hiện tại, liệt kê drift|Baseline vấn đề theo surface|
|1 — Research|Refero-style research (Linear, Raycast, shadcn/Geist dark, wildcard)|Reference lock + decision ledger|
|2 — Mockup|2–3 option HTML tĩnh cho Session detail frame|User chọn 1 direction|
|3 — Token layer|ADR amend + token mới (surface tier, focus ring, có thể `--fs-2xs`)|`useTheme()` + CSS pass lint|
|4 — Implement|4.1 shell → 4.2 transcript → 4.3 composer+panel → 4.4 popout → 4.5 Tasks list/detail → 4.6 DAG node|Mỗi bước verify trên app thật|
|5 — QA|So render vs mockup, lint + typecheck, light/cute theme không vỡ|Cập nhật coding docs + CLAUDE.md nếu convention đổi|

## Ngoài scope

Git, Monitor, Wiki, Logtime, Settings, Connections, Agents/Skills, remote-pwa, tray popover.

## Rủi ro

- Density tăng → tap target nhỏ; giữ min-height hợp lý cho row chính.
- Token lint: giá trị ngoài thang phải thêm token trước, không lạm dụng `design-token-ok`.
- `OVERLAYS` selector list dễ sót khi shell mới thêm popover → checklist ở bước 4.3.
