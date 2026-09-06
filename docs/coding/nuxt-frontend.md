# Coding Guide — Nuxt Frontend

Quy ước cho **Nuxt 4 + Vue 3 + TypeScript + Pinia + VueFlow + TailwindCSS**. Áp dụng cho [apps/desktop/ui-next/](../../apps/desktop/ui-next/).

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

## Cấu trúc thư mục (`apps/desktop/ui-next/`)

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

- **Thực tế ở `ui-next`: phần lớn style nằm trong `<style scoped>` của component**, không phải utility Tailwind. Tailwind lo layout/spacing; typography + màu + bo góc đi qua design token (dưới đây). Trong 298 file `.vue` hiện có **0** usage `text-xs`/`text-sm`/`rounded-*` — đừng giới thiệu lại chúng.
- **`assets/css/main.css`** chỉ chứa 3 directive Tailwind. Design system thật nằm ở `assets/css/prototype.css` (token + class dùng chung), `app-shell.css` (override toàn cửa sổ, load sau nên thắng), `theme-cute.css` (theme family thứ 2, mọi rule scoped `body[data-theme-family='cute']`).
- **Responsive:** dùng prefix Tailwind (`md:`, `lg:`). Hiện UI tối ưu cho desktop ≥ 1280.

### Design token — bắt buộc, có guard

`pnpm lint` chạy `scripts/check-design-tokens.mjs` và **fail** nếu hardcode. Chi tiết: [ADR 0079](../decisions/0079-native-macos-shell-and-design-tokens.md), [native-macos-polish.md](../features/native-macos-polish.md).

| Nhóm | Token | Cấm |
|---|---|---|
| Type scale | `--fs-xs` 11 · `--fs-sm` 12 · `--fs-md` 13 · `--fs-lg` 15 · `--fs-xl` 17 · `--fs-2xl` 22 (@base 13) | `font-size: <n>rem` |
| Leading | `--lh-xs` 16 · `--lh-sm` 18 · `--lh-md` 20 · `--lh-lg` 22 · `--lh-xl` 24 · `--lh-2xl` 28 · `--lh-prose` 22 (@base 13) | `line-height: <hệ số lẻ>` |
| Spacing | chưa có token — **quy ước**: `padding` / `margin` / `gap` px **chẵn** (±1px được giữ) | `padding/margin/gap` px **lẻ** |
| Radius | `--r-xs` 6 · `--r-sm` 8 · `--r-btn` 10 · `--r-card` 14 · `--r-panel` 16 · `--r-pill` | `border-radius: <n>px` |
| Icon | `--icon-xs` 12 · `--icon-sm` 14 · `--icon-md` 16 (mặc định `.icn`) · `--icon-lg` 20 · `--icon-xl` 24 | cỡ icon **px lẻ** |
| Màu | `useTheme()` / CSS var | hex trong class hoặc `<style>` |
| Motion | `--dur-fast` `--dur` `--dur-panel` + `--ease` | duration/easing hardcode |
| Elevation | `--shadow-sm/md/lg` | `box-shadow` hardcode |

Type scale khai bằng `calc(var(--font-size-base) ± Npx)` — Appearance cho kéo base 12→18, nên `rem` sẽ cho ra nửa pixel (`0.8846rem` = 11.5px) và macOS render nhoè. `em` vẫn hợp lệ (tương đối với cha); `px` cố định hợp lệ cho badge không muốn scale.

Leading **phải có đơn vị**. Hệ số không đơn vị nhân lại với font-size của từng element, nên `1.5` biến `--fs-md` 13px thành hộp dòng 19.5px — đúng cái nửa pixel mà type scale vừa khử. Giá trị có đơn vị kế thừa xuống dưới dạng **độ dài cố định**, không nhân lại.

Nguyên pixel chưa đủ — hộp dòng còn phải **CHẴN**, vì icon cỡ chẵn căn giữa trong hộp dòng lẻ lại rơi vào nửa pixel (`(19 − 16) / 2 = 1.5`). Bản `calc(base + Npx)` chỉ chẵn ở base 13 và 15; ở 12/14/16/18 mọi bậc ra số lẻ. Nên `--lh-*` khai bằng **`round(up, calc(var(--font-size-base) * k), 2px)`** — hàm math của CSS (Chrome 125+, Electron 33 = Chromium 130) snap mỗi bậc lên bội số 2px, chẵn bằng cấu tạo ở cả **6 base × 7 token**. Hệ số `k` chọn sao cho base 13 giữ **đúng** giá trị cũ: 1.2 / 1.35 / 1.5 / 1.6 / 1.8 / 2.1 / 1.65.

- Rule nào tự khai `font-size: var(--fs-X)` thì khai luôn `line-height: var(--lh-X)` (cùng hậu tố). Codemod [`scripts/codemod-line-height.mjs`](../../apps/desktop/ui-next/scripts/codemod-line-height.mjs) ghép cặp này.
- `font-size` là px cố định (badge/chip không scale) ⇒ `line-height` cũng là **px nguyên**, không phải token.
- Văn bản dài (markdown, bong bóng chat, wiki reader, issue/PR body) dùng `--lh-prose` (1.69 trên chữ 13px), không dùng `--lh-md`.
- **Hệ số nguyên vẫn hợp lệ** (`line-height: 1` cho icon button): nguyên × px nguyên vẫn là px nguyên.
- 173 site legacy (97 file) còn hệ số lẻ, khai trong `LEGACY_COEFFICIENTS` của guard dưới dạng **trần đếm theo file** — file chỉ được giảm, không được tăng. Đi qua file nào thì dọn file đó.

Icon scale **cố định px** (không `calc()` theo base): icon là hình vẽ, không phải chữ — cho nó phình theo Appearance là làm nó tràn container. Bậc nào cũng **chẵn**, vì một icon cỡ lẻ căn giữa trong hộp cao chẵn rơi vào nửa pixel (`.icn` 15px trong hàng NavRail 36px → `(36 − 15) / 2 = 10.5`) nên nét vẽ không bao giờ trúng lưới pixel. Đo trên app đang chạy sau P7a: **25/28 icon cỡ lẻ** nằm trên nửa pixel.

- Cỡ lẻ map **lên** bậc chẵn gần nhất (icon không teo đi): 11→12, 13→14, 15→16, 17→18, 21→22. Cỡ chẵn ngoài thang (10, 18, 22, 26, 28, 40 — icon empty-state) hợp lệ, chỉ cần chẵn.
- `.icn` mang `stroke-width: 1.5`, **không** phải 1.7. `stroke-width` là **user unit** của viewBox `0 0 24 24`, nên bề rộng nét thật = `stroke-width × size/24`: ở `--icon-md` thì 1.5 ra đúng **1 device pixel**, 1.7 ra 1.13px, 2 ra 1.33px và nhìn nặng.
- Ba kênh khai cỡ icon đều bị guard R5 soi: rule CSS trên `.icn`/`svg`/class đã thấy gắn lên `<Icon>`, `style="width: …"` inline trên `<Icon>`/`<svg>`/component lucide, và `:size="…"` trên component lucide. Codemod: [`scripts/codemod-icon-scale.mjs`](../../apps/desktop/ui-next/scripts/codemod-icon-scale.mjs).
- **`<Icon :size="13" />` không có tác dụng** — [`Icon.vue`](../../apps/desktop/ui-next/components/Icon.vue) chỉ nhận prop `name`, `size` rơi xuống `$attrs` thành attribute `size` mà `<svg>` không hiểu. Muốn đổi cỡ thì dùng `style` hoặc một class.

Spacing (`padding` / `margin` / `gap`) **chưa có thang token** — đợt vừa rồi chỉ khử số lẻ, chưa định nhịp. Guard **R6** fail khi thấy px lẻ; codemod [`scripts/codemod-spacing.mjs`](../../apps/desktop/ui-next/scripts/codemod-spacing.mjs) làm tròn **xuống** số chẵn gần nhất (9→8, 7→6, 5→4, 3→2, 11→10, 13→12, 15→14), mỗi giá trị dịch tối đa 1px.

- Làm tròn **xuống** chứ không lên: chật hơn thì không bao giờ gây overflow, rộng hơn thì có.
- **`±1px` được giữ** (69 site): 1px là nudge quang học hoặc bù chiều dày hairline, không phải nhịp — cả 0 lẫn 2 đều sai.
- Rule chỉ đụng `padding*` / `margin*` / `gap`. **Không** đụng `width` / `height` / `top` / `left` / `inset` / `transform` — đó là **hình dạng**, số lẻ ở đó thường là cố ý.
- Chưa ép về lưới 4pt: 9→12 dịch 3px và làm wrap/overflow hàng loạt. Token hoá `--sp-*` là đợt sau, khi bộ giá trị còn lại đủ nhỏ để đặt tên.

**Hairline trên thanh cao cố định** dùng `box-shadow: inset 0 -1px 0 var(--border)`, **không** `border-bottom`. Với `box-sizing: border-box` thì border ăn mất 1px của **content box**, nên thanh cao 44px chỉ còn 43 và mọi con căn giữa rơi vào nửa pixel (`(43 − 28) / 2 = 7.5`). `box-shadow` không chiếm chỗ trong layout. Dùng `inset` chứ không outset: shadow outset bị **background của sibling kế tiếp** vẽ đè (thứ tự cây) và mất hẳn đường kẻ. Chỉ áp dụng cho **thanh có chiều cao cố định + căn giữa con theo trục dọc** — đừng migrate toàn bộ border của app.

**Hai marker opt-out**, ghi ngay trên dòng cần miễn:

- `/* design-token-ok: <lý do> */` — khi con số px **chính là hình dạng** (caret, swatch 9px, góc gần vuông làm đuôi bong bóng chat).
- `/* mono-ok: <lý do> */` — khi `var(--code)` là đúng. Tiêu chí: *người dùng có copy-paste nội dung này vào terminal/editor không?* Có → mono. Không → font hệ thống; cần căn số thẳng cột thì `font-variant-numeric: tabular-nums` (class `.tnum`), **không** dùng mono.

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

1. **Markup lặp → component con** (vd trong [`components/agent/`](../../apps/desktop/ui-next/components/agent/)).
2. **UI/logic lặp giữa nhiều trang → composable dùng chung** (vd [`useToasts`](../../apps/desktop/ui-next/composables/useToasts.ts) gom toast của agents + skills). Rule of Three: 2 copy = tín hiệu, 3 = bắt buộc.
3. **Toàn bộ state + computed + handler còn lại → page-controller composable** `useXxxManager()` (đặt trong [`composables/`](../../apps/desktop/ui-next/composables/)). Page còn lại đúng `<template>` + một destructure:

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

> **Lưu ý lịch sử:** [ADR 0009](../decisions/0009-ui-consolidation-refactor.md) (primitive in-house BaseModal/AppInput/…) → [ADR 0041](../decisions/0041-in-house-design-system-shadcn-style.md) → [ADR 0044](../decisions/0044-adopt-shadcn-vue-real.md) (shadcn-vue) áp dụng cho `apps/desktop/ui` legacy — **đã xoá**. Bản UI hiện tại `apps/desktop/ui-next` **KHÔNG theo shadcn** (không có `components/ui/`): nó **port CSS prototype nguyên văn** (`assets/css/prototype.css`, class `.side/.bento/.ovl/…`) và dùng bộ primitive dùng chung riêng.

Trước khi tự viết modal/select/menu/toast mới, đọc [`components/common/`](../../apps/desktop/ui-next/components/common/) + các composable-host dưới đây:

| Primitive (ui-next) | Loại | Dùng cho |
|---|---|---|
| Modal idiom `.ovl.on` + `<Teleport>` | Pattern CSS | Chrome modal (overlay + card). ESC-close, **KHÔNG** backdrop-dismiss; mỗi modal tự lo Esc (không có `useEscape` chung). |
| [`PreviewModal.vue`](../../apps/desktop/ui-next/components/common/PreviewModal.vue) + [`usePreview`](../../apps/desktop/ui-next/composables/usePreview.ts) | Component + composable | Xem file (md/HTML/PDF/ảnh/code). **MỌI** read-file đi qua đây, không viewer riêng. |
| [`ConfirmDialogHost.vue`](../../apps/desktop/ui-next/components/common/ConfirmDialogHost.vue) + [`useConfirm`](../../apps/desktop/ui-next/composables/useConfirm.ts) | Host + composable | Confirm / delete dialog. |
| [`ContextMenu.vue`](../../apps/desktop/ui-next/components/common/ContextMenu.vue) + [`useFileContextMenu`](../../apps/desktop/ui-next/composables/useFileContextMenu.ts) | Component + composable | Right-click / click-open menu (click-open cần `.stop`). |
| [`AppSelect.vue`](../../apps/desktop/ui-next/components/common/AppSelect.vue) | Component | Dropdown — **KHÔNG** native `<select>` (WKWebView bỏ padding). |
| [`TextPromptHost.vue`](../../apps/desktop/ui-next/components/common/TextPromptHost.vue) + [`useTextPrompt`](../../apps/desktop/ui-next/composables/useTextPrompt.ts) | Host + composable | Input 1 dòng (rename, new file…). |
| [`CommandPalette.vue`](../../apps/desktop/ui-next/components/common/CommandPalette.vue) + [`useCommandPalette`](../../apps/desktop/ui-next/composables/useCommandPalette.ts) | Component + composable | ⌘K palette. |
| [`usePromptCreator`](../../apps/desktop/ui-next/composables/usePromptCreator.ts) + [`LibraryCreatorPanel.vue`](../../apps/desktop/ui-next/components/library/LibraryCreatorPanel.vue) | Composable + component | Tạo entity flow "generate → preview → save". |
| [`useToasts`](../../apps/desktop/ui-next/composables/useToasts.ts) + [`ActionToastHost.vue`](../../apps/desktop/ui-next/components/common/ActionToastHost.vue) | Composable + host | Toast + action toast. |
| [`LibraryView.vue`](../../apps/desktop/ui-next/components/library/LibraryView.vue) | Component | Master-detail (list trái + detail phải) dùng chung cho các page CRUD entity. |
| [`Collapse.vue`](../../apps/desktop/ui-next/components/common/Collapse.vue) · [`MonacoEditor.vue`](../../apps/desktop/ui-next/components/common/MonacoEditor.vue) · [`MermaidView.vue`](../../apps/desktop/ui-next/components/common/MermaidView.vue) · [`MinimizeDock.vue`](../../apps/desktop/ui-next/components/common/MinimizeDock.vue) | Component | Collapse grid-rows, editor Monaco, mermaid, dock thu nhỏ. |

**Theme:** ui-next **không có** `utils/themes.ts` (object token). Màu theme là **CSS var** trên `:root` (dark) / `body.light` (light) — port từ prototype; [`useTheme()`](../../apps/desktop/ui-next/composables/useTheme.ts) chỉ toggle class `light` + ghi đè `--accent*` inline. Không hardcode hex; màu theme đi qua var CSS / inline `:style` từ `useTheme`.

> **Quy tắc:** thấy mình copy chrome `.ovl.on` hoặc dựng read-file viewer lần thứ 2 → dừng, dùng primitive `components/common/` tương ứng. Pattern lặp 3+ lần chưa có primitive → mở thảo luận extract, không tự viết bản thứ tư.

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

Frontend dùng **ESLint 9 (flat config)** cho rule + **Prettier** cho format. Base do module chính thức [`@nuxt/eslint`](https://eslint.nuxt.com/) cấp (Nuxt-aware auto-import/import handling).

> **Lịch sử:** từng dùng `eslint-config-airbnb-base`/`airbnb-typescript` trên `.eslintrc.cjs`. Airbnb không hỗ trợ flat config nên khi nâng ESLint 8 (EOL) → 9 đã chuyển sang `@nuxt/eslint`.

**Stack:**
- [`@nuxt/eslint`](https://eslint.nuxt.com/) — base flat config (gói sẵn `typescript-eslint` + `eslint-plugin-vue` + Nuxt rule/auto-import). Cấu hình `stylistic: false` (Prettier lo format).
- [Prettier](https://prettier.io/) + `eslint-plugin-prettier/recommended` (append cuối) — format + tích hợp vào ESLint.

**Lệnh:**

```bash
pnpm lint          # check (flat config, không cần --ext)
pnpm lint:fix      # auto-fix lint + Prettier + gỡ eslint-disable thừa
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

**Rule dự án (thêm/override trên `@nuxt/eslint` base):**

| Rule | Trạng thái | Lý do |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | `error` | Áp luật chung của [general.md](./general.md) |
| `@typescript-eslint/consistent-type-imports` | `error` (`prefer: type-imports`) | Tách `import type` rõ ràng |
| `@typescript-eslint/no-unused-vars` | `error` (ignore `^_`) | Cho phép prefix `_` |
| `vue/component-name-in-template-casing` | `PascalCase` | Component dùng PascalCase trong template |
| `vue/block-order` | template→script→style | (đổi tên từ `vue/component-tags-order`) |
| `vue/html-self-closing` | `always` | Tự đóng thẻ void/normal/component |
| `vue/multi-word-component-names` | `off` | Cho phép `app.vue`, `index.vue` |
| `vue/no-multiple-template-root` | `off` | Vue 3 cho phép fragment nhiều root |
| `@typescript-eslint/no-dynamic-delete` | `off` | `delete record[key]` cho cache `Record<string,T>` per-project |
| `@typescript-eslint/unified-signatures` | `off` | Giữ 1 call-signature / event trong `defineEmits` (idiomatic Vue) |
| `no-console` | `warn`, allow `warn`/`error` | Chỉ chặn `console.log` |

> Format (semi, quote, printWidth…) **do Prettier lo** — không khai rule style trong ESLint.

**File config nằm ở:**
- [`apps/desktop/ui-next/eslint.config.mjs`](../../apps/desktop/ui-next/eslint.config.mjs) — flat config (extend `withNuxt` + rule dự án + Prettier)
- [`apps/desktop/ui-next/nuxt.config.ts`](../../apps/desktop/ui-next/nuxt.config.ts) — bật module `@nuxt/eslint` (`stylistic: false`, `checker: false`)
- [`apps/desktop/ui-next/.prettierrc`](../../apps/desktop/ui-next/.prettierrc)

> Khi muốn thêm/đổi rule: sửa `eslint.config.mjs` + cập nhật bảng "Rule dự án" ở trên + nêu lý do trong PR.

**Typed-lint:** rule cần parser TypeScript được scope vào `**/*.ts`, `**/*.tsx`, `**/*.vue` trong `eslint.config.mjs` (file `.mjs`/`.js` như `eslint.config.mjs` dùng parser mặc định, không chạy rule typescript-eslint). `ignores` (flat config thay cho `.eslintignore` đã bỏ ở ESLint 9): `public/**`, `**/*.json`, `dist`, `.output`.

## Checklist PR (frontend)

- [ ] `pnpm lint` pass (0 error)
- [ ] `pnpm format:check` pass
- [ ] `pnpm typecheck` pass
- [ ] Không có `any`, `@ts-ignore` không lý do, `console.log` còn sót
- [ ] Component mới có type cho props/emits đầy đủ
- [ ] Cập nhật [docs/architecture/system-overview.md](../architecture/system-overview.md) khi thêm route/component đáng kể
- [ ] Cập nhật [apps/desktop/ui-next/types/index.ts](../../apps/desktop/ui-next/types/index.ts) khi đổi entity shape
- [ ] Theme color → đi qua `useTheme()`, không hardcode
