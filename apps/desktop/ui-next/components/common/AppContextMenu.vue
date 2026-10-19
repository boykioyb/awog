<template>
  <!-- Ruột là shadcn DropdownMenu (reka) điều khiển bằng `open` + neo vào một phần tử
       ảo tại `position` (điểm click) — reka lo lật/kẹp trong viewport, submenu, bàn
       phím, đóng khi bấm ngoài / Esc. `modal=false`: chuột phải sang hàng khác vẫn
       bấm được ngay (menu modal sẽ khoá pointer-events của trang). -->
  <DropdownMenu :open="open" :modal="false" @update:open="onOpenChange">
    <!-- hook-ok: OVERLAY_HOOK (`.smenu`) nằm trong OVERLAYS của useEmbeddedBrowser.ts -->
    <DropdownMenuContent
      :class="OVERLAY_HOOK"
      class="relative max-h-(--reka-dropdown-menu-content-available-height) min-w-48 overflow-y-auto"
      :reference="anchor"
      side="bottom"
      align="start"
      :side-offset="0"
      :collision-padding="8"
      @close-auto-focus="onCloseAutoFocus"
      @click.stop
    >
      <template v-for="(it, i) in items" :key="i">
        <DropdownMenuSeparator v-if="it.separator" />

        <!-- Hàng có nút nhỏ (vd − 100% + của thu phóng): hàng tự nó không chọn được,
             bấm nút phát `select` nhưng GIỮ menu mở để bấm tiếp. -->
        <div
          v-else-if="it.buttons"
          class="flex min-h-ctrl-xs items-center gap-2 rounded-md px-2 text-sm text-popover-foreground"
        >
          <span
            v-if="it.dot"
            class="size-2 shrink-0 rounded-full"
            :style="{ background: it.dot }"
          />
          <Icon v-if="it.icon" :name="it.icon" class="size-4 text-muted-foreground" />
          <span class="flex-1">{{ it.label }}</span>
          <span class="ml-auto inline-flex shrink-0 items-center gap-0.5">
            <Button
              v-for="b in it.buttons"
              :key="b.id"
              variant="outline"
              size="xs"
              class="h-6 min-w-6 px-1.5 font-normal shadow-none [&_svg]:size-3"
              :title="b.title"
              :aria-label="b.title"
              @click.stop="onButton(b.id)"
            >
              <Icon v-if="b.icon" :name="b.icon" />
              <span v-if="b.text" class="tnum text-xs">{{ b.text }}</span>
            </Button>
          </span>
        </div>

        <!-- Một tầng submenu qua `children`. -->
        <DropdownMenuSub v-else-if="it.children">
          <DropdownMenuSubTrigger
            :disabled="it.disabled"
            class="min-h-ctrl-xs py-0"
            :class="[it.danger && DANGER_ROW, it.active && 'text-primary']"
          >
            <span
              v-if="it.dot"
              class="size-2 shrink-0 rounded-full"
              :style="{ background: it.dot }"
            />
            <Icon v-if="it.icon" :name="it.icon" />
            <span class="flex-1">{{ it.label }}</span>
            <span v-if="it.hint" class="ml-auto pl-4 text-xs text-muted-foreground">
              {{ it.hint }}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            :class="OVERLAY_HOOK"
            class="relative max-h-(--reka-dropdown-menu-content-available-height) min-w-48 overflow-y-auto"
            :collision-padding="8"
            @click.stop
          >
            <template v-for="(c, j) in it.children" :key="j">
              <DropdownMenuSeparator v-if="c.separator" />
              <DropdownMenuItem
                v-else
                :disabled="c.disabled"
                class="min-h-ctrl-xs py-0"
                :class="[c.danger && DANGER_ROW, c.active && 'text-primary']"
                @select="onPick(c)"
              >
                <span
                  v-if="c.dot"
                  class="size-2 shrink-0 rounded-full"
                  :style="{ background: c.dot }"
                />
                <Icon v-if="c.icon" :name="c.icon" />
                <span class="flex-1">{{ c.label }}</span>
                <span v-if="c.hint" class="ml-auto pl-4 text-xs text-muted-foreground">
                  {{ c.hint }}
                </span>
                <Check v-if="c.active" class="text-primary!" />
              </DropdownMenuItem>
            </template>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          v-else
          :disabled="it.disabled"
          class="min-h-ctrl-xs py-0"
          :class="[it.danger && DANGER_ROW, it.active && 'text-primary']"
          @select="onPick(it)"
        >
          <span
            v-if="it.dot"
            class="size-2 shrink-0 rounded-full"
            :style="{ background: it.dot }"
          />
          <Icon v-if="it.icon" :name="it.icon" />
          <span class="flex-1">{{ it.label }}</span>
          <span v-if="it.hint" class="ml-auto pl-4 text-xs text-muted-foreground">
            {{ it.hint }}
          </span>
          <Check v-if="it.active" class="text-primary!" />
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup lang="ts">
// Generic context menu — renders a MenuItem[] (separators, danger rows, disabled
// rows, trailing hint/shortcut, one level of submenu via `children`, inline button
// rows). Emits `select` with the chosen item's id, `close` khi menu đóng (chọn xong,
// bấm ngoài, Esc). Shared across the git, file, and PR-file surfaces (any caller
// builds a MenuItem list + handles select). API giữ nguyên từ bản tự viết.
import { Check } from 'lucide-vue-next'
import { computed, watch } from 'vue'
import type { MenuItem } from '~/composables/useContextMenu'

const props = defineProps<{
  open: boolean
  position: { x: number; y: number }
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', id: string): void
}>()

// Hook cho JS, không phải skin: OVERLAYS (useEmbeddedBrowser.ts) dò `.smenu` để
// trình duyệt nhúng nhường chỗ khi menu mở. Skin cũ của `.smenu` (legacy layer) bị
// utility trên content đè hết (relative, z, nền, viền, padding, min-w, max-h).
const OVERLAY_HOOK = 'smenu'

// Hàng nguy hiểm: chữ + icon đỏ, wash đỏ nhạt khi trỏ.
const DANGER_ROW =
  'text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:text-destructive'

// Phần tử ảo kích thước 0 tại điểm click — reka/floating-ui neo menu vào đây.
const anchor = computed(() => {
  const { x, y } = props.position
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) }
})

function onOpenChange(next: boolean) {
  if (!next) emit('close')
}

// reka tự đóng menu sau `select` của item (→ onOpenChange → `close`), nên ở đây chỉ
// phát `select`. Hàng disabled thì reka không phát `select`.
function onPick(it: MenuItem) {
  if (it.id) emit('select', it.id)
}

// Nút trên hàng: chọn nhưng KHÔNG đóng menu — thu phóng thường bấm vài lần liền.
const onButton = (id: string) => emit('select', id)

// Bản cũ không lấy focus nên editor / terminal giữ caret qua một lần mở menu. reka
// đưa focus vào menu (để có bàn phím); lúc đóng trả focus về chỗ cũ — trừ khi lệnh
// vừa chọn đã tự focus nơi khác (vd ô đổi tên inline).
let prevFocus: HTMLElement | null = null
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) prevFocus = document.activeElement as HTMLElement | null
  },
  { immediate: true },
)
function onCloseAutoFocus(e: Event) {
  e.preventDefault()
  const el = prevFocus
  prevFocus = null
  const now = document.activeElement
  if (el?.isConnected && (!now || now === document.body)) el.focus({ preventScroll: true })
}
</script>
