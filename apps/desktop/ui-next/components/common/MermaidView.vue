<template>
  <div class="mmd" :class="{ full: fullscreen }">
    <div class="mmdbar">
      <button class="mmb" :title="t('common.zoomOut')" @click="zoomBy(-0.2)">
        <Icon name="minus" style="width: 13px; height: 13px" />
      </button>
      <button class="mmz" :title="t('common.zoomReset')" @click="reset">
        {{ Math.round(scale * 100) }}%
      </button>
      <button class="mmb" :title="t('common.zoomIn')" @click="zoomBy(0.2)">
        <Icon name="plus" style="width: 13px; height: 13px" />
      </button>
      <span class="mmsep" />
      <button
        class="mmb"
        :title="fullscreen ? t('common.exitFullscreen') : t('common.fullscreen')"
        @click="toggleFull"
      >
        <Icon :name="fullscreen ? 'minimize' : 'maximize'" style="width: 13px; height: 13px" />
      </button>
    </div>

    <div
      class="mmdvp"
      @wheel="onWheelZoom"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <!-- mermaid output is sanitized (securityLevel:strict) before v-html -->
      <!-- eslint-disable-next-line vue/no-v-html -- mermaid SVG, sanitized -->
      <div v-if="svg" class="mmdstage" :style="stageStyle" v-html="svg" />
      <div v-else-if="error" class="mmderr">
        <Icon name="alert" style="width: 15px; height: 15px" />
        <span>{{ error }}</span>
        <pre class="mmdsrc">{{ code }}</pre>
      </div>
      <div v-else class="mmdwait">{{ t('common.mermaid.rendering') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Renders one Mermaid diagram as live SVG with wheel-zoom (Ctrl/Cmd) + drag-pan.
// mermaid is dynamically imported (heavy, client-only) and re-rendered on theme
// change. Each render uses a PROCESS-WIDE unique id: mermaid keeps global state and
// renders through a temp element keyed by id, so two diagrams sharing an id (the
// previous per-instance counter all started at 1) clobbered each other and one
// silently produced no SVG. A module-level counter guarantees uniqueness.
const props = defineProps<{ code: string }>()
const { t } = useI18n()
const { isDark } = useTheme()
const { scale, tx, ty, zoomBy, reset, onPointerDown, onPointerMove, onPointerUp } = useZoomPan({
  min: 0.3,
  max: 6,
})

const svg = ref('')
const error = ref('')

// Zoom by widening the stage (svg is width:100%) so the SVG re-renders as crisp
// vector at any size; pan stays on transform. CSS transform:scale() would rasterize
// the SVG at its base size and blur when enlarged.
const stageStyle = computed(() => ({
  width: `${scale.value * 100}%`,
  transform: `translate(${tx.value}px, ${ty.value}px)`,
}))

// Wheel zooms only with Ctrl/Cmd (or in fullscreen) so scrolling the page/transcript
// over a diagram doesn't hijack the scroll and silently zoom it out.
function onWheelZoom(e: WheelEvent) {
  if (!fullscreen.value && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 0.2 : -0.2)
}

// Module-level so ids are unique across every MermaidView instance + re-render.
let UID = 0
// Per-instance token guards against a stale async render (theme/code changed
// mid-render) overwriting the latest result.
let renderToken = 0

async function render() {
  const myToken = ++renderToken
  if (!props.code.trim()) {
    svg.value = ''
    error.value = t('common.mermaid.empty')
    return
  }
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark.value ? 'dark' : 'default',
    })
    const { svg: out } = await mermaid.render(`mmd-${++UID}`, props.code)
    if (myToken !== renderToken) return // superseded by a newer render
    if (!out) {
      error.value = t('common.mermaid.empty')
      svg.value = ''
      return
    }
    svg.value = out
    error.value = ''
  } catch (e) {
    if (myToken !== renderToken) return
    // mermaid throws a descriptive parse error — surface it (the failure used to be
    // silent when an id collision produced empty output instead of throwing).
    error.value = e instanceof Error ? e.message : String(e)
    svg.value = ''
    console.warn('[mermaid] render failed', e)
  }
}

onMounted(render)
// New diagram → reset zoom/pan so it starts framed at 100%. Theme toggle keeps zoom.
watch(
  () => props.code,
  () => {
    reset()
    render()
  },
)
watch(isDark, render)

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
/* Slim control pill, consistent with the app's other floating toolbars. */
.mmdbar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bgEl);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}
.mmb {
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--textDim);
  cursor: pointer;
}
.mmb:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mmz {
  height: 22px;
  min-width: 44px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-family: var(--code);
  font-size: 12px;
  color: var(--textFaint);
  cursor: pointer;
}
.mmz:hover {
  background: var(--bgHover);
  color: var(--text);
}
.mmsep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 2px;
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
/* Error state: an icon + the parser message + the offending source, so a failed
   diagram is diagnosable instead of an empty grey box. */
.mmderr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 90%;
  padding: 16px;
  color: var(--danger);
  text-align: center;
}
.mmdsrc {
  margin: 0;
  max-width: 100%;
  max-height: 200px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--textDim);
  font-family: var(--code);
  font-size: 0.8462rem;
  white-space: pre-wrap;
  text-align: left;
}
.mmdwait {
  color: var(--textFaint);
}
</style>
