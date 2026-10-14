<template>
  <!-- Context menu neo TRÊN chip status-bar (`.smenu` global skin). Một mục
       `header` hiển thị nhãn mục nhỏ (`.ph` của proto); `separator` → gạch.
       `filterPlaceholder` ⇒ ô lọc dính ở đầu menu (danh sách dài: đổi project). -->
  <Teleport to="body">
    <template v-if="menu">
      <div class="wbm-backdrop fixed inset-0" data-nodrag @mousedown.prevent="closeMenu" />
      <div class="smenu wbm fixed min-w-[200px]" :style="menuStyle" role="menu" data-nodrag>
        <div v-if="menu.filterPlaceholder" class="wbm-filter">
          <Icon name="search" style="width: var(--icon-xs); height: var(--icon-xs)" />
          <input
            ref="filterEl"
            v-model="query"
            type="text"
            class="wbm-filter-in"
            :placeholder="menu.filterPlaceholder"
            @keydown.enter.prevent="pickFirst"
          />
        </div>
        <div v-if="filterActive && !visibleItems.length" class="wbm-empty">Không có kết quả</div>
        <template v-for="(it, i) in visibleItems" :key="i">
          <div v-if="it.separator" class="ctxsep" />
          <div
            v-else-if="it.header"
            class="px-2.5 pb-1.5 pt-1 text-[var(--fs-xs)] font-[650] leading-[var(--lh-xs)] text-[var(--textFaint)]"
          >
            {{ it.header }}
          </div>
          <div
            v-else
            class="mi"
            :class="{ dmi: it.danger, mdisabled: it.disabled, cur: it.active }"
            role="menuitem"
            :title="it.hint ? `${it.label} — ${it.hint}` : it.label"
            @click="it.id && pick(it.id)"
          >
            <Icon
              v-if="it.icon"
              :name="it.icon"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ it.label }}
            </span>
            <span v-if="it.hint" class="mhint wbm-hint">{{ it.hint }}</span>
            <Icon
              v-if="it.active"
              name="check"
              class="ck"
              style="width: var(--icon-sm); height: var(--icon-sm)"
            />
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
const filterEl = ref<HTMLInputElement | null>(null)
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

<style scoped>
/* Teleport sang body ⇒ scoped vẫn áp được (Vue giữ data-attribute trên node
   đã teleport). `.smenu` global cho skin; bên dưới là những thứ Tailwind không
   diễn đạt được hoặc bị global đè:
   - `-webkit-app-region`: app-region ở tầng WINDOW (`.top` là vùng drag), và
     fixed overlay bên trên không tự trừ mình ra — thiếu no-drag thì phần
     menu/backdrop lọt vào strip 52px đầu cửa sổ bị OS nuốt click (cùng trap
     ở app-shell.css:2418).
   - z-index: `.smenu { z-index: 130 }` (prototype.css) ĐÈ class Tailwind
     `z-[140]` cũ ⇒ menu nằm DƯỚI backdrop của chính nó (139): lăn chuột rơi vào
     backdrop nên menu dài không cuộn được (đo: wheel ⇒ scrollTop vẫn 0). Khai ở
     đây với selector đủ mạnh để luôn thắng. */
[data-nodrag] {
  -webkit-app-region: no-drag;
}
.wbm-backdrop {
  z-index: 139;
}
.smenu.wbm {
  z-index: 140;
  overflow-y: auto;
}
.wbm-filter {
  position: sticky;
  top: -5px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -5px -5px 4px;
  padding: 2px 10px;
  background: var(--bgEl);
  box-shadow: inset 0 -1px 0 var(--border);
  color: var(--textFaint);
}
.wbm-filter-in {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.wbm-empty {
  padding: 6px 10px;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* Hint (đường dẫn) co lại trước nhãn khi menu chạm bề rộng tối đa. */
.wbm-hint {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Disabled nhạt hơn mặc định `.smenu .mi.mdisabled` global (0.45 → 0.55);
   selector giữ specificity cao hơn global để đè được. */
.smenu .mi.mdisabled {
  opacity: 0.55;
  cursor: default;
}
</style>
