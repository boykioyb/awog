<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[120] flex flex-col"
      :style="{ background: t.overlay }"
      @click.self="emit('close')"
    >
      <!-- Toolbar -->
      <div
        class="flex items-center gap-2 px-4 py-2.5"
        :style="{ background: t.bgPanel, borderBottom: `1px solid ${t.border}` }"
      >
        <Network :size="14" :style="{ color: t.accent }" />
        <span class="text-[1em] font-medium" :style="{ color: t.text }">
          {{ tr('session.mermaid.title') }}
        </span>
        <span class="flex-1" />

        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('session.mermaid.zoomOut')"
          @click="zoomBy(-ZOOM_STEP)"
        >
          <Minus :size="14" />
        </button>
        <span
          class="text-[12px] font-mono tabular-nums text-center"
          :style="{ color: t.textDim, minWidth: '48px' }"
        >
          {{ Math.round(scale * 100) }}%
        </span>
        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('session.mermaid.zoomIn')"
          @click="zoomBy(ZOOM_STEP)"
        >
          <Plus :size="14" />
        </button>
        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('session.mermaid.reset')"
          @click="scale = 1"
        >
          <Maximize :size="14" />
        </button>
        <div :style="{ width: '1px', height: '18px', background: t.border }" />
        <button
          type="button"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('common.close')"
          @click="emit('close')"
        >
          <X :size="15" />
        </button>
      </div>

      <!-- Diagram surface -->
      <div
        ref="scroller"
        class="flex-1 overflow-auto p-8 select-none"
        :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
        :style="{ background: t.bg }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel="onWheel"
      >
        <div
          v-if="status === 'loading'"
          class="h-full flex items-center justify-center gap-2 text-[1em]"
          :style="{ color: t.textDim }"
        >
          <Activity :size="13" class="animate-pulse" />
          {{ tr('common.loading') }}
        </div>
        <div
          v-else-if="status === 'error'"
          class="h-full flex items-center justify-center text-[1em]"
          :style="{ color: t.danger }"
        >
          {{ tr('session.mermaid.failed') }}
        </div>
        <!-- eslint-disable vue/no-v-html -- svg from mermaid, not user HTML -->
        <div
          v-else
          class="mermaid-zoom-canvas mx-auto"
          :style="{ width: `${scale * 100}%` }"
          v-html="svg"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Activity, Maximize, Minus, Network, Plus, X } from 'lucide-vue-next'
import { renderMermaidSource } from '~/utils/mermaid'

const props = defineProps<{
  // Raw (decoded) mermaid diagram source.
  source: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t, themeName } = useTheme()
const { t: tr } = useI18n()

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4

const svg = ref<string | null>(null)
const status = ref<'loading' | 'rendered' | 'error'>('loading')
const scale = ref(1)
const scroller = ref<HTMLElement | null>(null)

const clampScale = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v))
const zoomBy = (delta: number) => {
  scale.value = clampScale(Math.round((scale.value + delta) * 100) / 100)
}

// Ctrl/Cmd + wheel zooms; plain wheel scrolls the surface as usual.
const onWheel = (ev: WheelEvent) => {
  if (!ev.ctrlKey && !ev.metaKey) return
  ev.preventDefault()
  zoomBy(ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
}

// Drag-to-pan on the scroll surface.
const dragging = ref(false)
let startX = 0
let startY = 0
let startLeft = 0
let startTop = 0
const onPointerDown = (ev: PointerEvent) => {
  const el = scroller.value
  if (!el || ev.button !== 0) return
  dragging.value = true
  startX = ev.clientX
  startY = ev.clientY
  startLeft = el.scrollLeft
  startTop = el.scrollTop
  el.setPointerCapture(ev.pointerId)
}
const onPointerMove = (ev: PointerEvent) => {
  const el = scroller.value
  if (!dragging.value || !el) return
  el.scrollLeft = startLeft - (ev.clientX - startX)
  el.scrollTop = startTop - (ev.clientY - startY)
}
const onPointerUp = (ev: PointerEvent) => {
  const el = scroller.value
  dragging.value = false
  if (el?.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
}

const onKeydown = (ev: KeyboardEvent) => {
  if (ev.key === 'Escape') emit('close')
}

watch(
  () => [props.source, themeName.value] as const,
  async ([source]) => {
    status.value = 'loading'
    svg.value = null
    try {
      // The scoped `:deep(svg) { max-width: none }` rule lets the scale wrapper
      // grow the diagram past its natural width — no SVG-markup rewrite needed.
      svg.value = await renderMermaidSource(source, themeName.value === 'dark')
      status.value = 'rendered'
    } catch {
      status.value = 'error'
    }
  },
  { immediate: true },
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* The scale wrapper drives width; let the SVG fill it and keep aspect ratio. */
.mermaid-zoom-canvas :deep(svg) {
  width: 100%;
  height: auto;
  max-width: none !important;
}
</style>
