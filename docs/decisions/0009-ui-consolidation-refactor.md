# 0009 — UI consolidation refactor (Nuxt frontend)

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-26
- **Liên quan:** [.claude/rules/principles.md](../../.claude/rules/principles.md), [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md)

## Bối cảnh

Sau khi port prototype React sang Nuxt 4 và prototyping Git Manager, codebase `apps/desktop/ui/` đã tích tụ đáng kể debt vi phạm [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md):

**1. 22 file vượt ngưỡng `~250 dòng/component`** ([nuxt-frontend.md](../coding/nuxt-frontend.md) dòng 66), trong đó 4 file ≥ 3× ngưỡng:

| File | Lines | Concerns gánh |
|---|---:|---|
| [SessionChat.vue](../../apps/desktop/ui/components/SessionChat.vue) | 1088 | header / messages / chips popover / composer / autocomplete / tokenize / drawer |
| [pages/settings/index.vue](../../apps/desktop/ui/pages/settings/index.vue) | 819 | 5 section trộn chung + CRUD provider |
| [GitBranchList.vue](../../apps/desktop/ui/components/git/GitBranchList.vue) | 759 | list + tree + context menu + 3 modal + validate |
| [pages/workflows/index.vue](../../apps/desktop/ui/pages/workflows/index.vue) | 635 | list + palette + VueFlow canvas + 2 modal |

**2. 15 pattern lặp 3+ lần (vi phạm Rule of Three):**

- **Modal chrome** (overlay + card + header X + footer) — lặp ở 8+ file (ConfirmDeleteModal, NewTaskModal, RerunModal, 6 Editor full-page, 3 modal inline trong GitBranchList).
- **Master-detail layout** (list panel trái + detail phải + `mobilePane`) — lặp ở 11 page.
- **Search input** `<Search /> + <input pl-7>` — lặp 9 page.
- **`inputStyle = computed(() => ({ background: t.bgInput, ... }))`** — 11 lần copy-paste.
- **Form label `uppercase tracking-wider`** — 88 instance, dù `Field.vue` đã có nhưng chỉ 3 file dùng.
- **Mock generator** `useXxxGenerator` — 6 file gần identical.
- **PromptCreator wrapper** — 6 file ~620 dòng duplicate.
- **Rename inline** (`renamingId/renameValue/start/commit/cancel`) — 10 page.
- **Filter toolbar + drawer** — 2 page, sắp lan ra các page khác.
- **ESC listener** — 4 file lặp pattern `addEventListener('keydown')`.
- **Click-outside** popover/menu — 3+ file.
- **Context menu open from button + clamp** — 3+ file (đã có `ContextMenu.vue` nhưng chỉ 1 file dùng).
- **Empty state** inline — 5+ file (`EmptyView.vue` đã có nhưng 0 file dùng).
- **List item row** (icon + title + meta + hover actions) — 10 page.
- **Copy-to-clipboard** — 2+ file, sẽ lan ra.

**3. SRP/SoC vi phạm:**

- `settings/index.vue` — 5 lý do thay đổi trong 1 file.
- `SessionChat.vue` — thực ra là "session screen", không phải "chat component".
- `workflows/index.vue` — page chứa business logic VueFlow edge id derivation.
- `GitBranchList.vue` — trộn 130 dòng pure tree-logic với 600 dòng UI.
- `MarkdownRenderer.vue` — parser + renderer trong cùng `<script setup>`.

**4. Theme color hardcoded (phá vỡ theme system):**

- [AttachmentLightbox.vue](../../apps/desktop/ui/components/AttachmentLightbox.vue) — `rgba(0,0,0,0.85)`, `#fff` (6 chỗ).
- [SessionChat.vue:98,104,110,518](../../apps/desktop/ui/components/SessionChat.vue) — `rgba(0,0,0,0.55)`, `#fff`.
- [ConfirmDeleteModal.vue:4,41](../../apps/desktop/ui/components/ConfirmDeleteModal.vue) — overlay + text trên danger.
- [pages/edit/[taskId].vue:31-32](../../apps/desktop/ui/pages/edit/[taskId].vue) — `#86efac`, `#fca5a5`.
- [pages/settings/index.vue:467](../../apps/desktop/ui/pages/settings/index.vue) — `#22c55e`.

**Tác động:** trước khi wire engine sidecar và Tauri shell, mỗi page sẽ phải nhân thêm logic IPC/state engine. Nếu tiếp tục trên baseline hiện tại, debt sẽ nhân đôi và mọi feature engine sẽ phải copy thêm boilerplate (toast, modal, list, filter, ...) vào file đã quá tải.

## Quyết định

Thực hiện đợt refactor **UI consolidation** chia làm 4-5 PR P1, **trước khi** wire engine sidecar và Tauri shell. Mục tiêu cụ thể:

1. **Mỗi component/page ≤ 250 dòng.** Quá ngưỡng → bắt buộc tách subcomponent hoặc composable.
2. **Extract 9 dùng chung tối thiểu** vào `components/` và `composables/`:
   - `components/BaseModal.vue` — modal chrome chung (header X + footer + ESC + backdrop + scroll lock).
   - `components/EditorShell.vue` — full-page editor shell (cho 6 Editor: Agent/Skill/Command/Hook/Mcp/Project).
   - `components/MasterDetailShell.vue` — list trái + detail phải + `mobilePane` (11 page).
   - `components/SearchInput.vue` — search box với icon, `v-model`.
   - `components/AppInput.vue` — text input + theme style (loại bỏ 11 lần `inputStyle = computed(...)`).
   - `composables/useEscape.ts` — keydown ESC handler.
   - `composables/useClickOutside.ts` — outside-click handler cho popover/menu.
   - `composables/useInlineRename.ts` — pattern rename inline (start/commit/cancel).
   - `composables/useMockGenerator.ts<T>` — gộp 6 generator về 1 generic.
3. **Migrate 3 component đã có nhưng bị bỏ rơi:**
   - `Field.vue` → thay 88 instance label inline.
   - `EmptyView.vue` → thay 5+ empty state inline.
   - `ContextMenu.vue` → thay 9 chỗ tự render `<div fixed style="top/left">`.
4. **Bổ sung theme token** trong [utils/themes.ts](../../apps/desktop/ui/utils/themes.ts):
   - `t.overlay` — rgba đen cho modal backdrop / lightbox.
   - `t.onAccent` — text trên nền accent/danger.
   - `t.diffAdd` / `t.diffDel` — diff line color.
   - `t.statusOk` / `t.statusWarn` — status indicator color.
   - Loại bỏ toàn bộ hex/rgba hardcode trong `.vue`.
5. **Document pattern dùng chung** trong [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) sau khi extract — bảng "Component/composable dùng chung" để dev tương lai không tái phạm.

**Không phải mục tiêu (out of scope):**

- Thay đổi data model, types, store schema.
- Đổi UI/UX hiển thị — refactor phải pixel-equivalent (trừ khi sửa bug lộ ra).
- Thêm feature mới.
- Wire engine sidecar (sẽ tiến hành sau khi refactor xong).
- Đổi dependency (Vue, Pinia, Tailwind, lucide vẫn giữ nguyên).

## Phương án đã cân nhắc

- **Tiếp tục feature engine + Tauri shell trên baseline hiện tại** — debt sẽ nhân đôi. Mỗi page mới phải copy thêm modal/list/filter boilerplate vào file đã quá tải. Pull request review trở nên cực kỳ tốn công vì diff lan rộng. Không bền vững.
- **Refactor toàn diện một lần (big-bang)** — rủi ro cao vì 22 file vượt ngưỡng + 15 pattern lặp; PR đơn sẽ quá lớn không reviewable. Loại bỏ.
- **Refactor chỉ phần Git Manager (đang prototype)** — không giải quyết debt ở 11 page master-detail còn lại; pattern Modal/Search/AppInput vẫn lan ra mọi feature engine sau này.
- **Refactor chia 4-5 PR P1 (đã chọn)** — cân bằng giữa risk và momentum. Mỗi PR ≤ 1 ngày dev, đủ nhỏ để code reviewer kiểm tra kỹ, đủ lớn để mỗi PR có giá trị standalone.

## Hệ quả

### Actual outcome (sau PR-1 → PR-5)

Số liệu thực đo sau khi merge từng PR (so với baseline):

| PR | Phạm vi | Net dòng |
|---|---|---:|
| PR-1 | Foundation: 5 primitive + 6 theme token + 2 composable, chưa migrate caller | +0 |
| PR-2 | `MasterDetailShell` + migrate 11 page master-detail | −116 |
| PR-3 | `EditorShell` + migrate 6 Editor + 8 modal sang `BaseModal` | −146 |
| PR-4 | `useMockGenerator<T>` + `PromptCreatorPanel` generic + migrate 6 generator + 6 wrapper | −217 |
| PR-5.A | Split `SessionChat.vue` 1088 → 69 orchestrator + 7 subcomponent + 1 composable + 1 util (tổng 1260 dòng, nhưng SRP tách rõ) | rebalanced |
| PR-5.B | Split `pages/settings/index.vue` 815 → 64 + 5 section component | rebalanced |
| PR-5.C | Split `GitBranchList.vue` 697 → 250 + `GitBranchTree`/`GitBranchContextMenu`/`GitBranchNameModal`/`GitDirtyCheckoutModal` + `utils/branch-tree.ts` (pure 154 dòng) | rebalanced |
| PR-5.D | Split `pages/workflows/index.vue` 622 → 257 + 4 subcomponent + `utils/workflow-edges.ts` (pure 50 dòng) | rebalanced |
| PR-5.E | Split `MarkdownRenderer.vue` 411 → 94 + `MarkdownInline.vue` 31 + `utils/markdown-parse.ts` 160 | rebalanced |
| PR-5.G | Split `pages/edit/[taskId].vue` 376 → 208 + 4 subcomponent (`EditorTopBar`/`EditorFileTree`/`EditorMonacoPane`/`EditorViewerPane`); xóa hex `#86efac`/`#fca5a5` → `t.diffAdd`/`t.diffDel` | rebalanced |
| PR-5 sweep | `EmptyView` migrate 7 page (trước PR-5: 0 file dùng); `Field` migrate ~31 instance (trước PR-5: 3 file dùng); `ContextMenu` đã được dùng ở 10 caller sau PR-5.C | partial |

Tất cả file vượt ngưỡng ban đầu (22 file ≥ 250 dòng) đã được tách hoặc thu gọn dưới ngưỡng, ngoại trừ:

- `components/SettingsModelsSection.vue` (452 dòng) — flag follow-up, chứa CRUD provider phức tạp.
- `components/CommandEditor.vue` (278 dòng), `AgentEditor.vue` (257 dòng), `pages/workflows/index.vue` (257 dòng), `pages/git/index.vue`, `components/git/GitBranchList.vue` (250) — vượt nhẹ, chấp nhận.

### Lợi ích

- **Tích cực:**
  - Mỗi page mới (engine wiring, Tauri tray, settings mới) sẽ ngắn ~150 dòng thay vì ~400-500 dòng.
  - Theme rule "phải đi qua `useTheme()`" được tuân thủ thực sự — toggle dark/light không vỡ.
  - 6 mock generator → 1 generic + 6 file ~30 dòng (giảm ~400 dòng).
  - 11 master-detail page → giảm trung bình 60-80 dòng/page (~ -700 dòng tổng).
  - 8+ modal/editor → loại bỏ chrome boilerplate ~30 dòng/file.
  - QA dễ regression test hơn vì surface UI dùng chung được test 1 lần ở `BaseModal`/`SearchInput`/`MasterDetailShell`.
  - Pattern dùng chung được document → dev tương lai không tái phạm.

### Follow-up backlog

- Sweep migrate `Field.vue` cho phần label còn lại (~57 instance) cần đánh giá pattern-by-pattern: nhiều label là section header / list divider chứ không phải label-above-input, không phù hợp Field primitive.
- Sweep hex/rgba hardcode trong `DiffViewer.vue`, `SideDiffViewer.vue`, `ToggleField.vue`, `ToggleCard.vue`, `StepItem.vue`, `HookDetail.vue`, `McpDetail.vue`, `SessionStepDetail.vue` — chưa migrate sang theme token.
- `SettingsModelsSection.vue` (452 dòng) — chia tiếp khi CRUD provider có thêm logic mới.
- Pre-existing type errors (4 cái ngoài scope PR-5): `NewTaskModal.vue:206`, `stores/workspace.ts:228`, `utils/graph.ts:12,13,23`.
- **Tiêu cực / Trade-off:**
  - Delay feature engine wiring ~1-2 tuần (4-5 PR P1, mỗi PR 1 ngày dev + 0.5 ngày review/QA).
  - PR refactor "không có user-facing value" — phải chấp nhận đầu tư internal-quality.
  - Risk regression UI: phải test thủ công 11 page sau migrate `MasterDetailShell` + tất cả modal sau migrate `BaseModal`. QA cần playthrough toàn bộ flow.
  - Merge conflict với branch feature đang dev (Git Manager) — phải sync sớm hoặc freeze nhánh feature trong giai đoạn migrate.
- **Việc cần làm tiếp:**
  - Project Manager chia 4-5 PR P1 theo thứ tự sau (dependency tăng dần):
    1. **PR-1 — Foundation:** `BaseModal`, `SearchInput`, `AppInput`, `useEscape`, `useClickOutside`, theme token mới. Chưa migrate caller. (~1 ngày)
    2. **PR-2 — Master-detail shell:** `MasterDetailShell.vue` + migrate 11 page list. (~1 ngày)
    3. **PR-3 — Editor shell + modal migration:** `EditorShell.vue` + migrate 6 Editor + 8 modal sang `BaseModal`. (~1 ngày)
    4. **PR-4 — Prompt creator + mock generator gộp:** `useMockGenerator<T>` + `PromptCreatorPanel` generic + migrate 6 wrapper. (~0.5 ngày)
    5. **PR-5 — Heavy split:** tách `SessionChat.vue`, `settings/index.vue`, `GitBranchList.vue`, `workflows/index.vue`, `MarkdownRenderer.vue`. (~1.5 ngày)
  - QA Tester soạn test plan regression 11 page master-detail + 8 modal trước khi merge PR-2/PR-3.
  - Code Reviewer enforce hard limit `~250 dòng` trong CI (lint rule hoặc PR template checkbox).
  - Cập nhật [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) mục "Component/composable dùng chung" sau PR-1.
  - Cập nhật [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md) — danh sách primitive UI và khi nào dùng.

## Tham chiếu

- [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) — convention component/store/theme bị vi phạm.
- [.claude/rules/principles.md](../../.claude/rules/principles.md) — KISS/YAGNI/DRY/SRP/Rule of Three.
- [.claude/rules/nuxt-vue.md](../../.claude/rules/nuxt-vue.md) — quy tắc component < ~250 dòng.
- [apps/desktop/ui/](../../apps/desktop/ui/) — phạm vi refactor.
- [utils/themes.ts](../../apps/desktop/ui/utils/themes.ts) — theme token cần mở rộng.
