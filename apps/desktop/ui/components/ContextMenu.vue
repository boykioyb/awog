<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div
        class="absolute min-w-[160px] rounded-md py-1 overflow-hidden"
        :style="{
          top: `${position.top}px`,
          left: `${position.left}px`,
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 12px 32px ${t.shadow}`,
        }"
        @click.stop
      >
        <button
          v-for="(item, i) in items"
          :key="i"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition"
          :style="itemStyle(item, hoverIndex === i)"
          :disabled="item.disabled"
          @click="onPick(item)"
          @mouseenter="hoverIndex = i"
          @mouseleave="hoverIndex = -1"
        >
          <component :is="item.icon" v-if="item.icon" :size="12" class="flex-shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { FunctionalComponent } from 'vue'

export interface ContextMenuItem {
  label: string
  icon?: FunctionalComponent | unknown
  danger?: boolean
  disabled?: boolean
  action: () => void
}

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const hoverIndex = ref(-1)

const MENU_WIDTH = 180
const MENU_PAD = 8

const position = computed(() => {
  if (!import.meta.client) return { top: props.y, left: props.x }
  const top = Math.min(props.y, window.innerHeight - 8 * (props.items.length + 2) - MENU_PAD)
  const left = Math.min(props.x, window.innerWidth - MENU_WIDTH - MENU_PAD)
  return { top: Math.max(MENU_PAD, top), left: Math.max(MENU_PAD, left) }
})

const itemStyle = (item: ContextMenuItem, hover: boolean) => {
  const color = item.disabled
    ? t.value.textFaint
    : item.danger
      ? t.value.danger
      : hover
        ? t.value.text
        : t.value.textMuted
  return {
    background: hover && !item.disabled ? t.value.bgHover : 'transparent',
    color,
    cursor: item.disabled ? 'not-allowed' : 'pointer',
  }
}

const onPick = (item: ContextMenuItem) => {
  if (item.disabled) return
  item.action()
  emit('close')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
