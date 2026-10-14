# Workbench → shadcn-vue + Tailwind migration

Chuẩn hoá `apps/desktop/ui-next/components/workbench/**` khỏi skin `.wb*`/`.sbi*`/`.wsc*` tự viết (port từ prototype) sang **component shadcn-vue thật** trong `components/ui/` (đọc màu qua `assets/css/shadcn-bridge.css`) + Tailwind cho layout. Rule: [.claude/rules/workbench-ui.md](../../.claude/rules/workbench-ui.md). ⚠ "Đã Tailwind hoá" ≠ "đã shadcn" — pass trước chỉ đổi cách viết CSS, pass này đổi **control** (`<input>`/`<button>` thô → `Input`/`Button`/`Tabs`/`ScrollArea`/`Textarea`).

## Luật cứng

1. **Không class `.wb-*` / `.wbs-*` / `.sbi-*` / `.wsc-*` / `.wbcm-*` / `.wbmi-*` mới.** Class cũ trong file đang sửa phải bị dỡ hết trong lượt đó (không để sót vì "không dùng tới").
2. **Layout/spacing/màu → Tailwind class.** Màu chỉ qua `var(--token)` (`--bgPanel`, `--text`, `--textDim`, `--border`, `--accent`, `--bgHover`, `--bgActive`, `--success`, `--warning`, `--error`, radius `--r-*`, font `--fs-*`, line-height `--lh-*`, icon `--icon-*`). Cấm hex.
3. **Primitive interactive → shadcn-vue / wrapper app sẵn có** — không tự viết lại:

   | Nhu cầu | Dùng |
   |---|---|
   | Status-bar chip | `WbChip` (`components/workbench/WbChip.vue`, props `title`/`active`/`disabled`) |
   | Menu anchor-above (status bar / header) | `useWorkbenchMenu()` + `WorkbenchContextMenu` — giữ nguyên |
   | Context menu explorer (`.smenu`) | `WbExplorerCtxMenu` + `exp.openWbMenu` — giữ nguyên (skin `.smenu` là global app) |
   | Panel resize | `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` (`components/ui/resizable`) |
   | Scroll | `ScrollArea` (`components/ui/scroll-area`) thay `overflow:auto` custom |
   | Dialog/Modal | `Dialog` (`components/ui/dialog`) |
   | Button | `Button` (`components/ui/button`) cho action chính; chip nhỏ dùng `WbChip` |
   | Switch/Tab/Tooltip | `Switch`/`Tabs`/`Tooltip` |
   | Icon | `<Icon name>` sprite trước, lucide khi icon không có sprite |

4. **`<style scoped>` chỉ còn khi**: selector phức tạp Tailwind không diễn đạt (`.ctxbar` fill theo %), `:deep()` cho lib con, keyframes duy nhất — mỗi block phải ghi comment lý do ngắn.
5. **Không đổi hành vi**: prop/emit/composable/store giữ nguyên tên + ngữ nghĩa. Nếu cần đổi hành vi, tách task riêng.

## Control map (pass 2 — thật component)

| Thay | Bằng | Ghi chú |
|---|---|---|
| `<input>` filter/search/new-name | `<Input>` (`components/ui/input`) | `v-model`, `class` merge. Cần `ref`/focus/setSelectionRange → `Input` đã forward `ref` (template ref `el`). Toolbar hẹp thì thêm `class="h-6"`/`h-7` override |
| `<textarea>` commit box | `<Textarea>` | `v-model`, giữ `min-h`/rows/`onCommitKey` (keydown qua `@keydown` trên component — Textarea inheritAttrs rơi về `<textarea>`) |
| Toolbar icon `<button>` (pull/push/refresh/collapse/settings…) | `<Button variant="ghost" :size="iconSm|iconMd">` | size `iconSm` 28px / `iconMd` 32px từ `--ctrl-h-*` ladder |
| Text `<button>` trong toolbar/empty-state/dialog | `<Button variant="default|secondary|danger|outline">` | `danger` cho destructive (màu đỏ nhẹ), `default` cho primary |
| DockBar tab buttons | `<Tabs>`+`TabsList`+`TabsTrigger` | `:model-value="wb.dockView"` + `@update:model-value`; style tab cao ~22-24px bằng class merge nếu mặc định quá lớn |
| Panel cuộn (`overflow-y-auto`) | `<ScrollArea>` khi viewport là phần tử trực tiếp | Nếu cuộn nằm trong component con (`Workspace*`) thì GIỮ overflow đó — không kéo ra |
| Toggle on/off | `<Switch>` | Với chip "đang chạy" kiểu AWS/K8s ở TopRow: giữ `Button` có `aria-pressed` nếu Switch làm rối layout (ghi comment) |
| `ScmIconBtn` (16/18/20px, hover-action trong row) | giữ | `Button iconSm` 28px không vừa cell — ghi comment ngoại lệ (như WbChip) |
| WbChip, DocTabs, grip resize, `useWorkbenchMenu`/`usePopoverAnchor`, `<input>` inline-create cần `setSelectionRange` ngay khi mount | giữ | đã liệt kê là ngoại lệ trong rule |

6. File > ~250 dòng sau khi dỡ → đẩy logic vào composable `useXxxManager()` hoặc tách subcomponent (rule [nuxt-vue.md](../../.claude/rules/nuxt-vue.md)).

## Token map (proto → app)

| Proto/alias | Canonical |
|---|---|
| `--l1` (nền ngoài) | `--bgPanel` |
| `--l3` (panel) | `--bgPanel` |
| `--l4` (hover) | `--bgHover` |
| `--t1` | `--text` |
| `--t2` | `--textDim` |
| `--t3` | `--textMuted` |
| `--acc` | `--accent` |
| `--hair` | `--border` |
| `.sbi` chip | `WbChip` |
| `.div` divider status bar | `<span class="h-3 w-px flex-none" style="background: var(--border)">` |
| `.wb-grow` | `<span class="flex-1">` |

Sau khi mọi file không còn `--l*`/`--t*`/`--acc`/`--hair`, xoá block alias trong `pages/workbench.vue`.

## Verify (mỗi file xong)

```bash
cd apps/desktop/ui-next
npx eslint <files>
npx prettier --check <files>
```

Cuối phase: `npx vue-tsc --noEmit` toàn repo + mở `/workbench` xác nhận layout không vỡ (explorer/dock/tab/status bar render đúng).
