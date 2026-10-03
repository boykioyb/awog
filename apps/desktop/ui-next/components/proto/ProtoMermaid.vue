<template>
  <!-- Fullscreen teleports to body (same pattern as MermaidView.full) -->
  <Teleport to="body" :disabled="!fullscreen">
    <div
      class="overflow-hidden rounded-lg border border-border"
      :class="
        fullscreen
          ? 'fixed inset-4 z-[85] flex flex-col bg-background shadow-2xl'
          : 'flex h-64 flex-col bg-muted/50'
      "
    >
      <div class="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Waypoints class="size-3 text-muted-foreground" />
        <span class="text-xs text-muted-foreground">mermaid</span>
        <span class="flex-1" />
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6"
          title="Zoom out"
          @click="zoom(1 / 1.25)"
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 w-10 text-center text-xs text-muted-foreground tabular-nums hover:text-foreground"
          title="Reset zoom"
          @click="resetView"
        >
          {{ Math.round(scale * 100) }}%
        </Button>
        <Button variant="ghost" size="iconSm" class="size-6" title="Zoom in" @click="zoom(1.25)">
          <Plus />
        </Button>
        <Button variant="ghost" size="iconSm" class="size-6" title="Fit" @click="fit">
          <Maximize />
        </Button>
        <Separator orientation="vertical" class="mx-0.5 !h-4" />
        <Button variant="ghost" size="iconSm" class="size-6" title="Copy source" @click="copy">
          <Check v-if="copied" class="text-success" />
          <Copy v-else />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-6"
          :title="fullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="fullscreen = !fullscreen"
        >
          <Minimize2 v-if="fullscreen" />
          <Maximize2 v-else />
        </Button>
      </div>

      <div
        ref="viewport"
        class="relative min-h-0 flex-1 overflow-hidden"
        :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
      >
        <div
          class="absolute top-0 left-0 origin-top-left p-4 [&_svg]:max-w-none"
          :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }"
        >
          <!-- mermaid output is sanitized (securityLevel: 'strict') before v-html -->
          <!-- eslint-disable-next-line vue/no-v-html -- mermaid SVG, sanitized -->
          <div v-if="svg" v-html="svg" />
        </div>
        <div v-if="error" class="p-3 text-xs text-destructive">{{ error }}</div>
        <div v-else-if="!svg" class="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 class="size-3 animate-spin" />
          Rendering diagram…
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Real mermaid render + the MermaidView control set: zoom ±, % reset, fit,
// copy source, drag-pan, wheel zoom and a teleported fullscreen overlay (Esc
// exits). Render rules mirror common/MermaidView.vue: dynamic import,
// process-unique render id, re-render on theme flip.
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import {
  Check,
  Copy,
  Loader2,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Waypoints,
} from 'lucide-vue-next'
import { useTheme } from '~/composables/useTheme'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ code: string }>()

const { isDark } = useTheme()
const svg = ref('')
const error = ref('')
const copied = ref(false)
const fullscreen = ref(false)

// Process-unique per instance (mermaid keys global state by render id —
// collisions yield silent empty SVGs).
const renderId = `proto-mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

async function render() {
  error.value = ''
  try {
    const mermaid = (await loadHeavyDep(() => import('mermaid'))).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'neutral',
      fontFamily: 'inherit',
    })
    const { svg: out } = await mermaid.render(`${renderId}-${isDark.value ? 'd' : 'l'}`, props.code)
    svg.value = out
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

// ── View transform (zoom + pan) ─────────────────────────────────────────────
const scale = ref(1)
const pan = ref({ x: 0, y: 0 })
const viewport = ref<HTMLElement | null>(null)

function zoom(f: number) {
  scale.value = Math.min(4, Math.max(0.2, scale.value * f))
}
function resetView() {
  scale.value = 1
  pan.value = { x: 0, y: 0 }
}
function fit() {
  const vp = viewport.value
  const g = vp?.querySelector('svg')
  if (!vp || !g) return
  // Natural size from the viewBox — getBoundingClientRect is unreliable here
  // because mermaid emits max-width styles on the svg.
  const w = g.viewBox?.baseVal?.width || g.getBoundingClientRect().width / scale.value
  const h = g.viewBox?.baseVal?.height || g.getBoundingClientRect().height / scale.value
  if (!w || !h) return
  scale.value = Math.min(
    4,
    Math.max(0.2, Math.min((vp.clientWidth - 32) / w, (vp.clientHeight - 32) / h)),
  )
  pan.value = { x: 16, y: 16 }
}
function onWheel(e: WheelEvent) {
  zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1)
}

const dragging = ref(false)
let dragStart = { x: 0, y: 0, px: 0, py: 0 }
function onPointerDown(e: PointerEvent) {
  dragging.value = true
  dragStart = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  pan.value = {
    x: dragStart.px + e.clientX - dragStart.x,
    y: dragStart.py + e.clientY - dragStart.y,
  }
}
function onPointerUp() {
  dragging.value = false
}

async function copy() {
  await navigator.clipboard.writeText(props.code)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}

function onKey(e: KeyboardEvent) {
  if (fullscreen.value && e.key === 'Escape') {
    e.stopPropagation()
    fullscreen.value = false
  }
}

onMounted(() => {
  render().then(fit)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
watch(isDark, render)
// Viewport size changes when entering/exiting fullscreen — re-fit the zoom.
watch(fullscreen, async () => {
  await nextTick()
  fit()
})
</script>
