<template>
  <!-- Context menu neo TRÊN chip status-bar (vị trí do useWorkbenchMenu tính — không
       dùng DropdownMenu của reka vì neo theo toạ độ, mở phía trên). Một mục `header`
       hiển thị nhãn mục nhỏ; `separator` → gạch. `filterPlaceholder` ⇒ ô lọc dính ở
       đầu menu (danh sách dài: đổi project). Class item bám DropdownMenuItem của shadcn.
       Teleport sang body. Hai điều Tailwind phải khai tường minh:
       - `[-webkit-app-region:no-drag]`: app-region ở tầng WINDOW (`.top` là vùng drag),
         fixed overlay bên trên không tự trừ mình ra — thiếu no-drag thì phần
         menu/backdrop lọt vào strip đầu cửa sổ bị OS nuốt click.
       - z-index: menu (140) phải trên backdrop của chính nó (139), nếu không lăn chuột
         rơi vào backdrop nên menu dài không cuộn được. -->
  <Teleport to="body">
    <template v-if="menu">
      <div
        class="wbm-backdrop fixed inset-0 z-139 [-webkit-app-region:no-drag]"
        data-nodrag
        @mousedown.prevent="closeMenu"
      />
      <!-- `.wbm` nằm trong OVERLAYS (useEmbeddedBrowser.ts) để trình duyệt nhúng nhường chỗ. -->
      <div
        class="wbm fixed z-140 max-h-[calc(100vh-24px)] min-w-50 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md [-webkit-app-region:no-drag]"
        :style="menuStyle"
        role="menu"
        data-nodrag
      >
        <div
          v-if="menu.filterPlaceholder"
          class="sticky -top-1 z-1 -mx-1 -mt-1 mb-1 flex items-center gap-1.5 border-b bg-popover px-2.5 py-0.5 text-faint"
        >
          <Icon class="size-3" name="search" />
          <Input
            ref="filterEl"
            v-model="query"
            unstyled
            type="text"
            class="h-ctrl-xs min-w-0 flex-1 text-sm text-foreground"
            :placeholder="menu.filterPlaceholder"
            @keydown.enter.prevent="pickFirst"
          />
        </div>
        <div v-if="filterActive && !visibleItems.length" class="px-2.5 py-1.5 text-sm text-faint">
          Không có kết quả
        </div>
        <template v-for="(it, i) in visibleItems" :key="i">
          <Separator v-if="it.separator" class="-mx-1 my-1 w-auto" />
          <div
            v-else-if="it.header"
            class="px-2.5 text-xs font-semibold text-faint"
            :class="menu.compact ? 'pb-0.5 pt-1.5' : 'pb-1.5 pt-1'"
          >
            {{ it.header }}
          </div>
          <div
            v-else
            class="flex cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            :class="[
              menu.compact ? 'py-1' : 'py-1.5',
              it.danger ? 'text-destructive' : it.active ? 'text-primary' : 'text-muted-foreground',
              { 'pointer-events-none opacity-55': it.disabled },
            ]"
            role="menuitem"
            :title="it.hint ? `${it.label} — ${it.hint}` : it.label"
            @click="it.id && pick(it.id)"
          >
            <Icon v-if="it.icon" :name="it.icon" class="size-3.5" />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ it.label }}
            </span>
            <!-- Hint (đường dẫn) co lại trước nhãn khi menu chạm bề rộng tối đa. -->
            <span
              v-if="it.hint"
              class="tnum ml-auto min-w-0 max-w-[55%] shrink truncate text-xs text-faint"
            >
              {{ it.hint }}
            </span>
            <Icon v-if="it.active" name="check" class="ml-auto size-3.5 text-primary" />
          </div>
        </template>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useWorkbenchMenu, type WbMenuItem } from '~/composables/useWorkbenchMenu'

const { menu, menuStyle, pick, closeMenu } = useWorkbenchMenu()
// Esc đóng — cùng convention với mọi overlay của app.
useEscToClose(
  () => !!menu.value,
  () => closeMenu(),
)

const query = ref('')
// Instance của `Input` (expose focus()) — không phải element thô.
const filterEl = ref<{ focus: () => void } | null>(null)
// Mở menu mới ⇒ xoá chữ lọc cũ và đặt con trỏ vào ô lọc (gõ ngay được).
watch(
  () => menu.value,
  (m) => {
    query.value = ''
    if (m?.filterPlaceholder) void nextTick(() => filterEl.value?.focus())
  },
)

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
const filterActive = computed(() => !!menu.value?.filterPlaceholder && !!query.value.trim())

// Đang lọc thì bỏ header/separator (không còn nhóm nào để phân), giữ mục có id khớp
// nhãn hoặc hint (đường dẫn project).
const visibleItems = computed<WbMenuItem[]>(() => {
  const items = menu.value?.items ?? []
  if (!filterActive.value) return items
  const q = norm(query.value.trim())
  return items.filter(
    (it) =>
      !it.separator &&
      !it.header &&
      !!it.id &&
      (norm(it.label ?? '').includes(q) || norm(it.hint ?? '').includes(q)),
  )
})

function pickFirst(): void {
  const first = visibleItems.value.find((it) => it.id && !it.disabled && !it.header)
  if (first?.id) pick(first.id)
}
</script>
