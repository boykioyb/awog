# Coding Guide — Nuxt Frontend

Quy ước cho **Nuxt 4 + Vue 3 + TypeScript + Pinia + VueFlow + TailwindCSS**. Áp dụng cho [apps/desktop/ui/](../../apps/desktop/ui/).

Quy ước cross-stack (TypeScript, đặt tên chung, Git, bảo mật): xem [general.md](./general.md). Tài liệu này **chỉ** ghi những thứ riêng cho frontend.

> **Format và lint do công cụ enforce**, không nhớ bằng đầu. Xem mục [Lint & Format](#lint--format) cuối tài liệu. Chạy `pnpm lint:fix && pnpm format` trước khi commit là đủ.

## Đặt tên (frontend)

| Đối tượng | Convention | Ví dụ |
|---|---|---|
| Component `.vue` | PascalCase | `TaskListItem.vue` |
| Page / layout `.vue` | kebab-case | `pages/tasks/index.vue`, `layouts/default.vue` |
| Composable | `useXxx.ts` | `useTheme.ts` |
| Pinia store | `useXxxStore` trong file `xxx.ts` ở `stores/` | `useWorkspaceStore` ← `stores/workspace.ts` |
| Custom event | kebab-case | `@select-task`, `@phase-approve` |
| Slot | kebab-case | `<slot name="header" />` |

## Cấu trúc thư mục (`apps/desktop/ui/`)

```
ui/
├── app.vue              # Root: <NuxtLayout><NuxtPage /></NuxtLayout>
├── layouts/             # default.vue chứa NavRail + TopBar
├── pages/               # File-based routing
├── components/          # Component dùng chéo nhiều page
├── composables/         # use*.ts — logic chia sẻ reactive
├── stores/              # Pinia store
├── utils/               # Hàm thuần (không reactive)
├── types/               # TypeScript type chia sẻ
├── assets/css/          # CSS global (main.css)
└── public/              # Static asset
```

**Quy tắc đặt vào đâu:**

- Logic reactive + có lifecycle → `composables/`
- Hàm thuần (sort, format, calc) → `utils/`
- State app-wide → `stores/`
- State cục bộ một component → `ref`/`reactive` tại chỗ
- Type dùng chéo nhiều file → `types/index.ts`

## Vue 3 — Component

- **Composition API + `<script setup lang="ts">` luôn luôn.** Không Options API.
- **`defineProps` + `withDefaults` + type-only.**
- **`defineEmits` type-only.**
- **`defineExpose` chỉ khi parent thực sự cần.**

```vue
<script setup lang="ts">
type Props = {
  task: Task
  selected?: boolean
}
const props = withDefaults(defineProps<Props>(), { selected: false })

const emit = defineEmits<{
  select: [taskId: string]
  approve: [taskId: string, phaseId: string]
}>()
</script>
```

- **Một component fit trong ~250 dòng.** Quá dài → tách subcomponent.
- **Thứ tự block:** `<template>` → `<script setup>` → `<style>` (hiếm khi cần).
- **Tránh `v-html`.** Render markdown/HTML đi qua component dedicated (`MarkdownRenderer.vue`).
- **`computed` cho derived state**, không lưu shadow ref.
- **`watch` chỉ khi không thể dùng `computed`** (cần side effect).
- **`ref`** cho primitive / object thay nguyên khối; **`reactive`** cho object có mutation nhiều field.
- **Props readonly.** Đừng mutate `props.x` — emit event để parent tự update.

## Pinia store

- **Composition style** (`defineStore('name', () => { ... })`), không Options style.
- **State (ref) / getters (computed) / actions (function)** rõ ràng trong return.
- **Không gọi store ở module top-level** — gọi trong setup hoặc trong function.
- **Một store = một bounded context.** `workspace` ≠ `settings`. Không gộp.
- **Action async** đặt tên rõ (`fetchTasks`, `runTask`), trả `Promise<void>` hoặc `Promise<T>`.

```ts
export const useWorkspaceStore = defineStore('workspace', () => {
  const tasks = ref<Task[]>([])
  const selectedTaskId = ref<string | null>(null)

  const selectedTask = computed(() =>
    tasks.value.find(t => t.id === selectedTaskId.value) ?? null
  )

  function selectTask(id: string) {
    selectedTaskId.value = id
  }

  return { tasks, selectedTaskId, selectedTask, selectTask }
})
```

## Styling — Tailwind + theme token

Hai nguồn style đan xen:

- **Class Tailwind** cho layout, spacing, typography, responsive.
- **Inline `:style`** cho **màu theme** (bind từ `useTheme()`):

```vue
<template>
  <div
    class="px-4 py-2 rounded-md text-sm"
    :style="{ background: t.bg, color: t.text, border: `1px solid ${t.border}` }"
  >
    ...
  </div>
</template>
```

Lý do tách đôi: theme token đổi runtime (dark ↔ light), Tailwind compile-time. **Không hardcode hex trong class.**

- **Không tạo CSS class custom** trừ khi Tailwind/inline không xử lý được (animation phức tạp, scrollbar).
- **`assets/css/main.css`** chỉ chứa reset, scrollbar, base — không component style.
- **Responsive:** dùng prefix Tailwind (`md:`, `lg:`). Hiện UI tối ưu cho desktop ≥ 1280.

## UI patterns

Hai pattern UI dễ regress (đã sửa nhiều lần) — quy ước rõ ở đây để không lặp lại.

### 1. Detail header action buttons — icon-only đồng nhất

Mọi `*Detail.vue` (SkillDetail / AgentDetail / McpDetail / …) có hàng action button ở góc phải header. **Tất cả button trong hàng đó dùng cùng style icon-only**, không mix text+border với icon-only.

```vue
<button
  class="p-1.5 rounded transition"
  :style="{ color: t.textDim }"
  title="Edit"
  @click="emit('edit')"
  @mouseenter="(e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.background = t.bgHover     // hoặc t.dangerBg cho destructive
    el.style.color = t.text              // hoặc t.danger cho destructive
  }"
  @mouseleave="(e: MouseEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.background = 'transparent'
    el.style.color = t.textDim
  }"
>
  <Edit3 :size="13" />
</button>
```

- Icon size **13** (lucide-vue-next), padding **`p-1.5`**.
- Default color `t.textDim`. Không bao giờ dùng `t.text` mặc định — giữ button subtle, hover mới làm nổi.
- `title` bắt buộc — thay cho text label, mô tả verb ("Edit", "Restart server", "Delete server").
- Stateful action (vd. MCP Test có spinner) vẫn icon-only — swap icon (`Loader2 animate-spin`) + cập nhật `title` ("Testing…"). Tooltip + animation đủ truyền state, không cần text.
- **Không** dùng `px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5` cho header action — đó là EditorShell save/cancel pattern, khác surface.

Áp dụng cho: `SkillDetail`, `AgentDetail`, `McpDetail`, mọi `*Detail.vue` thêm sau. Save/Cancel trong `EditorShell` và inline button row của `MarkdownBodyView` có pattern riêng — không đụng.

### 2. Editor textarea — `resize-y` không `resize-none`

Mọi `<textarea>` trong `*Editor.vue` (Agent/Skill/Mcp/Project/Command/Hook) + create-form modal (NewTaskModal) chứa **nội dung dài-tự do** (description, body, systemPrompt, command, args) phải vertically-resizable.

```vue
<textarea
  v-model="..."
  :rows="N"
  class="w-full rounded px-2 py-1.5 text-[12px] resize-y min-h-[<initial-rem>]"
  :style="inputStyle"
/>
```

- `resize-y`: chỉ chiều dọc (horizontal sẽ phá grid).
- `min-h-[…]`: floor để user không kéo nhỏ hơn `rows`. Bảng map:

| `rows` | `min-h` |
|---|---|
| 2 | `min-h-[3rem]` |
| 3 | `min-h-[4rem]` |
| 4 | `min-h-[5rem]` |
| 6 | `min-h-[8rem]` |
| 12 | `min-h-[12rem]` |

**Không áp dụng** (giữ `resize-none` có chủ đích):

- `PromptCreatorPanel` + 3 creator chat modal (Agent/Skill/Mcp): chat-style, compact + flex auto-grow.
- `SessionComposer`, `GitCommitPanel`, `PhaseDiscussTab`: chat composer với auto-grow logic riêng.
- `SettingsOAuthCodeDialog`, `RerunModal`: single-purpose modal input.
- `EditorMonacoPane`: Monaco controls.

Khi cần `resize-none` ở chỗ mới, thêm comment 1 dòng nói lý do.

## Routing (Nuxt pages)

- File-based. Đừng tự khai báo route trừ khi thực sự cần.
- Dynamic param: `[param].vue` (vd. `pages/edit/[taskId].vue`).
- Trang fullscreen không layout: `definePageMeta({ layout: false })`.
- Query string: `useRoute().query`.
- Navigate programmatically: `navigateTo()` thay vì `router.push` trực tiếp.

## Composable

- File `useXxx.ts`. Trả về object có shape ổn định.
- **Singleton state** (như `useTheme`) → giữ state ngoài hàm (module-scope ref) khi cần share giữa các caller; ghi rõ trong tài liệu của composable.
- **Không gọi composable trong điều kiện** (cùng quy tắc như React hook nhưng Vue cho phép setup boundary).

### Page-controller composable (tách page lớn)

Khi một page/SFC vượt ~250 dòng, **không** để logic phình trong `<script setup>`. Tách:

1. **Markup lặp → component con** (vd [`AgentListItem.vue`](../../apps/desktop/ui/components/agent/AgentListItem.vue)).
2. **UI/logic lặp giữa nhiều trang → composable dùng chung** (vd [`useToasts`](../../apps/desktop/ui/composables/useToasts.ts) gom toast của agents + skills). Rule of Three: 2 copy = tín hiệu, 3 = bắt buộc.
3. **Toàn bộ state + computed + handler còn lại → page-controller composable** `useXxxManager()` (vd [`useSkillsManager`](../../apps/desktop/ui/composables/useSkillsManager.ts)). Page còn lại đúng `<template>` + một destructure:

```vue
<script setup lang="ts">
import { Wand2 } from 'lucide-vue-next' // chỉ import gì template trực tiếp cần (icon)
const { filtered, selectedKey, editing, onSelect, pushToast /* … */ } = useSkillsManager()
</script>
```

- **Template ref / lifecycle đặt được trong composable:** `ref="sidebarRef"`, `onMounted`, `watch` đăng ký trên instance gọi composable.
- **Write tới destructured ref trong template tự `.value =`:** Vue compiler transform `editing = true`, `pendingDelete = null`, `(v) => (searchQuery = v)` thành `.value =`. Đã verify với `@vue/compiler-sfc` 3.5 → **không cần** viết setter riêng.
- **Auto-import:** composable trong `composables/` không cần `import` trong page.
- Kết quả thực tế: `pages/skills/index.vue` 570 → 179 dòng (logic dời sang `useSkillsManager`).

## Component/composable dùng chung

Sau đợt refactor [ADR 0009](../decisions/0009-ui-consolidation-refactor.md) ([clarifications 0009a](../decisions/0009a-ui-consolidation-clarifications.md)), các primitive sau là **single source of truth** cho pattern lặp ở [apps/desktop/ui/](../../apps/desktop/ui/). Trước khi tự viết modal/input/list-detail mới, kiểm tra bảng dưới.

| Primitive | Loại | Khi nào dùng | Khi nào KHÔNG dùng |
|---|---|---|---|
| [`BaseModal.vue`](../../apps/desktop/ui/components/BaseModal.vue) | Component | Mọi modal chrome (overlay + card + header X + footer). Trao ESC + backdrop + scroll lock. | Drawer side panel, context menu, fullscreen lightbox custom (cân nhắc nhưng có thể OK). |
| `EditorShell.vue` *(PR-3)* | Component | Full-page editor cho entity (Agent/Skill/Command/Hook/Mcp/Project). Có dirty + Save/Cancel + `request-close`. | Markdown editor `pages/edit/[taskId].vue` (top toolbar đặc thù — xem ADR 0009a §4). |
| `MasterDetailShell.vue` *(PR-2)* | Component | List trái + detail phải + `mobilePane`. 11 page CRUD entity. | Page có 3-pane (tree + 2 pane), top toolbar đặc thù, hoặc cấu trúc không-master-detail. |
| [`SearchInput.vue`](../../apps/desktop/ui/components/SearchInput.vue) | Component | Search box có icon `Search` + `v-model`. Inline trong toolbar list. | Form input bình thường (dùng `AppInput`). |
| [`AppInput.vue`](../../apps/desktop/ui/components/AppInput.vue) | Component | Text/email/password/number input + theme style + `invalid` state. Thay thế `inputStyle = computed(...)`. | Textarea (chưa abstract), select, file input. |
| [`useEscape`](../../apps/desktop/ui/composables/useEscape.ts) | Composable | Đóng modal/popover khi ESC. Tự stack: modal trên cùng đóng trước. | Global shortcut không liên quan stacking — cần listener riêng. |
| [`useClickOutside`](../../apps/desktop/ui/composables/useClickOutside.ts) | Composable | Đóng popover/menu khi click ra ngoài. Dùng `mousedown` (race-safe với button click trong). | Modal backdrop click (đã có trong `BaseModal`). |
| [`useMockGenerator<T>`](../../apps/desktop/ui/composables/useMockGenerator.ts) | Composable | Mock generate entity từ prompt (Agent/Skill/...). Bọc empty-prompt guard + 400ms latency + `isGenerating`/`error`. Caller chỉ truyền pure `generate(prompt) => T`. | Generator có state phức tạp ngoài `value/loading/error` (multi-step, cancellable). |
| [`usePromptCreator<TDraft>`](../../apps/desktop/ui/composables/usePromptCreator.ts) | Composable | Boilerplate cho 6 `{Entity}PromptCreator.vue`: `draft` ref + `onSubmit` + `onRegenerate`. Phối với một generator (`useAgentGenerator`, ...). | Tạo entity không có flow "generate → preview → save" 2 bước. |
| [`PromptCreatorPanel.vue`](../../apps/desktop/ui/components/PromptCreatorPanel.vue) | Component | Khung popover floating tạo entity từ prompt: headline / textarea / Generate button / preview slot / actions slot. Theme + anchor positioning. | Form tạo entity inline thuần (không cần prompt-to-draft); modal full-screen có yêu cầu chrome khác. |

**Theme token mới** trong [`utils/themes.ts`](../../apps/desktop/ui/utils/themes.ts):

| Token | Dùng cho |
|---|---|
| `t.overlay` | Backdrop modal/lightbox (rgba đen, khác giữa dark/light). |
| `t.onAccent` | Text trên nền `accent`/`danger` button. |
| `t.diffAdd` / `t.diffDel` | Markdown diff viewer line color. |
| `t.statusOk` / `t.statusWarn` | Status indicator dot/badge. |

> **Quy tắc:** thấy mình copy `fixed inset-0 backdrop-blur` lần thứ 2 → dừng, dùng `BaseModal`. Thấy copy `inputStyle = computed(...)` lần thứ 2 → dừng, dùng `AppInput`. Pattern lặp 3+ lần mà chưa có primitive → mở thảo luận extract, không tự viết bản thứ tư.

## VueFlow

- Node + edge data → giữ trong store, hoặc local ref khi chỉ scope một page.
- **Tách node component** ra file riêng khi node có > 30 dòng template.
- Truy cập instance qua `useVueFlow()`, không pass instance qua props.
- **Với > 500 node**: cân nhắc cluster/virtual hoặc chia canvas.

## Server API (sẽ áp dụng khi wire engine)

- Đặt ở `server/api/` (Nuxt 4 convention).
- Validate input với schema (planned: zod).
- Trả về JSON: `{ data, error? }`.
- **Không expose API key ra UI** — luôn proxy qua server route.

## Performance

- **Tránh `watch` deep trên object lớn** — ưu tiên `computed` hoặc `watchEffect` dependency rõ.
- **`shallowRef` / `shallowReactive`** cho object lớn không cần reactivity sâu (Monaco model, VueFlow graph khi tự quản lý).
- **Lazy load route nặng** với dynamic import khi cần.
- **`v-once` / `v-memo`** cho danh sách render nặng, ít đổi.

## Lint & Format

Frontend dùng **ESLint** (rule) + **Prettier** (formatter), cấu hình base là **Airbnb** điều chỉnh cho Nuxt/Vue/TS.

**Stack:**
- [eslint-config-airbnb-base](https://github.com/airbnb/javascript) + [eslint-config-airbnb-typescript](https://github.com/iamturns/eslint-config-airbnb-typescript) — rule JS/TS gốc Airbnb
- [eslint-plugin-vue](https://eslint.vuejs.org/) (`vue3-recommended`) — rule SFC Vue 3
- [`@typescript-eslint`](https://typescript-eslint.io/) — rule TypeScript
- [Prettier](https://prettier.io/) + `eslint-config-prettier` + `eslint-plugin-prettier` — format và tích hợp

**Lệnh:**

```bash
pnpm lint          # check
pnpm lint:fix      # auto-fix lint + Prettier
pnpm format        # Prettier toàn bộ .ts/.vue/.js/.json/.md
pnpm format:check  # check format không sửa
```

**Style chính (Prettier):**

| Option | Giá trị |
|---|---|
| `semi` | `false` — **không** dùng `;` |
| `singleQuote` | `true` |
| `trailingComma` | `all` |
| `tabWidth` | `2` |
| `printWidth` | `100` |
| `arrowParens` | `always` |

**Khác biệt với Airbnb gốc:**

| Rule | Trạng thái | Lý do |
|---|---|---|
| `semi` | `'never'` | Style dự án — không dùng `;` (override Airbnb) |
| `no-plusplus` | `off` | Cho phép `++`/`--` trong code thuật toán (topo sort, generator) |
| `no-continue` | `off` | Cho phép trong loop nhiều nhánh |
| `no-param-reassign` | `props: false` | Pinia store action mutate state ref |
| `import/no-unresolved`, `import/extensions` | `off` | Nuxt auto-import + alias `~/` |
| `vue/multi-word-component-names` | `off` | Cho phép `app.vue`, `index.vue` |
| `no-console` | `warn`, allow `warn`/`error` | Chỉ chặn `console.log` |
| `@typescript-eslint/no-explicit-any` | `error` | Áp luật chung của [general.md](./general.md) |

**File config nằm ở:**
- [`apps/desktop/ui/.eslintrc.cjs`](../../apps/desktop/ui/.eslintrc.cjs)
- [`apps/desktop/ui/.prettierrc`](../../apps/desktop/ui/.prettierrc)
- [`apps/desktop/ui/.eslintignore`](../../apps/desktop/ui/.eslintignore) / [`.prettierignore`](../../apps/desktop/ui/.prettierignore)

> Khi muốn thêm/đổi rule: sửa `.eslintrc.cjs` + ghi nhật ký vào bảng "Khác biệt với Airbnb" ở trên + nêu lý do trong PR.

**Bị ignore khỏi typed-lint:** `nuxt.config.ts`, `tailwind.config.ts`, `*.config.{ts,mjs,js}`, `.eslintrc.cjs` — vì TypeScript-ESLint typed rule yêu cầu file phải nằm trong `tsconfig.json` includes, các file config thường không.

## Checklist PR (frontend)

- [ ] `pnpm lint` pass (0 error)
- [ ] `pnpm format:check` pass
- [ ] `pnpm typecheck` pass
- [ ] Không có `any`, `@ts-ignore` không lý do, `console.log` còn sót
- [ ] Component mới có type cho props/emits đầy đủ
- [ ] Cập nhật [apps/desktop/ui/README.md](../../apps/desktop/ui/README.md) khi thêm route/component đáng kể
- [ ] Cập nhật [apps/desktop/ui/types/index.ts](../../apps/desktop/ui/types/index.ts) khi đổi entity shape
- [ ] Theme color → đi qua `useTheme()`, không hardcode
