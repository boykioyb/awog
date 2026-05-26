# 0009a — UI consolidation clarifications

- **Trạng thái:** Accepted
- **Ngày:** 2026-05-26
- **Bổ sung cho:** [0009](./0009-ui-consolidation-refactor.md)
- **Liên quan:** [docs/features/ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md)

## Bối cảnh

ADR 0009 đặt mục tiêu refactor 4-5 PR P1 với các con số tổng hợp ("6 Editor", "8 modal", "6 mock generator", "6 PromptCreator wrapper") nhưng không liệt kê tên file cụ thể. Project Manager khi decompose task plan đã đánh dấu 5 "Missing from spec" cần Tech Lead clarify trước khi PR-1 bắt đầu. ADR phụ này verify từng con số bằng cách đọc trực tiếp filesystem, ra quyết định cụ thể, và chỉ định task nào trong [ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md) phải cập nhật.

## 1. Số Editor thực tế

### Verify

Đọc trực tiếp 6 file ứng cử trong [apps/desktop/ui/components/](../../apps/desktop/ui/components/):

| File | Lines |
|---|---:|
| [AgentEditor.vue](../../apps/desktop/ui/components/AgentEditor.vue) | 355 |
| [SkillEditor.vue](../../apps/desktop/ui/components/SkillEditor.vue) | 283 |
| [CommandEditor.vue](../../apps/desktop/ui/components/CommandEditor.vue) | 298 |
| [McpEditor.vue](../../apps/desktop/ui/components/McpEditor.vue) | 264 |
| [ProjectEditor.vue](../../apps/desktop/ui/components/ProjectEditor.vue) | 229 |
| [HookEditor.vue](../../apps/desktop/ui/components/HookEditor.vue) | 224 |

Cả 6 file đều tồn tại. README [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md) chỉ liệt kê 3 (Agent/Skill/Project) là **README cũ**, viết trước khi prototype Command/Hook/Mcp được port từ React prototype.

### Quyết định

PR-3 migrate **đủ 6 Editor** sang `EditorShell`. Con số ADR 0009 chính xác. Risk R4 trong task plan (spec gap) đóng — không có gap.

**Reasoning:** 5/6 file đã ≥ 250 dòng (vi phạm hard limit của ADR); tất cả đều có chrome boilerplate giống nhau (header + Save/Cancel + dirty indicator). Migrate sang `EditorShell` mục tiêu giảm ≥ 30 dòng/file × 6 = ≥ 180 dòng, và đưa AgentEditor, CommandEditor, SkillEditor, McpEditor về dưới ngưỡng.

### Action

- Cập nhật task T3.6 trong [ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md): bỏ "nếu tồn tại", liệt kê đích danh `CommandEditor.vue`, `HookEditor.vue`, `McpEditor.vue` với line count baseline.
- Cập nhật task T3.1: survey 6 Editor (không phải "3 + 3 nếu có").
- Cập nhật README [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md) mục "Cấu trúc" — thêm `CommandEditor.vue`, `HookEditor.vue`, `McpEditor.vue` (làm trong PR-1 task T1.9 hoặc nhánh riêng nhỏ).
- Đóng risk R4.

## 2. Modal thứ 8

### Verify

Sweep grep tìm modal pattern trong [apps/desktop/ui/](../../apps/desktop/ui/):

```
rg "(fixed|absolute) inset-0.*backdrop-blur"
```

Kết quả (8 modal đầy đủ):

| # | File:line | Loại |
|---|---|---|
| 1 | [ConfirmDeleteModal.vue:3](../../apps/desktop/ui/components/ConfirmDeleteModal.vue) | `fixed inset-0 backdrop-blur-sm` |
| 2 | [NewTaskModal.vue:3](../../apps/desktop/ui/components/NewTaskModal.vue) | `absolute inset-0 backdrop-blur-sm` |
| 3 | [RerunModal.vue:3](../../apps/desktop/ui/components/RerunModal.vue) | `absolute inset-0 backdrop-blur-sm` |
| 4 | [AttachmentLightbox.vue:4](../../apps/desktop/ui/components/AttachmentLightbox.vue) | `fixed inset-0` (full-screen lightbox) |
| 5 | [GitBranchList.vue:186](../../apps/desktop/ui/components/git/GitBranchList.vue) | rename branch modal inline |
| 6 | [GitBranchList.vue:247](../../apps/desktop/ui/components/git/GitBranchList.vue) | delete branch modal inline |
| 7 | [GitBranchList.vue:308](../../apps/desktop/ui/components/git/GitBranchList.vue) | checkout warning modal inline |
| 8 | [GitStashList.vue:82](../../apps/desktop/ui/components/git/GitStashList.vue) | stash action modal inline |

PM identified 7 vì grep ban đầu chỉ chạy `fixed inset-0` (bỏ qua `absolute inset-0` của NewTaskModal/RerunModal) và chưa quét đầy đủ thư mục `components/git/`. Khi mở rộng grep ra `(fixed|absolute) inset-0.*backdrop-blur` + sweep `components/git/`, lộ ra modal thứ 8 trong `GitStashList.vue:82`.

Lưu ý: `PromptCreatorPanel.vue:2` và `SessionChat.vue:564` cũng dùng `fixed inset-0` nhưng là **drawer/popup overlay**, không phải modal chrome (không có card center, không header X). Không nằm trong scope migrate `BaseModal`. `NavRail.vue:9` là mobile nav overlay, `ContextMenu.vue:3` là click-outside overlay — đều không thuộc modal.

### Quyết định

Modal thứ 8 là **inline modal trong [GitStashList.vue:82](../../apps/desktop/ui/components/git/GitStashList.vue)**. PR-3 phải migrate đủ 8 modal. Con số ADR đúng. Risk R5 đóng.

**Reasoning:** modal stash dùng nguyên pattern chrome (overlay + card center + footer button), giống 3 modal trong `GitBranchList`. Không có lý do để loại trừ.

### Action

- Cập nhật T3.12: đổi từ "Migrate 2 modal còn lại (xác định trong code review)" thành "Migrate `GitStashList.vue:82` modal sang `BaseModal`". Effort 30m không đổi.
- Cập nhật T3.13 sweep grep: dùng pattern `(fixed|absolute) inset-0.*backdrop-blur` (không chỉ `fixed`).
- Đóng risk R5.

## 3. Mock generator + PromptCreator file list

### Verify

Đọc trực tiếp [apps/desktop/ui/composables/](../../apps/desktop/ui/composables/) và [apps/desktop/ui/components/](../../apps/desktop/ui/components/):

**6 mock generator:**

| File | Lines | Return shape |
|---|---:|---|
| [useAgentGenerator.ts](../../apps/desktop/ui/composables/useAgentGenerator.ts) | 109 | `Agent` |
| [useSkillGenerator.ts](../../apps/desktop/ui/composables/useSkillGenerator.ts) | 123 | `Skill` |
| [useCommandGenerator.ts](../../apps/desktop/ui/composables/useCommandGenerator.ts) | 147 | `SlashCommand` |
| [useHookGenerator.ts](../../apps/desktop/ui/composables/useHookGenerator.ts) | 128 | (hook type) |
| [useMcpGenerator.ts](../../apps/desktop/ui/composables/useMcpGenerator.ts) | 147 | (mcp type) |
| [useWorkflowGenerator.ts](../../apps/desktop/ui/composables/useWorkflowGenerator.ts) | 82 | `Workflow` |

Tổng: 736 dòng. Không có `useProjectGenerator.ts` (Project không có flow generate-from-prompt).

**6 PromptCreator wrapper:**

| File | Lines |
|---|---:|
| [SkillPromptCreator.vue](../../apps/desktop/ui/components/SkillPromptCreator.vue) | 114 |
| [AgentPromptCreator.vue](../../apps/desktop/ui/components/AgentPromptCreator.vue) | 111 |
| [McpPromptCreator.vue](../../apps/desktop/ui/components/McpPromptCreator.vue) | 109 |
| [CommandPromptCreator.vue](../../apps/desktop/ui/components/CommandPromptCreator.vue) | 108 |
| [HookPromptCreator.vue](../../apps/desktop/ui/components/HookPromptCreator.vue) | 106 |
| [WorkflowPromptCreator.vue](../../apps/desktop/ui/components/WorkflowPromptCreator.vue) | 79 |

Tổng: 627 dòng (khớp "~620 dòng" trong ADR 0009 mục Pattern lặp).

Đáng chú ý: đã tồn tại file [PromptCreatorPanel.vue](../../apps/desktop/ui/components/PromptCreatorPanel.vue) trong codebase. Cần đọc kỹ ở T4.5 xem có phải primitive sẵn (mà 6 wrapper trên chỉ là wrapper thin) hay là component khác — quyết định cuối cùng về API generic phụ thuộc khảo sát này.

### Quyết định

PR-4 cover **đúng 6 generator + 6 wrapper** như ADR nêu. Con số ADR đúng. Risk R6 vẫn giữ (có khả năng khác biệt logic giữa generator buộc chia thành 2 generic) — confirm bằng survey T4.1 trước khi implement T4.3.

**Reasoning:** 6 file generator nhỏ (82-147 dòng) và có cấu trúc tương tự (state loading/error + async generate). 6 wrapper nhỏ (79-114 dòng) chia sẻ pattern UI prompt → preview → confirm. Đây là Rule of Three rõ ràng (6 > 3).

### Action

- Cập nhật T4.1 trong [ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md): liệt kê đích danh 6 file (`useAgentGenerator.ts`, `useSkillGenerator.ts`, `useCommandGenerator.ts`, `useHookGenerator.ts`, `useMcpGenerator.ts`, `useWorkflowGenerator.ts`) với line count baseline.
- Cập nhật T4.4: liệt kê đích danh 6 caller migrate (cùng 6 file generator) với mục tiêu giảm xuống ≤ 30 dòng/file.
- Cập nhật T4.5: bổ sung sub-bullet "đọc kỹ `PromptCreatorPanel.vue` hiện tại — nếu đã là generic primitive thì PR-4 chỉ cần migrate wrapper, không cần implement primitive mới (T4.6)".
- Cập nhật T4.7: liệt kê đích danh 6 wrapper (`AgentPromptCreator.vue`, `SkillPromptCreator.vue`, `CommandPromptCreator.vue`, `HookPromptCreator.vue`, `McpPromptCreator.vue`, `WorkflowPromptCreator.vue`) với line count baseline.

## 4. `pages/edit/[taskId].vue` không dùng `MasterDetailShell`

### Phân tích cấu trúc

Đọc [pages/edit/[taskId].vue](../../apps/desktop/ui/pages/edit/[taskId].vue) (376 dòng) phần template:

- **Layout fullscreen** (`definePageMeta({ layout: false })`, `h-screen w-full`).
- **Top toolbar đặc thù:** Back button + file name + diff stats + view mode picker (code/split/preview) + Copy/Download. Không khớp slot `toolbar` (đặt trên list) của `MasterDetailShell`.
- **File tree sidebar trái** (`w-56`) + **editor area phải** dạng 3-mode-view (code/split/preview). Editor area có nội dung phụ thuộc `currentFileKind === 'diff'` (DiffViewer) vs textarea + MarkdownRenderer preview pane.
- **Mobile pane** logic tự có (`mobilePane: 'tree' | 'editor'`) — tên giống `MasterDetailShell` nhưng semantics khác (tree không phải list, editor không phải detail).
- Editor pane bên trong còn chia tiếp 2 pane (split mode) — cấu trúc 3 cấp lồng nhau không phải master-detail flat.

11 page master-detail còn lại (Tasks/Projects/Agents/Skills/Git tabs/Settings nav/Workflows list) đều có pattern phẳng "list rows trái + detail card phải" với toolbar top-of-list, không có 3-mode-view editor và không có top-bar đặc thù.

### Quyết định

**Không migrate** `pages/edit/[taskId].vue` sang `MasterDetailShell`. Thay vào đó, tách subcomponent để giảm dòng:

- `EditorFileTree.vue` — sidebar file tree (~80 dòng).
- `EditorToolbar.vue` — top toolbar Back + file meta + view picker + Copy/Download (~80 dòng).
- `EditorViewSwitcher.vue` — code/split/preview body switching (~120 dòng).
- `pages/edit/[taskId].vue` còn lại orchestrate (~100 dòng).

**Reasoning:** ép `MasterDetailShell` cho case này sẽ phá interface generic (phải thêm slot `top-toolbar` riêng, prop `treeWidth`, slot template cho 3-mode view, hoặc dùng `:deep` workaround) — vi phạm YAGNI ("đừng config biết-đâu-cần") và Least Astonishment (slot `list` nhận file tree thay vì entity list rows sẽ confusing). KISS thắng DRY: chấp nhận file tree + editor là pattern riêng (chỉ 1 instance, chưa lan).

### Action

- Cập nhật task T2.10 trong [ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md): đổi từ "Migrate `pages/edit/[taskId].vue` nếu áp dụng" thành "**Skip `pages/edit/[taskId].vue` khỏi PR-2**, ghi note vào file. Tách subcomponent ở PR-5 (subsection mới)".
- Bổ sung subsection **5.G** trong PR-5 với 4 task (`T5.G.1` plan, `T5.G.2` `EditorToolbar`, `T5.G.3` `EditorFileTree`, `T5.G.4` `EditorViewSwitcher`, `T5.G.5` page còn lại orchestrate). Effort tổng ~3h.
- Subsection 5.G này cũng cover việc xóa hardcode `#86efac` + `#fca5a5` (line 31-32) → `t.diffAdd` / `t.diffDel` (đang nằm ở T5.F.1 — chuyển sang T5.G).
- Cập nhật bảng QA checklist PR-2: bỏ entry "/edit/<id> — mở qua Open in editor".
- Bổ sung QA checklist PR-5 subsection 5.G.

## 5. ESC behavior trong Editor khi dirty + modal stacking

### Quyết định product/UX

Khi user mở Editor (`AgentEditor`/`SkillEditor`/`ProjectEditor`/`CommandEditor`/`HookEditor`/`McpEditor`), đã edit form (`dirty=true`), bấm ESC:

**→ Option (b): Hiện `BaseModal` confirm "Discard changes?" với 2 button "Discard" và "Keep editing".**

**Reasoning:**

- **Option (a) "Đóng thẳng, mất change"** — vi phạm Least Astonishment với user đang gõ. Nguy cơ mất công sức không reversible.
- **Option (c) "ESC bị disable khi dirty"** — vi phạm convention OS (ESC luôn cancel/close). Gây bối rối: user không hiểu vì sao ESC không hoạt động.
- **Option (d) "Mặc định confirm; có flag prop override"** — vi phạm YAGNI. Không có case nào trong 6 Editor cần behavior khác. Thêm prop = thêm bề mặt test + branch logic conditional. Bỏ.
- **Option (b)** — match pattern phổ biến (VSCode, IntelliJ, browser tab close). Cost thấp: 1 lần confirm modal dùng `BaseModal` đã có sẵn ở PR-1.

Khi `dirty=false`: ESC đóng thẳng (không confirm). Khi `canSave=false` (validate fail) nhưng dirty: vẫn confirm — vì user có thể đã định edit gì đó nhưng chưa xong, không nên silently discard.

### Modal stacking (ESC chồng modal-trong-editor)

ESC khi `BaseModal` đang mở chồng (ví dụ: ConfirmDeleteModal nested trong AgentEditor đang open): **chỉ đóng modal trên cùng**, không đóng editor.

**Cơ chế:** `useEscape` composable phải push handler vào **stack toàn cục** (module-level array), `keydown` listener chỉ gọi handler **cuối cùng** (top of stack). Khi component unmount, splice handler khỏi stack.

```ts
// pseudo-code, KHÔNG implement code ở ADR
const escapeStack: Array<() => void> = []
export const useEscape = (handler, options) => {
  onMounted(() => {
    escapeStack.push(handler)
    window.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    const i = escapeStack.indexOf(handler)
    if (i >= 0) escapeStack.splice(i, 1)
    window.removeEventListener('keydown', onKey)
  })
  const onKey = (e) => {
    if (e.key !== 'Escape') return
    if (escapeStack[escapeStack.length - 1] !== handler) return
    handler()
  }
}
```

**Reasoning:** alternative dùng `event.defaultPrevented` đòi mỗi modal phải `e.preventDefault()` rồi `stopPropagation` — dễ quên ở 1 caller làm vỡ stacking. Stack toàn cục đặt nặng vào composable, caller chỉ cần `useEscape(handler)` là tự đúng. Match Pattern OCP: thêm modal mới không cần biết about stacking logic.

Backdrop click cũng tuân stack tương tự: backdrop click chỉ đóng modal đang chứa backdrop đó (đã native vì DOM nesting).

### Action

- Cập nhật task **T1.2** (viết `useEscape.ts`): bổ sung yêu cầu **stack handler module-level**, chỉ trigger handler ở top of stack. Update acceptance criteria.
- Cập nhật task **T1.4** (`BaseModal`): no change về API, nhưng comment trên `useEscape` usage giải thích stack semantics.
- Cập nhật task **T3.2** (`EditorShell`): bổ sung emit `request-close` (thay vì `close` trực tiếp). Parent Editor xử lý: nếu `dirty` → mở confirm `BaseModal`; nếu clean → emit `close` xuôi lên.
- Cập nhật task **T3.1** (thiết kế `EditorShell`): bổ sung trong props/emits — `dirty` prop drive confirm flow; emit `request-close` thay vì `close`. Document trong comment block.
- Cập nhật **QA checklist PR-3**:
  - Entry "ESC ở editor — định nghĩa hành vi" → thay bằng 2 entry: "ESC khi editor clean: đóng thẳng" + "ESC khi editor dirty: hiện confirm modal 'Discard changes?'; Discard đóng + mất change; Keep editing đóng modal + ở lại editor".
  - Entry "Mở chồng modal: ESC chỉ đóng modal trên cùng" giữ nguyên (đã có), bổ sung test case 3 cấp: AgentEditor (dirty) → ConfirmDelete modal → ESC chỉ đóng ConfirmDelete (không trigger discard confirm của editor).
- Cập nhật **Reviewer focus PR-1** mục #2: bổ sung "verify stack array cleanup khi unmount, không leak handler giữa các test mount/unmount".

## Tóm tắt impact

| Question | Verdict | Files affected | Effort delta |
|---|---|---|---:|
| 1. Số Editor | 6 (đúng ADR) | T3.1, T3.6, README | +0h |
| 2. Modal thứ 8 | `GitStashList.vue:82` | T3.12, T3.13 | +0h |
| 3. Generator + PromptCreator | 6+6 (đúng ADR) | T4.1, T4.4, T4.5, T4.7 | +0h |
| 4. `pages/edit/[taskId].vue` | Skip MasterDetailShell, split ở PR-5 subsection 5.G | T2.10, PR-5 (+4 task) | +3h trong PR-5 |
| 5. ESC + stacking | Confirm modal khi dirty; ESC stack composable | T1.2, T3.1, T3.2, QA checklist PR-3 | +0h (đã trong ước lượng) |

**Tổng net:** +3h trong PR-5 do tách 4 subcomponent của `pages/edit/[taskId].vue`. Lịch tổng tăng từ ~7 ngày người lên ~7.5 ngày người. Trong tolerance ±0.5 ngày.

## Tham chiếu

- [0009 — UI consolidation refactor](./0009-ui-consolidation-refactor.md) — ADR nguồn.
- [docs/features/ui-consolidation-refactor.tasks.md](../features/ui-consolidation-refactor.tasks.md) — task plan, cần update theo Action ở từng mục.
- [docs/coding/nuxt-frontend.md](../coding/nuxt-frontend.md) — convention component/store/theme.
- [.claude/rules/principles.md](../../.claude/rules/principles.md) — KISS/YAGNI/SRP/OCP/Least Astonishment.
