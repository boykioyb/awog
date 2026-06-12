<template>
  <div
    v-if="status === 'error'"
    class="my-3 rounded overflow-hidden"
    :style="{ background: t.bgInput, border: `1px solid ${t.dangerBorder}` }"
  >
    <div
      class="px-3 py-2 flex items-center gap-1.5 text-[1em] uppercase tracking-wider font-medium"
      :style="{
        color: t.danger,
        background: t.dangerBg,
        borderBottom: `1px solid ${t.dangerBorder}`,
      }"
    >
      <AlertCircle :size="11" />
      Mermaid render failed
    </div>
    <div class="p-3">
      <div class="text-[1em] mb-2 font-mono" :style="{ color: t.danger }">{{ error }}</div>
      <div class="text-[1em] mb-2" :style="{ color: t.textDim }">Diagram source:</div>
      <pre
        class="text-[1em] font-mono whitespace-pre-wrap p-2 rounded"
        :style="{ color: t.textMuted, background: t.bg, border: `1px solid ${t.border}` }"
        >{{ code }}</pre
      >
    </div>
  </div>

  <div
    v-else
    class="group relative my-3 p-4 rounded flex items-center justify-center overflow-x-auto mermaid-output"
    :style="{ background: t.bgInput, border: `1px solid ${t.border}`, minHeight: '100px' }"
  >
    <div
      v-if="status === 'loading'"
      class="text-[1em] inline-flex items-center gap-2"
      :style="{ color: t.textDim }"
    >
      <Activity :size="11" class="animate-pulse" />
      Loading mermaid…
    </div>
    <!-- eslint-disable vue/no-v-html -- svg do mermaid sinh ra, không phải input người dùng -->
    <div
      v-else
      ref="svgHost"
      :style="{ maxWidth: '100%', width: '100%', display: 'flex', justifyContent: 'center' }"
      v-html="svg"
    />
    <!-- eslint-enable vue/no-v-html -->

    <!-- Fullscreen zoom affordance (hover-revealed) — opens the shared zoom modal -->
    <button
      v-if="status === 'rendered'"
      type="button"
      class="absolute top-2 right-2 p-1.5 rounded transition opacity-0 group-hover:opacity-100"
      :style="{ background: t.bgElevated, border: `1px solid ${t.border}`, color: t.textDim }"
      :title="tr('session.mermaid.zoom')"
      @click="zoomOpen = true"
    >
      <Maximize2 :size="13" />
    </button>
  </div>

  <MermaidZoomModal v-if="zoomOpen" :source="code" @close="zoomOpen = false" />
</template>

<script setup lang="ts">
import { Activity, AlertCircle, Maximize2 } from 'lucide-vue-next'
import { loadMermaid } from '~/utils/load-mermaid'
import { applyMermaidLabelContrast, mermaidTheme } from '~/utils/mermaid-theme'
import MermaidZoomModal from '~/components/markdown/MermaidZoomModal.vue'

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const props = defineProps<{ code: string }>()
const { t, themeName } = useTheme()
const { t: tr } = useI18n()

// Fullscreen zoom/pan view of this diagram (re-renders the source at full size).
const zoomOpen = ref(false)

const svg = ref<string | null>(null)
const error = ref<string | null>(null)
const status = ref<'loading' | 'rendered' | 'error'>('loading')

// Host of the v-html'd SVG; re-color node labels for contrast once it mounts.
const svgHost = useTemplateRef<HTMLElement>('svgHost')
watch(svg, (v) => {
  if (v) nextTick(() => applyMermaidLabelContrast(svgHost.value))
})

let cancelled = false

watch(
  () => [props.code, themeName.value] as const,
  () => {
    cancelled = false
    let localCancel = false
    const reset = () => {
      localCancel = true
    }
    // Reset state
    status.value = 'loading'
    error.value = null
    svg.value = null

    loadMermaid()
      .then((mermaid) => {
        if (cancelled || localCancel) return
        try {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            ...mermaidTheme(themeName.value === 'dark'),
            fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
            fontSize: 13,
            flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
            sequence: { actorMargin: 50, boxMargin: 10, useMaxWidth: true },
          })

          const renderId = `mermaid-${Math.random().toString(36).slice(2, 11)}`

          try {
            // Callback-style API (v8)
            mermaid.render(renderId, props.code, (rendered: string) => {
              if (cancelled || localCancel) return
              svg.value = rendered
              status.value = 'rendered'
            })
          } catch (callbackErr) {
            // Fallback: promise-style (v10+)
            const result = mermaid.render(renderId, props.code)
            if (result instanceof Promise) {
              result
                .then(({ svg: rendered }) => {
                  if (cancelled || localCancel) return
                  svg.value = rendered
                  status.value = 'rendered'
                })
                .catch((err: unknown) => {
                  if (cancelled || localCancel) return
                  error.value = `Render failed: ${errorMessage(err)}`
                  status.value = 'error'
                })
            } else if (typeof result === 'string') {
              if (!cancelled && !localCancel) {
                svg.value = result
                status.value = 'rendered'
              }
            } else {
              throw callbackErr
            }
          }
        } catch (err: unknown) {
          if (cancelled || localCancel) return
          error.value = `Init/render error: ${errorMessage(err)}`
          status.value = 'error'
        }
      })
      .catch((err: unknown) => {
        if (cancelled || localCancel) return
        error.value = errorMessage(err) || 'Failed to load mermaid library'
        status.value = 'error'
      })

    // Cleanup on next run
    return reset
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cancelled = true
})
</script>
