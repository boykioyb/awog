<template>
  <div class="mmd" :class="{ full: fullscreen }">
    <div class="mmdbar">
      <button class="mmb" :title="t('common.zoomOut')" @click="zoomBy(-0.2)">−</button>
      <span class="mmz">{{ Math.round(scale * 100) }}%</span>
      <button class="mmb" :title="t('common.zoomIn')" @click="zoomBy(0.2)">+</button>
      <button class="mmb" :title="t('common.zoomReset')" @click="reset">
        <Icon name="refresh" style="width: 12px; height: 12px" />
      </button>
      <button class="mmb" :title="t('common.fullscreen')" @click="toggleFull">
        {{ fullscreen ? '⤡' : '⤢' }}
      </button>
    </div>

    <div
      class="mmdvp"
      @wheel="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- mermaid output is sanitized (securityLevel:strict) before v-html -->
      <!-- eslint-disable-next-line vue/no-v-html -- mermaid SVG, sanitized -->
      <div v-if="svg" class="mmdstage" :style="stageStyle" v-html="svg" />
      <pre v-else-if="error" class="mmderr">{{ error }}</pre>
      <div v-else class="mmdwait">…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Renders one Mermaid diagram as live SVG with wheel-zoom + drag-pan. mermaid is
// dynamically imported (heavy, client-only) and re-rendered on theme change.
const props = defineProps<{ code: string }>()
const { t } = useI18n()
const { isDark } = useTheme()
const { scale, tx, ty, zoomBy, reset, onWheel, onPointerDown, onPointerMove, onPointerUp } =
  useZoomPan({ min: 0.3, max: 6 })

const svg = ref('')
const error = ref('')
let seq = 0

// Zoom by widening the stage (svg is width:100%) so the SVG re-renders as crisp
// vector at any size; pan stays on transform. CSS transform:scale() would rasterize
// the SVG at its base size and blur when enlarged.
const stageStyle = computed(() => ({
  width: `${scale.value * 100}%`,
  transform: `translate(${tx.value}px, ${ty.value}px)`,
}))

async function render() {
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
    })
    seq += 1
    const { svg: out } = await mermaid.render(`mmd-${seq}`, props.code)
    svg.value = out
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    svg.value = ''
  }
}

onMounted(render)
watch([() => props.code, isDark], render)

// Fullscreen: blow the diagram up to a fixed full-window overlay (above the preview
// modal) so big graphs are readable; zoom/pan still apply inside it.
const fullscreen = ref(false)
function toggleFull() {
  fullscreen.value = !fullscreen.value
}
// Esc exits fullscreen — capture phase + stopPropagation so the parent modal's own
// Esc-to-close doesn't also fire.
function onFsKey(e: KeyboardEvent) {
  if (fullscreen.value && e.key === 'Escape') {
    fullscreen.value = false
    e.stopPropagation()
  }
}
onMounted(() => window.addEventListener('keydown', onFsKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onFsKey, true))
</script>

<style scoped>
.mmd {
  position: relative;
  align-self: stretch;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bgSubtle);
  overflow: hidden;
}
.mmd.full {
  position: fixed;
  inset: 0;
  z-index: 300;
  border: 0;
  border-radius: 0;
  background: var(--bg);
}
.mmd.full .mmdvp {
  height: 100vh;
  max-height: none;
}
.mmdbar {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 5px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bgEl);
}
.mmb {
  display: grid;
  place-items: center;
  padding: 3px;
  border-radius: 5px;
  color: var(--textDim);
  cursor: pointer;
}
.mmb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mmz {
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  min-width: 36px;
  text-align: center;
}
.mmdvp {
  height: 360px;
  max-height: 60vh;
  overflow: hidden;
  display: grid;
  place-items: center;
  cursor: grab;
  touch-action: none;
}
.mmdvp:active {
  cursor: grabbing;
}
.mmdstage {
  transform-origin: center center;
}
/* Force the mermaid SVG to fill the (zoomable) stage width so it scales as vector. */
.mmdstage :deep(svg) {
  display: block;
  width: 100% !important;
  height: auto !important;
  max-width: none !important;
}
.mmderr {
  margin: 0;
  padding: 14px;
  white-space: pre-wrap;
  font-family: var(--code);
  font-size: 0.8462rem;
  color: var(--danger);
}
.mmdwait {
  color: var(--textFaint);
}
</style>
