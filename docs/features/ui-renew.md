# UI Renew — Tái thiết kế giao diện toàn app

> Renew toàn bộ giao diện AWOG (`apps/desktop/ui`, Nuxt 4 + Vue 3 + Pinia + Tailwind + lucide, theme qua `useTheme()`). **Bản chất: restyle, KHÔNG rebuild** — app đã gần feature-complete + có hệ token mạnh (`useTheme()` + `useGlass()` + bridge shadcn-vue [ADR 0044]). Giữ nguyên toàn bộ wiring store/IPC/event; chỉ đổi template + style token. Tài liệu này vừa là đặc tả vừa là nhật ký công việc.

## 1. Mục tiêu

Hai phần:
- **Prototype tương tác** (`awog-prototype.html`) — HTML/CSS/JS thuần, mock data, token màu thật, dark/light, phủ mọi trang. Là **spec UI sống** chốt look & feel trước khi code.
- **Apply vào codebase thật** — restyle các component Vue cho khớp prototype.

## 2. Quyết định nền (xem [ADR 0052](../decisions/0052-navrail-shell-flat-default.md))

1. **NavRail dọc** (`components/NavRail.vue`) thay `HeaderTabBar` ngang — nhóm Home / Work / Library / System, thu gọn icon-rail (persist), port nguyên badge.
2. **`AppTopBar`** (`components/AppTopBar.vue`) — title theo route + global search ⌘K + What's New + theme toggle + slot action.
3. **Flat-default, glass opt-in** — `DEFAULT_APPEARANCE.liquidGlass=false`.
4. **Home bento** (`pages/index.vue`) thay redirect `/`→`/sessions`.

Cách triển khai: **~15 subagent `developer` chạy SONG SONG**, partition theo **file rời nhau** (không xung đột). Mỗi wave: **gộp i18n key** + chạy **full `pnpm typecheck` + `pnpm lint`** để bắt lỗi type agent bỏ sót (agent chỉ self-lint từng file).

## 3. Nguyên tắc restyle (áp cho mọi trang)

- Màu **luôn** qua `useTheme()` token (`t.*`), **không hardcode hex**. Layout/spacing qua Tailwind.
- Surface flat: `bgPanel`/`bgElevated` + `1px solid t.border`. Radius: container `rounded-xl`, row/button `rounded-lg`, pill/badge `rounded-full` (riêng **chip control** = `rounded-lg`, xem §5).
- Action button icon-only `p-1.5 rounded transition` icon 13 (theo `.claude/rules/nuxt-vue.md`). Body `text-[1em]`; badge/count `text-[12px]`.
- Form control dùng `AppInput`/`AppSelect`/`Field`/`AppToggle` — không native `<select>`.
- String hiển thị qua i18n (`tr()`, key flat dotted ở `i18n/{en,vi}.json`).

## 4. Tiến độ theo phase (mọi phase verify `pnpm typecheck` + `pnpm lint` EXIT 0 + dev boot HTTP 200)

| Phase | Phạm vi | Trạng thái |
|---|---|---|
| **0 — Foundation** | `NavRail.vue` + `AppTopBar.vue` mới · `layouts/default.vue` flex-row (NavRail \| TopBar+main) · mount `<SettingsModal/>` ở layout · `pages/index.vue` = bento (`components/home/*` + `composables/useHomeDashboard.ts`) · flat-default · badge port nguyên (Sessions unread/awaiting/streaming, Tasks running, Git dirty + ↑↓) · i18n `nav.*/topbar.*/home.*` | ✅ |
| **1 — Sessions** | list (filter/group/row/bulk) · composer · transcript (bubble + action icon-only + step-cluster) · workspace panel (tab strip + file tree + todo/queue) — `components/session/**` | ✅ |
| **2A — Git/Settings/Projects** | Git: All Commits row 1-dòng + ref pill + commit-detail tabs + **FILE TREE cây** · Settings: 2-pane nav pill + section flat card + **glass toggle** · Projects: metrics strip + Cấu hình card + Issues/PR state-dot | ✅ |
| **2B — Library + Agents/Skills** | Connections/Commands: row card + transport/scope badge · Hooks/Rules: event-filter pill + anchor/trust badge (hex→token) · Agents/Skills: floating card row + provider/model chip + outline tier badge | ✅ |
| **2C — Tasks/Workflows** | Tasks: row status-dot + filter · Workflows: canvas node `rounded-xl` + inspector form + edge dùng canvas token (giữ VueFlow) | ✅ |
| **Phase/Pipeline** | `components/phase/*` (PhaseCard node + TraceNodeItem/StepItem 1-dòng + Approve/Rerun/Discuss + RoleBadge) — dùng chung Tasks + Sessions | ✅ |

## 5. Sessions — fidelity pass (sửa theo screenshot user để khớp prototype 100%)

Sau apply, đối chiếu screenshot ↔ prototype và chỉnh:
- **Cỡ chữ base 12 → 13px** (`DEFAULT_APPEARANCE.fontSize`) — gần prototype (13.5px), dễ đọc hơn.
- **Chip recipe** = `.chip.sm` của prototype: `rounded-lg` (radius 7) + **font mono** + `text-[12px]` + **outline** (nền trong suốt + viền `t.border`); mode Plan=viền amber / Execute=viền accent (KHÔNG nền đặc); mở popover = highlight neutral. Áp `SessionChipsPopover` + `SessionStylePicker` + `SessionContextStatus`.
- **Composer = ĐÚNG 3 chip** `mode → model → account` + spacer + `enhance/attach/Gửi`. Textarea sạch, resize handle trên đỉnh, follow-up/queue phía trên.
- **Usage + style + MCP chuyển lên HEADER** (như prototype: usage `used/limit`, vd `239/200k`). Popover ở header mở **xuống dưới** (prop `placement: 'up'|'down'`); composer vẫn mở lên.
- Lệnh `/style` rewire qua `utils/style-picker-bus.ts` (picker rời sang header nên không ref trực tiếp).

> Sessions vẫn đang iterate theo screenshot user tới khi khớp 100% (chip mono vs sans, transcript/step, màu base dark/light).

## 6. Files chính

- **Shell:** `layouts/default.vue`, **mới** `components/NavRail.vue` + `components/AppTopBar.vue` (giữ `components/HeaderTabBar.vue` để rollback, gỡ sau).
- **Foundation:** `stores/settings.ts` (`liquidGlass=false`, `fontSize=13`), **mới** `pages/index.vue` (bento) + `components/home/*` + `composables/useHomeDashboard.ts`.
- **Sessions:** `components/session/**` + `utils/style-picker-bus.ts`.
- **Các vùng còn lại:** `components/{git,settings,project,mcp,command,hook,rule,agent,skill,phase}/*`, `pages/{projects,connections,commands,hooks,rules,agents,skills,tasks,workflows}`.
- **i18n:** `i18n/en.json`, `i18n/vi.json` (~1020 key, en/vi khớp).
- **Reference:** `awog-prototype.html` (artifact) — spec UI sống cho từng trang.

## 7. Nợ kỹ thuật / việc tiếp

- **AppSelect vẫn native `<select>`** — nâng thành custom slot-based dropdown đụng ~80 call site → task riêng (mâu thuẫn convention "không native select").
- **Flat-default + font 13px** chỉ áp **fresh install**; user đã lưu appearance vẫn giữ giá trị cũ (cần migration 1 lần nếu muốn flip hết).
- **Xoá `HeaderTabBar.vue`** sau khi NavRail xác nhận ổn.
- Vài chuỗi hardcode tiếng Anh còn sót (HookPromptCreator, vài tooltip Git); multi-repo badge Issues/PR cần thêm field data (`GhThreadSummary.repo`).
- Home "Activity 24h" rỗng tới khi mở /git (git.commits chưa load lúc mount) — cân nhắc load history nền.

## 8. Lệnh kiểm tra

```bash
cd apps/desktop/ui
pnpm dev          # http://localhost:3030 — đối chiếu trực quan với prototype
pnpm typecheck    # vue-tsc strict — phải EXIT 0
pnpm lint         # ESLint — phải EXIT 0
```

## 9. Tham chiếu

- [ADR 0052](../decisions/0052-navrail-shell-flat-default.md) — NavRail shell + flat-default
- [ADR 0044] token bridge shadcn-vue
- `composables/useTheme.ts`, `composables/useGlass.ts`, `utils/themes.ts`
- Prototype: `awog-prototype.html`
