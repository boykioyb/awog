<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div
        ref="menuRef"
        class="absolute min-w-[180px] rounded-md py-1 overflow-visible"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 12px 32px ${t.shadow}`,
        }"
        @click.stop
      >
        <template v-for="(item, i) in items" :key="i">
          <div
            v-if="item.separator"
            class="my-1 mx-2"
            :style="{ borderTop: `1px solid ${t.border}` }"
          />
          <button
            v-else
            :ref="(el: unknown) => setRowRef(i, el)"
            class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition"
            :style="itemStyle(item, hoverIndex === i || openSubmenuIndex === i)"
            :disabled="item.disabled"
            :title="item.tooltip ?? undefined"
            @click="onPick(item, i)"
            @mouseenter="onRowEnter(i, item)"
            @mouseleave="onRowLeave"
          >
            <component :is="item.icon" v-if="item.icon" :size="12" class="flex-shrink-0" />
            <span class="flex-1 truncate">{{ item.label }}</span>
            <span
              v-if="item.shortcut && !hasChildren(item)"
              class="text-[0.71em]"
              :style="{ color: t.textFaint }"
            >
              {{ item.shortcut }}
            </span>
            <ChevronRight
              v-if="hasChildren(item)"
              :size="11"
              class="flex-shrink-0"
              :style="{ color: t.textDim }"
            />
          </button>
        </template>

        <!-- Submenu: positioned relative to the parent row. Single level only —
             nested submenus are not needed for the Git context menu. -->
        <div
          v-if="openSubmenu"
          class="absolute min-w-[200px] rounded-md py-1 overflow-visible"
          :style="{
            top: `${openSubmenu.top}px`,
            left: `${openSubmenu.left}px`,
            background: t.bgPanel,
            border: `1px solid ${t.borderStrong}`,
            boxShadow: `0 12px 32px ${t.shadow}`,
          }"
          @mouseenter="onSubmenuEnter"
          @mouseleave="onRowLeave"
        >
          <template v-for="(child, ci) in openSubmenu.items" :key="`sub-${ci}`">
            <div
              v-if="child.separator"
              class="my-1 mx-2"
              :style="{ borderTop: `1px solid ${t.border}` }"
            />
            <button
              v-else
              class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition"
              :style="itemStyle(child, subHoverIndex === ci)"
              :disabled="child.disabled"
              :title="child.tooltip ?? undefined"
              @click="onPick(child, -1)"
              @mouseenter="subHoverIndex = ci"
              @mouseleave="subHoverIndex = -1"
            >
              <component :is="child.icon" v-if="child.icon" :size="12" class="flex-shrink-0" />
              <span class="flex-1 truncate">{{ child.label }}</span>
              <span v-if="child.shortcut" class="text-[0.71em]" :style="{ color: t.textFaint }">
                {{ child.shortcut }}
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

export interface ContextMenuItem {
  label?: string
  icon?: unknown
  danger?: boolean
  disabled?: boolean
  // Optional keyboard shortcut hint (e.g. "⌘S") shown right-aligned. Display
  // only — the menu does NOT register the binding.
  shortcut?: string
  // Optional tooltip — surfaced via the native title attribute. Useful for
  // explaining disabled items (e.g. "Coming v2").
  tooltip?: string
  // When true, render a horizontal divider instead of a button. Other fields
  // are ignored.
  separator?: boolean
  // Nested submenu items. When present, the row renders a ChevronRight and
  // hovering opens a single-level submenu to the right. Only one level deep
  // is supported — children of children are ignored.
  children?: ContextMenuItem[]
  action?: () => void
}

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const hoverIndex = ref(-1)
const openSubmenuIndex = ref<number>(-1)
const subHoverIndex = ref(-1)

interface SubmenuState {
  items: ContextMenuItem[]
  top: number
  left: number
}
const openSubmenu = ref<SubmenuState | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const rowRefs = new Map<number, HTMLElement>()
const setRowRef = (i: number, el: unknown) => {
  if (el instanceof HTMLElement) rowRefs.set(i, el)
  else rowRefs.delete(i)
}

const HOVER_CLOSE_DELAY = 200
let closeTimer: ReturnType<typeof setTimeout> | null = null

const MENU_WIDTH = 200
const MENU_PAD = 8

const hasChildren = (item: ContextMenuItem): boolean =>
  Array.isArray(item.children) && item.children.length > 0

const position = computed(() => {
  if (!import.meta.client) return { top: props.y, left: props.x }
  const top = Math.min(props.y, window.innerHeight - 28 * (props.items.length + 1) - MENU_PAD)
  const left = Math.min(props.x, window.innerWidth - MENU_WIDTH - MENU_PAD)
  return { top: Math.max(MENU_PAD, top), left: Math.max(MENU_PAD, left) }
})

// Always bright when enabled — context menu items are interactive, hover only
// changes background. Defaulting to textMuted made enabled rows look disabled.
const itemColor = (item: ContextMenuItem): string => {
  if (item.disabled) return t.value.textFaint
  if (item.danger) return t.value.danger
  return t.value.text
}

const itemStyle = (item: ContextMenuItem, hover: boolean) => ({
  background: hover && !item.disabled ? t.value.bgHover : 'transparent',
  color: itemColor(item),
  cursor: item.disabled ? 'not-allowed' : 'pointer',
})

const clearCloseTimer = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

const openSubmenuFor = (i: number, item: ContextMenuItem) => {
  if (!hasChildren(item)) return
  clearCloseTimer()
  const rowEl = rowRefs.get(i)
  const menuEl = menuRef.value
  if (!rowEl || !menuEl) return
  const rowRect = rowEl.getBoundingClientRect()
  const menuRect = menuEl.getBoundingClientRect()
  openSubmenuIndex.value = i
  openSubmenu.value = {
    items: item.children ?? [],
    // Position relative to the menu's own bounding box (the submenu lives
    // inside .absolute, so coordinates are local to the menu container).
    top: rowRect.top - menuRect.top,
    left: rowRect.width,
  }
}

const closeSubmenu = () => {
  openSubmenu.value = null
  openSubmenuIndex.value = -1
  subHoverIndex.value = -1
}

const onRowEnter = (i: number, item: ContextMenuItem) => {
  hoverIndex.value = i
  if (hasChildren(item)) {
    openSubmenuFor(i, item)
  } else if (openSubmenu.value) {
    // Hovering a non-parent row schedules submenu close after the delay.
    clearCloseTimer()
    closeTimer = setTimeout(closeSubmenu, HOVER_CLOSE_DELAY)
  }
}

const onRowLeave = () => {
  hoverIndex.value = -1
  if (openSubmenu.value) {
    clearCloseTimer()
    closeTimer = setTimeout(closeSubmenu, HOVER_CLOSE_DELAY)
  }
}

const onSubmenuEnter = () => {
  // Re-entering the submenu cancels the pending close.
  clearCloseTimer()
}

const onPick = (item: ContextMenuItem, parentIndex: number) => {
  if (item.disabled || item.separator) return
  if (hasChildren(item) && parentIndex >= 0) {
    // Clicking a parent toggles its submenu rather than firing an action.
    if (openSubmenuIndex.value === parentIndex) closeSubmenu()
    else openSubmenuFor(parentIndex, item)
    return
  }
  item.action?.()
  emit('close')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    if (openSubmenu.value) closeSubmenu()
    else emit('close')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearCloseTimer()
})
</script>
