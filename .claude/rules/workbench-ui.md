# Workbench UI — shadcn-vue + Tailwind token

Áp dụng cho **mọi file dưới `apps/desktop/ui-next/components/workbench/`** (và code workbench mới). Mục tiêu: workbench dùng **component shadcn-vue thật** (`components/ui/*` — đọc qua `assets/css/shadcn-bridge.css`) thay cho cả skin `.wb*`/`.sbi*`/`.wsc*` lẫn `<input>`/`<button>` thô có Tailwind. "Đã Tailwind hoá" ≠ "đã shadcn" — rule này bắt dùng **component**.

## Nguyên tắc

- **Primitive interactive → component shadcn-vue** trong `components/ui/` (auto-import, KHÔNG `<input>`/`<button>` thô + class): `Input`, `Textarea`, `Button`, `Switch`, `Tabs`+`TabsList`+`TabsTrigger`+`TabsContent`, `ScrollArea`, `Separator`, `DropdownMenu`(+`Trigger`/`Content`/`Item`), `ContextMenu`, `Dialog`, `Tooltip`(+`Trigger`/`Content`), `Badge`, `Checkbox`, `Select`, `Popover`. Chọn variant + size khớp chỗ dùng (`Button variant="ghost" size="iconMd"` cho toolbar, `Input` mặc định cho ô text). Nếu primitive thiếu (menu neo-above `useWorkbenchMenu`, resizable, strip tab doc có close/pin custom), wrapper app sẵn có được phép — KHÔNG tự viết lại từ `<button>` thô.
- **`<input>`/`<button>`/`<select>` thô CẤM** trong `components/workbench/` khi có component tương đương. Raw element chỉ còn: `<textarea>` không có wrapper, grip kéo resize (`role="separator"`), row list item (không phải control), icon `<span>` tuỳ chỉnh.
- **Ngoại lệ có chủ đích, PHẢI ghi comment**: `WbChip` (status-bar chip 20px — `Button` quá cao), DocTabs (tab có close/pin/wheel-scroll custom — `Tabs` không cover), grip drag-resize (`ResizablePanelGroup` không giữ được toggle sideClosed/dockHidden), `<input>` cần `setSelectionRange` ngay khi mount (`ExplorerInlineInput` — dùng `Input` nếu đủ, không thì comment).
- **`ref` lấy element trên component shadcn** (`Button`, `Input`… là `Primitive` của reka): template ref trả **instance**, không phải element — đọc `?.$el` (`useTemplateRef<{ $el: HTMLElement }>`). `data-*`/`aria-*`/`title`/`@click` vẫn forward qua `useForwardAttrs` xuống root `<button>`/`<input>` nên close-outside, `closest('[data-…]')`, tooltip không đổi.
- **Layout/spacing/color → Tailwind class.** Màu theme dùng CSS var token (`var(--bgPanel)`, `var(--text)`, `var(--border)`, `var(--accent)`, radius `--r-*`, font `--fs-*`, line-height `--lh-*`, icon `--icon-*`) — khớp `docs/coding/nuxt-frontend.md`. Cấm hex hardcode.
- **Màu qua Tailwind `var(--token)`** cho layout chrome (`.wb` shell, panel, hairline, status bar) + **component shadcn tự mang màu** qua bridge (`--primary`/`--input`/`--ring`/`--muted-foreground`…). Không trộn hai hệ trong một control.
- **Cấm class skin `.wb-*` / `.wbs-*` / `.sbi-*` / `.wsc-*` / `.wbcm-*` mới** — đó là layer tạm của prototype port, phải xoá khi chạm file. `<style scoped>` chỉ còn khi Tailwind không đủ (grid phức tạp, virtual scroller, mask/fill) và phải ghi comment lý do.
- **`<style scoped>` chỉ được tồn tại để**: keyframes duy nhất, selector phức tạp Tailwind không diễn đạt, hoặc override `:deep` của lib con — mỗi block phải có comment gốc.
- Không tạo lớp "skin" riêng cho workbench: một thành phần UI trông giống nhau ở mọi nơi (status bar workbench vs status bar app phải cùng pattern).

## Di cư hiện có

- Khi sửa bất kỳ file `components/workbench/` nào: **đổi raw `<input>`/`<button>` thành component** + dỡ skin `.w*‑` còn sót trong cùng lượt. Không để file có "Tailwind-hoá-xong" nhưng vẫn control thô.
- Nếu file > ~250 dòng sau khi dỡ, tách subcomponent + đẩy logic vào composable (page-controller rule ở [nuxt-vue.md](./nuxt-vue.md)).

Chi tiết convention chung: [docs/coding/nuxt-frontend.md](../../docs/coding/nuxt-frontend.md).
