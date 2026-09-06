<template>
  <div v-if="open" ref="menuEl" class="smenu ctxm" :style="menuStyle" @click.stop>
    <template v-for="(it, i) in items" :key="i">
      <div v-if="it.separator" class="ctxsep" />
      <div
        v-else
        class="mi"
        :class="{ dmi: it.danger, mdisabled: it.disabled, msub: !!it.children, cur: it.active }"
        @mouseenter="onEnter(it, i, $event)"
        @click="onPick(it)"
      >
        <Icon
          v-if="it.icon"
          :name="it.icon"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        <span style="flex: 1">{{ it.label }}</span>
        <span v-if="it.hint" class="mhint">{{ it.hint }}</span>
        <Icon
          v-if="it.active"
          name="check"
          class="ck"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
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
              :class="{ dmi: c.danger, mdisabled: c.disabled, cur: c.active }"
              @click="onPick(c)"
            >
              <Icon
                v-if="c.icon"
                :name="c.icon"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              <span style="flex: 1">{{ c.label }}</span>
              <span v-if="c.hint" class="mhint">{{ c.hint }}</span>
              <Icon
                v-if="c.active"
                name="check"
                class="ck"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
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

const props = defineProps<{
  open: boolean
  position: { x: number; y: number }
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', id: string): void
}>()

// Viewport-aware placement: the caller passes the click point, but a tall menu
// (e.g. the git file menu, 13+ rows) would overflow below the viewport and clip
// its bottom rows. After render we measure the real height, shift the menu up to
// fit, and cap it with a scroll when it's taller than the screen.
const menuEl = useTemplateRef<HTMLElement>('menuEl')
const placed = ref<{ top: number; left: number; maxHeight: number | null }>({
  top: 0,
  left: 0,
  maxHeight: null,
})
const menuStyle = computed(() => ({
  top: `${placed.value.top}px`,
  left: `${placed.value.left}px`,
  ...(placed.value.maxHeight != null
    ? { maxHeight: `${placed.value.maxHeight}px`, overflowY: 'auto' as const }
    : {}),
}))

function reposition() {
  const el = menuEl.value
  if (!el) return
  const M = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = el.offsetWidth
  const h = el.scrollHeight // full content height, even if a stale maxHeight clips it
  let left = props.position.x
  let top = props.position.y
  if (left + w > vw - M) left = Math.max(M, vw - w - M)
  const avail = vh - M * 2
  const maxHeight = h > avail ? avail : null
  const effH = maxHeight ?? h
  if (top + effH > vh - M) top = Math.max(M, vh - effH - M)
  placed.value = { top, left, maxHeight }
}

watch(
  () => [props.open, props.position.x, props.position.y] as const,
  async ([isOpen]) => {
    if (!isOpen) return
    // Seed at the click point so the first frame is roughly right, then refine
    // once the DOM has measurable dimensions.
    placed.value = { top: props.position.y, left: props.position.x, maxHeight: null }
    await nextTick()
    reposition()
  },
  { immediate: true },
)

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
  // Clamp the top so a submenu opened near the bottom edge doesn't overflow
  // (height estimated from the child count — the flyout isn't measured yet).
  const estH = (it.children?.length ?? 0) * 30 + 12
  const top = Math.max(8, Math.min(r.top - 5, window.innerHeight - estH - 8))
  subStyle.value = { top: `${top}px`, left: `${left}px` }
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
