# Task plan — UI consolidation refactor (ADR 0009)

> ADR nguồn: [../decisions/0009-ui-consolidation-refactor.md](../decisions/0009-ui-consolidation-refactor.md)
> ADR clarifications: [../decisions/0009a-ui-consolidation-clarifications.md](../decisions/0009a-ui-consolidation-clarifications.md)
> Convention bị vi phạm: [../coding/nuxt-frontend.md](../coding/nuxt-frontend.md)
> Nguyên tắc: [.claude/rules/principles.md](../../.claude/rules/principles.md) — Rule of Three, SRP, KISS.

## Tổng quan

- **Tổng task:** 82 (PR-1: 13, PR-2: 16, PR-3: 17, PR-4: 9, PR-5: 27).
- **Ước lượng:** ~5 ngày dev + ~2 ngày QA/review song song = ~7.5 ngày người (lịch ~2 tuần).
- **5 PR, thứ tự dependency tăng dần.** Không bắt đầu PR-N+1 trước khi PR-N merge để tránh conflict.
- **Constraint chung mọi PR:**
  - `pnpm lint` 0 error, `pnpm typecheck` pass, `pnpm format:check` pass.
  - Mỗi component/page sau refactor ≤ 250 dòng (đếm thực thi `wc -l` sau lint:fix).
  - Pixel-equivalent UI (không đổi visual trừ bug fix lộ ra).
  - Không thêm dependency mới.
  - Không hardcode hex/rgba — đi qua `useTheme()`.
- **Freeze nhánh feature Git Manager trong giai đoạn PR-2 & PR-5** (vì migrate `MasterDetailShell` và split `GitBranchList.vue` đụng vùng đang dev).

---

## PR-1 — Foundation primitives

> Mục tiêu: extract primitives dùng chung, chưa migrate caller. PR này phải merge sạch trước khi PR-2..5 bắt đầu.

### Tasks

- [ ] **T1.1 — Bổ sung theme token mới vào `utils/themes.ts`** (effort: 1h, owner: developer)
  - File: `apps/desktop/ui/utils/themes.ts`, `apps/desktop/ui/types/index.ts` (mở rộng `ThemeTokens`).
  - Thêm token: `overlay`, `onAccent`, `diffAdd`, `diffDel`, `statusOk`, `statusWarn`. Mỗi token có giá trị cho cả 2 theme `dark` + `light`.
  - Acceptance: `pnpm typecheck` pass; `useTheme().t.overlay` chạy được trong template; cả 2 theme có đủ 6 token mới.
  - Depends on: none.

- [ ] **T1.2 — Viết composable `useEscape.ts`** (effort: 30m, owner: developer)
  - File: `apps/desktop/ui/composables/useEscape.ts`.
  - Signature: `useEscape(handler: () => void, options?: { enabled?: Ref<boolean> })`. Đăng ký `keydown` ở `onMounted`, gỡ ở `onBeforeUnmount`. Stop propagation tùy chọn.
  - **Stack toàn cục:** `useEscape` push handler vào **module-level stack array**; `keydown` listener chỉ gọi handler ở **top of stack** (last-in-first-out). Khi component unmount, splice handler khỏi stack để không leak. Cơ chế này bảo đảm modal stacking: ESC chỉ đóng modal/editor trên cùng.
  - Acceptance: Có JSDoc + ví dụ; ấn ESC trong demo gọi `handler` đúng 1 lần; không leak listener (assert qua manual test mount/unmount 5 lần — `escapeStack.length` về 0); mở 2 handler chồng → ESC chỉ trigger handler push sau.
  - Depends on: none.

- [ ] **T1.3 — Viết composable `useClickOutside.ts`** (effort: 45m, owner: developer)
  - File: `apps/desktop/ui/composables/useClickOutside.ts`.
  - Signature: `useClickOutside(targetRef: Ref<HTMLElement | null>, handler: (e: MouseEvent) => void)`. Lắng `mousedown` ở document, kiểm tra `target.contains`.
  - Acceptance: Click ngoài element → handler gọi; click trong → không gọi; unmount → gỡ listener.
  - Depends on: none.

- [ ] **T1.4 — Tạo component `BaseModal.vue`** (effort: 1.5h, owner: developer)
  - File: `apps/desktop/ui/components/BaseModal.vue`.
  - Props (type-only): `open: boolean`, `title?: string`, `size?: 'sm' | 'md' | 'lg' | 'xl'` (default `'md'`), `closeOnBackdrop?: boolean` (default `true`), `closeOnEscape?: boolean` (default `true`).
  - Emits: `close: []`.
  - Slots: `header` (override title), `default` (body), `footer`.
  - Behavior: overlay dùng `t.overlay`, card dùng `t.bgPanel` + `t.border`, X button góc phải, body scroll lock khi `open`, ESC qua `useEscape` (T1.2), backdrop click qua `useClickOutside` (T1.3).
  - Acceptance: Render < 120 dòng; 4 prop hoạt động đúng; demo mở/đóng pass; tab focus trap không bắt buộc (defer).
  - Depends on: T1.1, T1.2, T1.3.

- [ ] **T1.5 — Tạo component `SearchInput.vue`** (effort: 45m, owner: developer)
  - File: `apps/desktop/ui/components/SearchInput.vue`.
  - Props: `modelValue: string`, `placeholder?: string` (default `'Search...'`), `autofocus?: boolean`.
  - Emits: `update:modelValue: [value: string]`.
  - Icon `Search` từ `lucide-vue-next` bên trái, input theme style.
  - Acceptance: `v-model` 2-way bind chạy; style theme đầy đủ (`t.bgInput`, `t.text`, `t.border`); placeholder hiển thị; ≤ 50 dòng.
  - Depends on: T1.1.

- [ ] **T1.6 — Tạo component `AppInput.vue`** (effort: 45m, owner: developer)
  - File: `apps/desktop/ui/components/AppInput.vue`.
  - Props: `modelValue: string`, `type?: 'text' | 'email' | 'password' | 'number'` (default `'text'`), `placeholder?: string`, `disabled?: boolean`, `invalid?: boolean`.
  - Emits: `update:modelValue: [value: string]`, `blur: []`, `focus: []`.
  - Style từ theme; `invalid` → border `t.danger`.
  - Acceptance: Thay thế được `inputStyle = computed(...)` pattern; tất cả type input hoạt động; ≤ 60 dòng.
  - Depends on: T1.1.

- [ ] **T1.7 — Unit smoke test cho 3 component mới** (effort: 1h, owner: qa-tester)
  - File: tạo `apps/desktop/ui/components/__demo__/BaseModalDemo.vue`, `SearchInputDemo.vue`, `AppInputDemo.vue` (hoặc trang `/dev/primitives` ẩn behind flag).
  - Acceptance: mỗi component render được 3 state (default / disabled / invalid hoặc tương đương); QA tick checklist visual; demo file có comment "remove sau khi PR-3 migrate xong".
  - Depends on: T1.4, T1.5, T1.6.

- [ ] **T1.8 — Cập nhật `docs/coding/nuxt-frontend.md` mục "Component/composable dùng chung"** (effort: 45m, owner: developer)
  - File: `docs/coding/nuxt-frontend.md` — thêm section mới sau "Composable", bảng liệt kê 5 primitive + 3 composable + khi nào dùng + khi nào KHÔNG dùng.
  - Acceptance: Có cross-link tới ADR 0009; bảng đầy đủ 8 entry; review viên chấp nhận.
  - Depends on: T1.2, T1.3, T1.4, T1.5, T1.6.

- [ ] **T1.9 — Cập nhật `apps/desktop/ui/README.md` danh sách primitive** (effort: 20m, owner: developer)
  - File: `apps/desktop/ui/README.md` — mục "Cấu trúc" bổ sung 5 component + 2 composable mới.
  - Acceptance: file diff đúng; không sửa nội dung khác.
  - Depends on: T1.8.

- [ ] **T1.10 — Lint + typecheck + format cho PR-1** (effort: 15m, owner: developer)
  - Acceptance: `pnpm lint`, `pnpm typecheck`, `pnpm format:check` đều pass.
  - Depends on: T1.1–T1.9.

### QA checklist PR-1

- [ ] Mở demo BaseModal: backdrop click đóng, ESC đóng, X button đóng, click trong body KHÔNG đóng.
- [ ] BaseModal với `closeOnEscape: false` — ESC không đóng.
- [ ] BaseModal `size: 'lg'` — width đúng theo theme.
- [ ] SearchInput gõ ký tự → `v-model` parent update; `placeholder` đổi runtime hoạt động.
- [ ] AppInput `type='password'` mask ký tự; `disabled` → không gõ được; `invalid` → border đỏ theme.
- [ ] Toggle theme dark ↔ light: 3 component không vỡ màu, overlay BaseModal đổi giá trị tương ứng.
- [ ] Mount/unmount component 5 lần: không leak listener (DevTools event listeners).
- [ ] `useEscape` + `useClickOutside` không trigger lúc component chưa mount.

### Reviewer focus

1. Type-only props/emits với `defineProps<Props>()` đúng convention.
2. `BaseModal` không vượt 120 dòng; ESC handler không double-bind nếu mở nhiều modal cùng lúc. **Verify stack cleanup khi unmount** (mount/unmount 5 lần không leak handler trong `escapeStack` — assert `escapeStack.length === 0` sau khi unmount hết).
3. Theme token mới (`overlay`, `onAccent`, ...) phải có đủ cả `dark` + `light`, không hex hardcode.
4. `useClickOutside` dùng `mousedown` chứ không `click` (tránh race với button click).
5. JSDoc/comment ngắn cho 3 composable mới.

---

## PR-2 — `MasterDetailShell` + migrate 11 page

> Mục tiêu: gom layout list trái + detail phải + `mobilePane` về 1 component, migrate 11 page.

### Tasks

- [ ] **T2.1 — Thiết kế interface `MasterDetailShell.vue` (no impl)** (effort: 45m, owner: tech-lead)
  - Deliverable: comment block trên cùng file mô tả slots/props sau khi survey 11 page sử dụng.
  - 11 page candidate: `tasks/index.vue`, `projects/index.vue`, `agents/index.vue`, `skills/index.vue`, `git/index.vue` (5 tab), `workflows/index.vue` (1 phần list), `settings/index.vue` (nav-section + detail).
  - Slots dự kiến: `list` (left pane), `detail` (right pane), `toolbar` (top of list), `empty-detail` (khi không chọn).
  - Props: `selectedId: string | null`, `mobilePane?: 'list' | 'detail'`, `listWidth?: string` (CSS).
  - Acceptance: Tech-lead duyệt interface, đảm bảo cover 11 case không cần slot ngoài lề.
  - Depends on: PR-1 merged.

- [ ] **T2.2 — Implement `MasterDetailShell.vue`** (effort: 1.5h, owner: developer)
  - File: `apps/desktop/ui/components/MasterDetailShell.vue`.
  - Acceptance: ≤ 150 dòng; responsive `md:flex-row` / mobile single-pane theo `mobilePane`; theme đầy đủ.
  - Depends on: T2.1.

- [ ] **T2.3 — Migrate `pages/tasks/index.vue`** (effort: 1h, owner: developer)
  - Acceptance: file giảm ≥ 50 dòng; UI pixel-equivalent (so sánh side-by-side); ≤ 250 dòng.
  - Depends on: T2.2.

- [ ] **T2.4 — Migrate `pages/projects/index.vue`** (effort: 1h, owner: developer)
  - Acceptance: như T2.3.
  - Depends on: T2.2.

- [ ] **T2.5 — Migrate `pages/agents/index.vue`** (effort: 1h, owner: developer)
  - Acceptance: như T2.3.
  - Depends on: T2.2.

- [ ] **T2.6 — Migrate `pages/skills/index.vue`** (effort: 1h, owner: developer)
  - Acceptance: như T2.3.
  - Depends on: T2.2.

- [ ] **T2.7 — Migrate `pages/git/index.vue` (5 tab inside)** (effort: 1.5h, owner: developer)
  - Acceptance: 5 tab Changes/History/Branches/Stash/Remotes vẫn switch đúng; mỗi tab dùng `MasterDetailShell` nếu áp dụng được, nếu không thì giữ nguyên + ghi note vào file.
  - Depends on: T2.2.
  - Risk: file đang được dev branch `feature/git-manager` chỉnh — phải sync trước migrate.

- [ ] **T2.8 — Migrate phần list của `pages/workflows/index.vue`** (effort: 45m, owner: developer)
  - Acceptance: Chỉ migrate khung list-detail; phần palette + VueFlow canvas giữ nguyên (sẽ split ở PR-5).
  - Depends on: T2.2.

- [ ] **T2.9 — Migrate `pages/settings/index.vue` (chỉ phần shell, không split section)** (effort: 1h, owner: developer)
  - Acceptance: nav-section bên trái + content bên phải qua `MasterDetailShell`; nội dung 5 section vẫn inline (split để PR-5).
  - Depends on: T2.2.

- [ ] **T2.10 — Skip `pages/edit/[taskId].vue` khỏi PR-2** (effort: 10m, owner: developer)
  - **Skip** migrate `pages/edit/[taskId].vue` sang `MasterDetailShell` (TL quyết định ở ADR 0009a §4). File có top toolbar đặc thù + 3-mode editor + tree không phải list rows. Sẽ tách subcomponent ở PR-5 §5.G mới.
  - Acceptance: Ghi comment ngắn trên đầu file `pages/edit/[taskId].vue` reference ADR 0009a §4; không sửa structure ở PR-2.
  - Depends on: T2.2.

- [ ] **T2.11 — Xóa code chết sau migrate (mobile pane logic cũ, computed trùng)** (effort: 45m, owner: developer)
  - Acceptance: `pnpm lint` không cảnh báo unused; grep `mobilePane` không còn ngoài `MasterDetailShell`.
  - Depends on: T2.3–T2.10.

- [ ] **T2.12 — Lint + typecheck + format PR-2** (effort: 15m, owner: developer)
  - Depends on: T2.11.

- [ ] **T2.13 — Đo dòng từng page sau migrate** (effort: 20m, owner: developer)
  - Acceptance: Bảng line count trước/sau in vào PR description; tất cả ≤ 250 (ngoại trừ `workflows/index.vue` và `settings/index.vue` sẽ split ở PR-5).
  - Depends on: T2.11.

### QA checklist PR-2

- [ ] `/tasks` — chọn task: detail hiển thị; chọn task khác: detail đổi; mobile width: chuyển sang pane detail khi chọn, back về list khi tap back.
- [ ] `/projects` — list scroll mượt; selected row highlight; CRUD project vẫn chạy.
- [ ] `/agents` — list + detail editor; tạo agent mới qua modal vẫn chạy.
- [ ] `/skills` — filter category, search vẫn chạy; "Used by" agents còn đúng.
- [ ] `/git` — 5 tab switch không lỗi; Changes diff hiển thị; Branches tree expand/collapse.
- [ ] `/workflows` — list workflow + detail canvas vẫn render; VueFlow drag drop chưa đụng (sẽ test ở PR-5).
- [ ] `/settings` — nav-section click chuyển content; 4 section vẫn render đủ field.
- [ ] Toggle theme: 11 page không vỡ layout.
- [ ] Resize browser từ 1280 → 768: list-detail collapse đúng mobile mode; back button hoạt động.
- [ ] So sánh screenshot trước/sau từng page (side-by-side) — pixel-equivalent ngoại trừ micro spacing khác biệt < 4px.

### Reviewer focus

1. Slot API `MasterDetailShell` đủ generic — không page nào phải dùng `:deep` hoặc workaround.
2. `mobilePane` state quản lý ở đâu — store hay local? (kỳ vọng: local ref trong shell, parent điều khiển qua prop nếu cần).
3. 11 page diff giảm dòng có thực hay chỉ chuyển vị trí code (kiểm tra `git diff --stat`).
4. Không có theme hex hardcode mới phát sinh.
5. Tasks selection state (Pinia `selectedTaskId`) không bị break khi route navigate.

---

## PR-3 — `EditorShell` + migrate 6 Editor + 8 modal sang `BaseModal`

> Mục tiêu: thay chrome boilerplate ở 6 Editor full-page + chuyển 8 modal sang `BaseModal`.

### Tasks

- [ ] **T3.1 — Thiết kế interface `EditorShell.vue`** (effort: 30m, owner: tech-lead)
  - Survey đích danh 6 Editor (line baseline ghi rõ trong ADR 0009a §1):
    - `AgentEditor.vue` (355 dòng)
    - `SkillEditor.vue` (283 dòng)
    - `CommandEditor.vue` (298 dòng)
    - `McpEditor.vue` (264 dòng)
    - `ProjectEditor.vue` (229 dòng)
    - `HookEditor.vue` (224 dòng)
  - Slots: `header-actions` (Save/Cancel), `default` (form body), `footer` (validation status).
  - Props: `title: string`, `dirty: boolean`, `saving?: boolean`, `canSave?: boolean`.
  - Emits: `save: []`, `cancel: []`, **`request-close: []`** (không phải `close` trực tiếp).
  - **Dirty + ESC contract:** khi `dirty=true` + user nhấn ESC → emit `request-close` → parent show confirm `BaseModal` "Discard changes?"; khi `dirty=false` + ESC → emit `request-close` → parent đóng thẳng (không confirm). Document trong comment block của file.
  - Acceptance: Interface duyệt; cover 6 case không cần prop flag conditional theo entity type.
  - Depends on: PR-2 merged.

- [ ] **T3.2 — Implement `EditorShell.vue`** (effort: 1h, owner: developer)
  - File: `apps/desktop/ui/components/EditorShell.vue`.
  - Emit `request-close` (không emit `close` trực tiếp). Parent Editor xử lý: nếu `dirty=true` → mở confirm `BaseModal` "Discard changes?" (2 button Discard / Keep editing); nếu `dirty=false` → đóng thẳng.
  - Acceptance: ≤ 120 dòng; "dirty" indicator hiển thị; Save disabled khi `!canSave`; theme đầy đủ; emit `request-close` test pass.
  - Depends on: T3.1.

- [ ] **T3.3 — Migrate `AgentEditor.vue` sang `EditorShell`** (effort: 1h, owner: developer)
  - Acceptance: file giảm ≥ 30 dòng (từ 355); CRUD agent flow vẫn chạy; dirty + ESC behavior đúng.
  - Depends on: T3.2.

- [ ] **T3.4 — Migrate `SkillEditor.vue` sang `EditorShell`** (effort: 1h, owner: developer)
  - Acceptance: file giảm ≥ 30 dòng (từ 283); như T3.3.
  - Depends on: T3.2.

- [ ] **T3.5 — Migrate `ProjectEditor.vue` sang `EditorShell`** (effort: 1h, owner: developer)
  - Acceptance: file giảm ≥ 30 dòng (từ 229); như T3.3.
  - Depends on: T3.2.

- [ ] **T3.6 — Migrate 3 Editor còn lại (Command/Hook/Mcp)** (effort: 1.5h, owner: developer)
  - Đích danh 3 file (line baseline xác nhận trong ADR 0009a §1):
    - `CommandEditor.vue` (298 dòng) → mục tiêu ≤ 250 dòng.
    - `HookEditor.vue` (224 dòng) → mục tiêu giảm ≥ 30 dòng.
    - `McpEditor.vue` (264 dòng) → mục tiêu ≤ 250 dòng.
  - Acceptance: 3 file migrate xong, mỗi file giảm ≥ 30 dòng; UI behavior identical; dirty + ESC behavior đúng.
  - Depends on: T3.2.

- [ ] **T3.7 — Migrate `ConfirmDeleteModal.vue` sang `BaseModal`** (effort: 30m, owner: developer)
  - Acceptance: chrome (overlay/X/ESC) đến từ `BaseModal`; nội dung body + footer còn lại ≤ 60 dòng; hardcode overlay/onAccent xóa hết.
  - Depends on: PR-1 merged.

- [ ] **T3.8 — Migrate `NewTaskModal.vue` sang `BaseModal`** (effort: 45m, owner: developer)
  - Acceptance: form fields vẫn validate; submit vẫn dispatch action store; chrome dùng `BaseModal`.
  - Depends on: PR-1 merged.

- [ ] **T3.9 — Migrate `RerunModal.vue` sang `BaseModal`** (effort: 30m, owner: developer)
  - Acceptance: như T3.8.
  - Depends on: PR-1 merged.

- [ ] **T3.10 — Migrate `AttachmentLightbox.vue` sang `BaseModal` + xóa hex hardcode** (effort: 45m, owner: developer)
  - Acceptance: 6 chỗ hardcode `rgba(0,0,0,0.85)` + `#fff` thay bằng `t.overlay` + `t.onAccent`; UI lightbox vẫn full-screen image.
  - Depends on: PR-1 merged.

- [ ] **T3.11 — Migrate 3 modal inline trong `GitBranchList.vue` sang `BaseModal`** (effort: 1h, owner: developer)
  - Acceptance: 3 modal (rename/delete/checkout) giờ dùng `BaseModal`; logic validate giữ nguyên; chuẩn bị đất cho PR-5 split.
  - Depends on: PR-1 merged.
  - Risk: file đang prototype dev — sync trước.

- [ ] **T3.12 — Migrate `GitStashList.vue:82` modal sang `BaseModal`** (effort: 30m, owner: developer)
  - Đã identify modal thứ 8 = inline modal trong `components/git/GitStashList.vue` line 82 (xác nhận ADR 0009a §2). Tổng 8 modal: ConfirmDelete + NewTask + Rerun + AttachmentLightbox + 3 trong GitBranchList + 1 trong GitStashList.
  - Acceptance: modal stash dùng `BaseModal` chrome; logic stash action giữ nguyên.
  - Depends on: PR-1 merged.

- [ ] **T3.13 — Sweep grep `(fixed|absolute) inset-0.*backdrop-blur` để bắt modal sót** (effort: 30m, owner: developer)
  - Pattern phải bắt cả 2 variant: `fixed inset-0` lẫn `absolute inset-0` + có `backdrop-blur` (tránh false-positive overlay drawer/popup không phải modal).
  - Acceptance: grep ra 0 instance modal ngoài `BaseModal.vue` (loại trừ legit overlay: NavRail, ContextMenu, PromptCreatorPanel drawer, SessionChat drawer); nếu phát hiện → tạo task migrate tiếp.
  - Depends on: T3.7–T3.12.

- [ ] **T3.14 — Sweep grep hardcode `#fff`, `rgba(0,0,0` ngoài `themes.ts`** (effort: 30m, owner: developer)
  - Acceptance: 0 instance ở `.vue` files.
  - Depends on: T3.10.

- [ ] **T3.15 — Xóa demo files từ T1.7** (effort: 10m, owner: developer)
  - Acceptance: `apps/desktop/ui/components/__demo__/` xoá; route `/dev/primitives` (nếu có) xoá.
  - Depends on: T3.13.

- [ ] **T3.16 — Lint + typecheck + format PR-3** (effort: 15m, owner: developer)
  - Depends on: T3.15.

- [ ] **T3.17 — Đo dòng từng file sau migrate** (effort: 20m, owner: developer)
  - Acceptance: bảng line-count trong PR description; toàn bộ Editor/modal ≤ 250 dòng.
  - Depends on: T3.15.

### QA checklist PR-3

- [ ] Tạo agent mới: Save flow đúng, dirty indicator bật khi sửa field.
- [ ] **Editor clean (no dirty) + ESC → đóng thẳng.**
- [ ] **Editor dirty + ESC → hiện confirm 'Discard changes?'; chọn Discard → đóng + lost change; chọn Keep editing → giữ editor mở.**
- [ ] Sửa skill: dirty → Save, Cancel hỏi confirm; Save disabled khi `canSave=false` (validate fail).
- [ ] ConfirmDelete: ESC đóng; backdrop đóng; Delete button gọi action; danger color trên text "Delete".
- [ ] NewTask: form submit tạo task xuất hiện trong list `/tasks`.
- [ ] Rerun: chọn phase, confirm rerun, badge update.
- [ ] AttachmentLightbox: mở từ phase output, ESC đóng, dark overlay full screen.
- [ ] GitBranchList 3 modal: rename branch chuẩn validate ký tự, delete branch confirm, checkout branch warning nếu dirty.
- [ ] GitStashList modal stash action: mở qua context menu, ESC đóng, action dispatch đúng.
- [ ] Toggle theme: tất cả 8 modal + 6 Editor giữ màu đúng.
- [ ] Mở chồng modal (ConfirmDelete trong khi đang ở AgentEditor): ESC chỉ đóng modal trên cùng.
- [ ] **Stack 3 cấp (Editor mở → modal `ConfirmDelete` mở → tooltip popover mở): ESC đóng từng cấp từ trên xuống, không skip cấp.**
- [ ] Body scroll lock: khi modal mở, scroll wheel không scroll body bên dưới.

### Reviewer focus

1. `EditorShell` slot API có cần `defineExpose` để parent gọi save không? (kỳ vọng: không, qua emit).
2. ESC handler stacking — khi 2 modal mở chồng, chỉ modal trên cùng đóng (`useEscape` cần stack hoặc check `event.defaultPrevented`).
3. Hex/rgba hardcode đã sạch (grep trong PR description).
4. Body scroll lock được restore khi unmount (không kẹt `overflow: hidden` sau khi đóng).
5. `EditorShell` không lệch convention với `BaseModal` (cả 2 cùng pattern slot header/default/footer).
6. `EditorShell` emit `request-close` (không `close` trực tiếp); parent kiểm `dirty` rồi quyết định show confirm hay đóng thẳng.

---

## PR-4 — `useMockGenerator<T>` + `PromptCreatorPanel` generic

> Mục tiêu: gộp 6 mock generator + 6 PromptCreator wrapper về 1 generic.

### Tasks

- [ ] **T4.1 — Survey 6 file mock generator hiện tại** (effort: 30m, owner: developer)
  - Đích danh 6 file (line baseline xác nhận trong ADR 0009a §3; **không có Project generator**):
    - `useAgentGenerator.ts` (109 dòng)
    - `useSkillGenerator.ts` (123 dòng)
    - `useCommandGenerator.ts` (147 dòng)
    - `useHookGenerator.ts` (128 dòng)
    - `useMcpGenerator.ts` (147 dòng)
    - `useWorkflowGenerator.ts` (82 dòng)
  - Tổng baseline: 736 dòng.
  - Acceptance: bảng signature + delta khác biệt giữa 6 generator ghi vào PR description; xác nhận khả thi gộp (nếu khác biệt > 30% logic, escalate redesign — risk R6).
  - Depends on: PR-3 merged.

- [ ] **T4.2 — Thiết kế `useMockGenerator<T>` signature** (effort: 30m, owner: tech-lead)
  - Generic: `useMockGenerator<T>(config: { generate: (input: string) => Promise<T>; initialValue?: T })` → trả `{ value, loading, error, generate }`.
  - Acceptance: TL duyệt; cover 6 case mà không cần option flag conditional.
  - Depends on: T4.1.

- [ ] **T4.3 — Implement `composables/useMockGenerator.ts`** (effort: 1h, owner: developer)
  - File: `apps/desktop/ui/composables/useMockGenerator.ts`.
  - Acceptance: ≤ 60 dòng; type-safe với generic; có JSDoc.
  - Depends on: T4.2.

- [ ] **T4.4 — Migrate 6 mock generator caller** (effort: 2h, owner: developer)
  - Đích danh 6 file (same list T4.1, với line baseline):
    - `useAgentGenerator.ts` (109 → ≤ 30 dòng)
    - `useSkillGenerator.ts` (123 → ≤ 30 dòng)
    - `useCommandGenerator.ts` (147 → ≤ 30 dòng)
    - `useHookGenerator.ts` (128 → ≤ 30 dòng)
    - `useMcpGenerator.ts` (147 → ≤ 30 dòng)
    - `useWorkflowGenerator.ts` (82 → ≤ 30 dòng)
  - Mỗi file thay thế bằng `useMockGenerator<T>(...)`; giảm ≥ 40 dòng/file.
  - Acceptance: 6 file ≤ 30 dòng mỗi sau migrate; UI behavior identical.
  - Depends on: T4.3.

- [ ] **T4.5 — Thiết kế `PromptCreatorPanel.vue` generic** (effort: 30m, owner: tech-lead)
  - Survey 6 wrapper hiện tại; xác định prop generic: `entityType: 'agent' | 'skill' | 'command' | 'hook' | 'mcp' | 'workflow'`, slot `extra-fields`, emit `created: [entity: T]`.
  - **Survey `PromptCreatorPanel.vue` đã có (nếu tồn tại) để decide extend vs rewrite.** Nếu file đã là primitive generic sẵn → chỉ migrate 6 wrapper, không cần re-implement T4.6 từ scratch (giảm scope). Nếu khác mục đích → giữ tên hoặc rename.
  - Acceptance: API ổn định, không có conditional branching theo entity type trong template; quyết định extend/rewrite ghi vào PR description.
  - Depends on: T4.1.

- [ ] **T4.6 — Implement `PromptCreatorPanel.vue`** (effort: 1.5h, owner: developer)
  - File: `apps/desktop/ui/components/PromptCreatorPanel.vue`.
  - Acceptance: ≤ 150 dòng; dùng `useMockGenerator` bên trong; theme đầy đủ.
  - Depends on: T4.5, T4.3.

- [ ] **T4.7 — Migrate 6 wrapper PromptCreator** (effort: 1.5h, owner: developer)
  - Đích danh 6 wrapper (line baseline xác nhận trong ADR 0009a §3):
    - `AgentPromptCreator.vue` (111 dòng)
    - `SkillPromptCreator.vue` (114 dòng)
    - `CommandPromptCreator.vue` (108 dòng)
    - `HookPromptCreator.vue` (106 dòng)
    - `McpPromptCreator.vue` (109 dòng)
    - `WorkflowPromptCreator.vue` (79 dòng)
  - Tổng baseline: 627 dòng.
  - 6 file gọi `PromptCreatorPanel` qua slot/prop; mục tiêu giảm ~620 dòng tổng → mỗi wrapper ≤ 40 dòng.
  - Acceptance: mỗi wrapper ≤ 40 dòng; UI flow create entity vẫn chạy.
  - Depends on: T4.6.

- [ ] **T4.8 — Lint + typecheck + format PR-4** (effort: 15m, owner: developer)
  - Depends on: T4.7.

- [ ] **T4.9 — Cập nhật doc `nuxt-frontend.md` thêm 2 primitive mới** (effort: 20m, owner: developer)
  - Acceptance: bảng "Component/composable dùng chung" bổ sung 2 entry.
  - Depends on: T4.8.

### QA checklist PR-4

- [ ] Generate mock cho từng entity (agent/skill/command/hook/mcp/workflow): loading state hiển thị; error state hiển thị khi inject error giả; result populate đúng field.
- [ ] PromptCreatorPanel: nhập prompt, click Generate, kết quả preview; click Confirm → entity được tạo + xuất hiện ở list.
- [ ] Test "Generate" 2 lần liên tiếp không tạo race (state reset đúng).
- [ ] Type signature: `useMockGenerator<Agent>` infer đúng kiểu `value: Agent | null`.

### Reviewer focus

1. Generic `T` của `useMockGenerator` không leak vào template (mọi conversion ở composable).
2. 6 wrapper sau migrate có thực sự "thin" hay vẫn còn duplication ẩn (Rule of Three — nếu chỉ 2 case giống, không abstract).
3. PromptCreatorPanel không trở thành "god component" với 10 prop flag — nếu vậy, dừng và discuss.
4. Test type-safe với `vue-tsc` strict — không `any` ngầm.
5. Nếu khác biệt giữa 6 generator quá lớn → có thể chia 2 generic thay vì gộp tất cả; reviewer challenge nếu cần.

---

## PR-5 — Heavy split

> Mục tiêu: tách 5 file vượt ngưỡng > 600 dòng + split `pages/edit/[taskId].vue`. Mỗi file một task lớn, chia subtask per concern.

### 5.A — Split `SessionChat.vue` (1088 dòng → mục tiêu ≤ 250 dòng/file)

- [ ] **T5.A.1 — Map concern + tạo plan tách subcomponent** (effort: 45m, owner: tech-lead)
  - Identify concern: header, messages list, chips popover, composer, autocomplete, tokenize, drawer.
  - Đề xuất split: `SessionHeader.vue`, `SessionMessageList.vue`, `SessionComposer.vue`, `SessionChipsPopover.vue`, `SessionAutocomplete.vue`, `SessionDrawer.vue` + composable `useTokenize.ts` (pure).
  - Acceptance: plan với line-budget từng file; duyệt bởi TL.
  - Depends on: PR-4 merged.

- [ ] **T5.A.2 — Extract `useTokenize.ts` (pure logic)** (effort: 45m, owner: developer)
  - File: `apps/desktop/ui/composables/useTokenize.ts` hoặc `utils/tokenize.ts` nếu thuần pure không reactive.
  - Acceptance: function pure, có unit-test smoke (nếu áp dụng); ≤ 80 dòng.
  - Depends on: T5.A.1.

- [ ] **T5.A.3 — Tách `SessionHeader.vue`** (effort: 45m, owner: developer)
  - Acceptance: ≤ 150 dòng; emit event lên `SessionChat`.
  - Depends on: T5.A.1.

- [ ] **T5.A.4 — Tách `SessionMessageList.vue`** (effort: 1h, owner: developer)
  - Acceptance: ≤ 200 dòng; props nhận messages, virtual scroll giữ nguyên nếu có.
  - Depends on: T5.A.1.

- [ ] **T5.A.5 — Tách `SessionComposer.vue`** (effort: 1h, owner: developer)
  - Acceptance: ≤ 200 dòng; tích hợp `useTokenize`; emit `send`.
  - Depends on: T5.A.2.

- [ ] **T5.A.6 — Tách `SessionChipsPopover.vue` + `SessionAutocomplete.vue`** (effort: 1h, owner: developer)
  - Acceptance: 2 file ≤ 150 dòng mỗi; dùng `useClickOutside`.
  - Depends on: T5.A.1.

- [ ] **T5.A.7 — Tách `SessionDrawer.vue`** (effort: 45m, owner: developer)
  - Acceptance: ≤ 150 dòng.
  - Depends on: T5.A.1.

- [ ] **T5.A.8 — `SessionChat.vue` còn lại làm orchestrator** (effort: 30m, owner: developer)
  - Acceptance: ≤ 200 dòng; chỉ compose subcomponent + state container; xóa hardcode `rgba(0,0,0,0.55)`, `#fff` (4 chỗ ở line 98/104/110/518).
  - Depends on: T5.A.3–T5.A.7.

### 5.B — Split `pages/settings/index.vue` (819 dòng)

- [ ] **T5.B.1 — Plan tách 5 section** (effort: 30m, owner: tech-lead)
  - Đề xuất: `SettingsWorkspaceSection.vue`, `SettingsModelsSection.vue`, `SettingsConnectorsSection.vue`, `SettingsAppearanceSection.vue` + 1 section còn lại theo ADR ("CRUD provider").
  - Acceptance: plan có line budget; duyệt TL.
  - Depends on: PR-4 merged.

- [ ] **T5.B.2 — Tách `SettingsWorkspaceSection.vue`** (effort: 30m, owner: developer)
  - Acceptance: ≤ 150 dòng.
  - Depends on: T5.B.1.

- [ ] **T5.B.3 — Tách `SettingsModelsSection.vue` (gồm CRUD provider)** (effort: 1h, owner: developer)
  - Acceptance: ≤ 250 dòng; xóa hardcode `#22c55e` (line 467) → `t.statusOk`.
  - Depends on: T5.B.1.

- [ ] **T5.B.4 — Tách `SettingsConnectorsSection.vue` + `SettingsAppearanceSection.vue`** (effort: 45m, owner: developer)
  - Acceptance: 2 file ≤ 150 dòng mỗi.
  - Depends on: T5.B.1.

- [ ] **T5.B.5 — `pages/settings/index.vue` còn lại làm router section** (effort: 30m, owner: developer)
  - Acceptance: ≤ 150 dòng.
  - Depends on: T5.B.2–T5.B.4.

### 5.C — Split `components/git/GitBranchList.vue` (759 dòng)

- [ ] **T5.C.1 — Plan tách** (effort: 30m, owner: tech-lead)
  - Đề xuất: `GitBranchListView.vue` (UI list), `GitBranchTree.vue` (tree node recursive), `GitBranchContextMenu.vue` + composable `useBranchTree.ts` (pure: build tree từ flat list, validate branch name).
  - 3 modal đã migrate sang `BaseModal` ở PR-3, chỉ tách presentational ở đây.
  - Acceptance: plan duyệt.
  - Depends on: PR-4 merged.

- [ ] **T5.C.2 — Extract `useBranchTree.ts` (pure)** (effort: 1h, owner: developer)
  - Acceptance: function pure (build tree, validate); 100+ dòng pure logic tách khỏi UI; có unit smoke.
  - Depends on: T5.C.1.

- [ ] **T5.C.3 — Tách `GitBranchTree.vue` (recursive)** (effort: 1h, owner: developer)
  - Acceptance: ≤ 200 dòng; recursive self-reference đúng convention.
  - Depends on: T5.C.1.

- [ ] **T5.C.4 — Tách `GitBranchContextMenu.vue`** (effort: 30m, owner: developer)
  - Acceptance: dùng `ContextMenu.vue` đã có thay vì tự render fixed-position div.
  - Depends on: T5.C.1.

- [ ] **T5.C.5 — `GitBranchList.vue` còn lại orchestrate** (effort: 30m, owner: developer)
  - Acceptance: ≤ 200 dòng.
  - Depends on: T5.C.2–T5.C.4.

### 5.D — Split `pages/workflows/index.vue` (635 dòng)

- [ ] **T5.D.1 — Plan tách** (effort: 30m, owner: tech-lead)
  - Đề xuất: `WorkflowList.vue`, `WorkflowPalette.vue`, `WorkflowCanvas.vue` + util `utils/workflow-edges.ts` (pure: derive edge id).
  - Acceptance: plan duyệt.
  - Depends on: PR-4 merged.

- [ ] **T5.D.2 — Extract `utils/workflow-edges.ts` (pure logic edge id derivation)** (effort: 45m, owner: developer)
  - Acceptance: function pure tách khỏi page; có doc.
  - Depends on: T5.D.1.

- [ ] **T5.D.3 — Tách `WorkflowPalette.vue`** (effort: 45m, owner: developer)
  - Acceptance: ≤ 150 dòng; drag-drop agent vẫn chạy.
  - Depends on: T5.D.1.

- [ ] **T5.D.4 — Tách `WorkflowCanvas.vue` (VueFlow wrapper)** (effort: 1h, owner: developer)
  - Acceptance: ≤ 250 dòng; `useVueFlow()` instance không pass qua props (theo rule); zoom/pan/connect vẫn chạy.
  - Depends on: T5.D.2.

- [ ] **T5.D.5 — `pages/workflows/index.vue` còn lại orchestrate** (effort: 30m, owner: developer)
  - Acceptance: ≤ 200 dòng.
  - Depends on: T5.D.3, T5.D.4.

### 5.E — Split `components/MarkdownRenderer.vue`

- [ ] **T5.E.1 — Plan tách parser vs renderer** (effort: 20m, owner: tech-lead)
  - Đề xuất: `utils/markdown-parse.ts` (pure parse AST) + `MarkdownRenderer.vue` (chỉ render).
  - Acceptance: plan duyệt.
  - Depends on: PR-4 merged.

- [ ] **T5.E.2 — Extract `utils/markdown-parse.ts`** (effort: 45m, owner: developer)
  - Acceptance: parser pure, không reactive; có unit smoke nếu áp dụng.
  - Depends on: T5.E.1.

- [ ] **T5.E.3 — `MarkdownRenderer.vue` chỉ làm renderer** (effort: 45m, owner: developer)
  - Acceptance: ≤ 200 dòng; vẫn tích hợp `MermaidBlock`, `DiffViewer`.
  - Depends on: T5.E.2.

### 5.G — Split `pages/edit/[taskId].vue` (376 dòng)

> TL quyết định ở ADR 0009a §4: KHÔNG migrate sang `MasterDetailShell` (không match interface generic). Thay vào đó, tách 4 subcomponent + xóa hardcode hex ở line 31-32. Tổng effort ~3h.

- [ ] **T5.G.1 — Plan tách 4 subcomponent** (effort: 30m, owner: tech-lead)
  - Xác định 4 subcomponent: `EditorTopBar.vue` (Back + file name + diff stats + view mode picker + Copy/Download), `EditorFileTree.vue` (sidebar file tree), `EditorMonacoPane.vue` (Monaco editor pane), `EditorViewerPane.vue` (Markdown viewer + DiffViewer pane).
  - Acceptance: plan có line-budget từng file; duyệt TL; ghi rõ state ownership giữa page orchestrator vs subcomponent.
  - Depends on: PR-4 merged.

- [ ] **T5.G.2 — Tách `EditorTopBar.vue`** (effort: 45m, owner: developer)
  - Acceptance: ≤ 100 dòng; emit event lên page (back / change-view / copy / download).
  - Depends on: T5.G.1.

- [ ] **T5.G.3 — Tách `EditorFileTree.vue`** (effort: 45m, owner: developer)
  - Acceptance: ≤ 100 dòng; emit `select-file` lên page; recursive nếu cần.
  - Depends on: T5.G.1.

- [ ] **T5.G.4 — Tách `EditorMonacoPane.vue` + `EditorViewerPane.vue` + xóa hex hardcode** (effort: 1h, owner: developer)
  - 2 pane Monaco/Viewer cover 3 view-mode (code/split/preview).
  - **Xóa hex hardcode `#86efac` + `#fca5a5` ở `pages/edit/[taskId].vue:31-32` → `t.diffAdd` / `t.diffDel`** (chuyển từ T5.F.1 sang đây).
  - Acceptance: 2 pane file ≤ 150 dòng mỗi; page orchestrator `pages/edit/[taskId].vue` còn ≤ 200 dòng; grep `#86efac|#fca5a5` trong file = 0.
  - Depends on: T5.G.1.

### Tasks chung PR-5

- [ ] **T5.F.1 — Sweep grep hex hardcode sót còn lại trong codebase** (effort: 20m, owner: developer)
  - Hex `#86efac`/`#fca5a5` ở `pages/edit/[taskId].vue:31-32` đã chuyển sang T5.G.4. Task này chỉ sweep hex sót KHÁC sau khi 5.A–5.G hoàn tất.
  - Acceptance: grep `#[0-9a-fA-F]{3,6}` ở `.vue` ngoài `themes.ts` = 0 instance.
  - Depends on: T5.A–T5.E và 5.G hoàn tất.

- [ ] **T5.F.2 — Migrate `EmptyView.vue` cho 5+ chỗ inline** (effort: 1h, owner: developer)
  - Survey: grep `class=".*text-center.*text-sm"` hoặc tương đương → identify 5+ chỗ; thay bằng `<EmptyView>`.
  - Acceptance: ≥ 5 instance migrated; `EmptyView.vue` được dùng thật.
  - Depends on: PR-4 merged.

- [ ] **T5.F.3 — Migrate `Field.vue` cho 88 instance label inline** (effort: 2h, owner: developer)
  - Survey: grep `uppercase tracking-wider` → identify instance; thay bằng `<Field label="…">…</Field>`.
  - Acceptance: ≥ 80 instance migrated (cho phép 8 instance còn lại có note nếu khác biệt); chỉ 3 → 80+ caller.
  - Depends on: PR-4 merged.

- [ ] **T5.F.4 — Migrate `ContextMenu.vue` cho 9 chỗ fixed-position div** (effort: 1.5h, owner: developer)
  - Survey: grep `fixed.*style=.*top.*left` → identify; thay bằng `<ContextMenu>`.
  - Acceptance: ≥ 8 instance migrated.
  - Depends on: T5.C.4 (Git context menu đã làm gương).

- [ ] **T5.F.5 — Lint + typecheck + format PR-5** (effort: 15m, owner: developer)
  - Depends on: tất cả T5.*.

- [ ] **T5.F.6 — Đo line count cuối + cập nhật README** (effort: 30m, owner: developer)
  - Acceptance: bảng line-count trước/sau cho 22 file vượt ngưỡng ban đầu; tất cả ≤ 250 (hoặc có note rõ ràng nếu không); README `apps/desktop/ui/README.md` bổ sung tên component mới (`SessionHeader`, `SessionMessageList`, ..., `EditorTopBar`, `EditorFileTree`, `EditorMonacoPane`, `EditorViewerPane`).
  - Depends on: T5.F.5.

- [ ] **T5.F.7 — Cập nhật ADR 0009 status `Accepted` + ghi outcome** (effort: 20m, owner: tech-lead)
  - File: `docs/decisions/0009-ui-consolidation-refactor.md`.
  - Acceptance: section "Hệ quả" có actual numbers (dòng giảm thực tế); status `Proposed` → `Accepted`.
  - Depends on: T5.F.6.

### QA checklist PR-5

- [ ] `/tasks` mở session chat: gõ tin nhắn, @mention autocomplete hiện, chip popover mở, drawer toggle, scroll messages mượt.
- [ ] `/settings` 5 section vẫn hiển thị đủ; CRUD provider trong Models section chạy (add/edit/delete).
- [ ] `/git` Branches tab: tree expand/collapse, context menu chuột phải, rename/delete/checkout modal.
- [ ] `/workflows` drag agent từ palette vào canvas; nối edge giữa 2 node; xóa node; zoom in/out; inspector hiển thị khi click node.
- [ ] `/edit/<id>` markdown render: heading/list/code/mermaid/diff đúng; xóa hardcode `#86efac`/`#fca5a5` không vỡ diff color (qua `t.diffAdd/diffDel`).
- [ ] `/edit/<id>` 5.G subcomponents: top bar Back/view-picker/Copy/Download hoạt động; file tree click chọn file; code/split/preview mode switching đúng; Monaco edit + diff viewer render đúng.
- [ ] Empty state 5+ chỗ hiển thị nhất quán (cùng style từ `EmptyView`).
- [ ] Form label 80+ chỗ hiển thị nhất quán (cùng style từ `Field`).
- [ ] Context menu 8+ chỗ behavior nhất quán (click outside đóng, ESC đóng).
- [ ] Toggle theme: 5 file split không vỡ màu nào.
- [ ] So sánh screenshot trước/sau từng tab/section (side-by-side) — pixel-equivalent.
- [ ] Performance: `/workflows` với 50+ node vẫn smooth (no regression sau split `WorkflowCanvas`).
- [ ] Performance: `/tasks` session chat với 100+ message vẫn scroll mượt.
- [ ] Grep cuối: 0 hex/rgba hardcode trong `.vue` files.

### Reviewer focus

1. Subcomponent của SessionChat/Settings không trở thành "thin wrapper" rỗng — mỗi file có SRP rõ.
2. `useBranchTree.ts`, `useTokenize.ts`, `utils/workflow-edges.ts`, `utils/markdown-parse.ts` là **pure function** — không phụ thuộc DOM, store, composable.
3. VueFlow `useVueFlow()` instance không bị pass qua props (rule trong `nuxt-frontend.md`).
4. Recursive `GitBranchTree.vue` không stack-overflow với tree sâu (manual test với 10+ level nesting nếu áp dụng).
5. Migrate `Field.vue` không đổi semantics (label associate với input qua `for`/`id` không bị mất).
6. ADR 0009 status update + actual numbers (không chỉ đoán).
7. README primitive list đầy đủ — dev mới đọc xong biết khi nào dùng cái nào.
8. 5.G `pages/edit/[taskId].vue` subcomponent state ownership rõ — không prop drilling > 2 level.

---

## Dependency graph

```
PR-1 (Foundation)
  │
  ├─→ PR-2 (MasterDetailShell + 11 page)
  │     │
  │     └─→ PR-3 (EditorShell + 8 modal)
  │           │
  │           └─→ PR-4 (useMockGenerator + PromptCreatorPanel)
  │                 │
  │                 └─→ PR-5 (Heavy split, 5 files + edit/[taskId] split)
  │
  └─→ (PR-3 cũng phụ thuộc PR-1 cho BaseModal)
```

**Tasks song song trong cùng PR** (cùng level dependency):
- PR-1: T1.1/T1.2/T1.3 chạy song song; T1.4 đợi 3 task trên.
- PR-2: T2.3–T2.10 chạy song song sau T2.2.
- PR-3: T3.7–T3.12 chạy song song sau PR-1 merge; T3.3–T3.6 chạy song song sau T3.2.
- PR-4: T4.4 và T4.7 chạy song song sau T4.3/T4.6.
- PR-5: 5.A/5.B/5.C/5.D/5.E/5.G song song hoàn toàn sau plan duyệt.

---

## Risk & mitigation

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Merge conflict với branch feature Git Manager đang dev | Cao | Trung | Freeze branch feature trong PR-2 & PR-5 (≤ 5 ngày); rebase mỗi sáng nếu phải tiếp tục. |
| R2 | 11 page migrate đụng UX regression mà QA không bắt | Cao | Cao | Bắt buộc QA chụp screenshot before/after; bắt buộc reviewer click qua 11 page manual. |
| R3 | `EditorShell` slot API không cover hết 6 Editor → phát sinh prop flag conditional | Trung | Cao | Tech-lead survey kỹ ở T3.1 trước khi implement; nếu trong T3.3-T3.6 phát hiện không cover, dừng + redesign + 1 task ADR mới. |
| R4 | ~~ADR đề cập "6 Editor" nhưng codebase chỉ có 3 — spec gap~~ | — | — | **Closed.** ADR 0009a §1 xác nhận đủ 6 Editor: Agent/Skill/Command/Mcp/Project/Hook. |
| R5 | ~~ADR đề cập "8 modal" nhưng identified rõ chỉ 7~~ | — | — | **Closed.** ADR 0009a §2 xác nhận modal thứ 8 = `GitStashList.vue:82`. |
| R6 | `useMockGenerator` generic không cover hết 6 case → ép gộp tạo god-composable | Trung | Trung | **Active.** Theo dõi qua T4.1 survey; nếu khác biệt > 30% logic, chia 2 generic thay vì 1. |
| R7 | Split `SessionChat` làm vỡ session flow chat (state share giữa header/composer/messages) | Cao | Cao | T5.A.1 plan kỹ state ownership; ưu tiên prop-down + emit-up; không prop drilling > 2 level (extract sang store cục bộ nếu cần). |
| R8 | Recursive `GitBranchTree.vue` stack overflow với tree sâu | Thấp | Trung | Manual test 10+ level; nếu cần, chuyển iterative + virtual scroll (defer PR). |
| R9 | Migrate 88 instance `Field.vue` đụng accessibility (label `for`/`id`) | Trung | Trung | Reviewer check semantic HTML; QA test screen reader nếu có (nice-to-have). |
| R10 | Body scroll lock của `BaseModal` không restore khi unmount → kẹt scroll | Trung | Cao | Test mount/unmount 5 lần ở T1.7 QA; cleanup hook trong `onBeforeUnmount`. |
| R11 | 5 PR kéo dài 2 tuần, momentum giảm | Trung | Trung | PR phải merge trong 2 ngày kể từ open; nếu vượt → split PR nhỏ hơn. |

---

## Missing from spec (cần BA/TL xác nhận trước PR-3 & PR-4)

> **Status:** 5/5 đã được TL clarify trong [ADR 0009a](../decisions/0009a-ui-consolidation-clarifications.md). Section này giữ lại làm audit trail.

1. ~~**Đếm chính xác số Editor full-page hiện tại**~~ — **Resolved (ADR 0009a §1):** đủ 6 Editor (Agent 355, Skill 283, Command 298, Mcp 264, Project 229, Hook 224). README cần update (xem B6).
2. ~~**Modal thứ 8**~~ — **Resolved (ADR 0009a §2):** modal inline trong `components/git/GitStashList.vue:82`.
3. ~~**6 file mock generator + 6 PromptCreator wrapper**~~ — **Resolved (ADR 0009a §3):** đủ 6+6, không có Project generator. Tên file đích danh trong T4.1/T4.4/T4.7.
4. ~~**`pages/edit/[taskId].vue` có nên dùng `MasterDetailShell`**~~ — **Resolved (ADR 0009a §4):** KHÔNG. Skip ở PR-2 (T2.10), split subcomponent ở PR-5 §5.G.
5. ~~**Định nghĩa hành vi ESC trong Editor khi dirty**~~ — **Resolved (ADR 0009a §5):** Option (b) — confirm modal "Discard changes?" khi dirty + ESC. `useEscape` push handler vào module-level stack (top of stack mới trigger). `EditorShell` emit `request-close` thay vì `close`.

---

## Backlog (sau MVP refactor)

- [ ] B1. Lint rule auto-enforce `~250 dòng` mỗi file `.vue` (ESLint custom rule hoặc CI step). Code reviewer hiện tại enforce thủ công.
- [ ] B2. Focus trap trong `BaseModal` (tab loop bên trong modal). Defer.
- [ ] B3. Virtual scroll cho `SessionMessageList` nếu tin nhắn > 500. Defer đến khi engine wire.
- [ ] B4. Unit test framework (Vitest) — cần ADR riêng. Hiện QA hoàn toàn manual.
- [ ] B5. Storybook hoặc demo route `/dev/primitives` permanent (T1.7 chỉ tạm). Defer.
- [ ] B6. README `apps/desktop/ui/README.md` — thêm `CommandEditor.vue`, `HookEditor.vue`, `McpEditor.vue` vào mục "Cấu trúc" (nhánh `chore/readme-editor-list` nhỏ, **không gắn vào PR refactor**). Theo ADR 0009a §1.
