<template>
  <div v-if="open" ref="menuEl" class="smenu ctxm" :style="menuStyle" @click.stop>
    <template v-for="(it, i) in items" :key="i">
      <div v-if="it.separator" class="ctxsep" />
      <div
        v-else
        class="mi"
        :class="{
          dmi: it.danger,
          mdisabled: it.disabled,
          msub: !!it.children,
          cur: it.active,
          mrow: !!it.buttons,
        }"
        @mouseenter="onEnter(it, i, $event)"
        @click="onPick(it)"
      >
        <span v-if="it.dot" class="ctxdot" :style="{ background: it.dot }" />
        <Icon
          v-if="it.icon"
          :name="it.icon"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        <span style="flex: 1">{{ it.label }}</span>
        <span v-if="it.hint" class="mhint">{{ it.hint }}</span>
        <span v-if="it.buttons" class="mbtns">
          <button
            v-for="b in it.buttons"
            :key="b.id"
            type="button"
            class="mbtn"
            :title="b.title"
            :aria-label="b.title"
            @click.stop="onButton(b.id)"
          >
            <Icon
              v-if="b.icon"
              :name="b.icon"
              style="width: var(--icon-xs); height: var(--icon-xs)"
            />
            <span v-if="b.text" class="mbtntext tnum">{{ b.text }}</span>
          </button>
        </span>
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
              <span v-if="c.dot" class="ctxdot" :style="{ background: c.dot }" />
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
  if (it.disabled || it.separator || it.children || it.buttons || !it.id) return
  emit('select', it.id)
  emit('close')
}

// Nút trên hàng: chọn nhưng KHÔNG đóng menu — thu phóng thường bấm vài lần liền.
const onButton = (id: string) => emit('select', id)

const onDocClick = () => emit('close')
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
/* shadcn-vue overlay skin over the shared `.smenu`/`.mi` vocabulary (keep those
   class hooks — theme-cute.css and the app-wide interaction rules target them).
   Reads the standard bridge vars (shadcn-bridge.css): popover surface, wash for
   hover, destructive for danger rows, hairline separators. `.smenu.ctxm` keeps
   selectors one notch above the global `.smenu .mi` rules so these win. */
.smenu.ctxm {
  min-width: 12rem;
  padding: 4px;
  border-color: var(--border);
  border-radius: var(--radius);
}
.smenu.ctxm .mi {
  min-height: 28px; /* h-7 */
  padding: 0 8px;
  border-radius: var(--r-xs); /* rounded-sm */
  color: var(--popover-foreground);
}
.smenu.ctxm .mi:hover {
  background: var(--accent-wash);
  color: var(--accent-foreground);
}
.smenu.ctxm .mi .icn {
  color: var(--muted-foreground);
}
.smenu.ctxm .mi:hover .icn {
  color: var(--accent-foreground);
}
.smenu.ctxm .mi.dmi,
.smenu.ctxm .mi.dmi .icn {
  color: var(--destructive);
}
.smenu.ctxm .mi.dmi:hover {
  background: rgb(from var(--destructive) r g b / 0.1);
  color: var(--destructive);
}
.smenu.ctxm .mi .ck {
  color: var(--primary);
}
/* Hint (giá trị/phím tắt) căn PHẢI: luật toàn cục `.smenu .mi span { flex: 1 }` kéo cả
   span hint giãn ra nên nó trôi vào giữa hàng. */
.smenu.ctxm .mi .mhint {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 16px;
  text-align: right;
  color: var(--muted-foreground);
}
.smenu.ctxm .mi.mrow {
  cursor: default;
}
.smenu.ctxm .mi.mrow:hover {
  background: transparent;
  color: var(--popover-foreground);
}
.smenu.ctxm .mi .mbtns {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.smenu.ctxm .mi .mbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--popover-foreground);
  cursor: pointer;
}
.smenu.ctxm .mi .mbtn:hover {
  background: var(--accent-wash);
}
.smenu.ctxm .mi .mbtntext {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.smenu.ctxm .mi .msubchev {
  color: var(--muted-foreground);
}
.smenu.ctxm .mi.cur {
  color: var(--primary);
}
.smenu.ctxm.msubmenu {
  min-width: 196px;
}
.ctxsep {
  /* shadcn separator: h-px, my-1, edge-to-edge (-mx-1 against the p-1 menu pad). */
  margin: 4px -4px;
  background: var(--border);
}
/* Specificity ngang `.smenu .mi span` toàn cục — thiếu thì luật `flex: 1` của nó kéo chấm giãn ngang. */
.smenu.ctxm .mi .ctxdot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
