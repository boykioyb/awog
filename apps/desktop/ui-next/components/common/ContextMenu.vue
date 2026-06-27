<template>
  <div
    v-if="open"
    class="smenu ctxm"
    :style="{ top: `${position.y}px`, left: `${position.x}px` }"
    @click.stop
  >
    <template v-for="(it, i) in items" :key="i">
      <div v-if="it.separator" class="ctxsep" />
      <div
        v-else
        class="mi"
        :class="{ dmi: it.danger, mdisabled: it.disabled, msub: !!it.children }"
        @mouseenter="onEnter(it, i, $event)"
        @click="onPick(it)"
      >
        <Icon v-if="it.icon" :name="it.icon" style="width: 13px; height: 13px" />
        <span style="flex: 1">{{ it.label }}</span>
        <span v-if="it.hint" class="mhint">{{ it.hint }}</span>
        <svg v-if="it.children" class="icn msubchev"><use href="#i-chev" /></svg>

        <!-- Submenu flyout — fixed-positioned so the parent menu's overflow
             doesn't clip it. -->
        <div
          v-if="it.children && openSub === i"
          class="smenu ctxm msubmenu"
          :style="subStyle"
          @click.stop
        >
          <template v-for="(c, j) in it.children" :key="j">
            <div v-if="c.separator" class="ctxsep" />
            <div
              v-else
              class="mi"
              :class="{ dmi: c.danger, mdisabled: c.disabled }"
              @click="onPick(c)"
            >
              <Icon v-if="c.icon" :name="c.icon" style="width: 13px; height: 13px" />
              <span style="flex: 1">{{ c.label }}</span>
              <span v-if="c.hint" class="mhint">{{ c.hint }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Generic context menu — renders a MenuItem[] (separators, danger rows, disabled
// rows, trailing hint/shortcut, one level of submenu via `children`). Emits
// `select` with the chosen item's id. Shared across the git, file, and PR-file
// surfaces (any caller builds a MenuItem list + handles select).
import type { MenuItem } from '~/composables/useContextMenu'

defineProps<{
  open: boolean
  position: { x: number; y: number }
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', id: string): void
}>()

const openSub = ref<number | null>(null)
const subStyle = ref<Record<string, string>>({})

function onEnter(it: MenuItem, i: number, ev: MouseEvent) {
  if (!it.children) {
    openSub.value = null
    return
  }
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  // Open to the right; flip left if it would overflow the viewport.
  const left = r.right + 198 > window.innerWidth ? r.left - 198 : r.right + 2
  subStyle.value = { top: `${r.top - 5}px`, left: `${left}px` }
  openSub.value = i
}

function onPick(it: MenuItem) {
  if (it.disabled || it.separator || it.children || !it.id) return
  emit('select', it.id)
  emit('close')
}

const onDocClick = () => emit('close')
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>
