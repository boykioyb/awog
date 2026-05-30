<template>
  <div
    v-if="status === 'error'"
    class="my-3 rounded overflow-hidden"
    :style="{ background: t.bgInput, border: `1px solid ${t.dangerBorder}` }"
  >
    <div
      class="px-3 py-2 flex items-center gap-1.5 text-[0.71em] uppercase tracking-wider font-medium"
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
      <div class="text-[0.79em] mb-2 font-mono" :style="{ color: t.danger }">{{ error }}</div>
      <div class="text-[0.71em] mb-2" :style="{ color: t.textDim }">Diagram source:</div>
      <pre
        class="text-[10.5px] font-mono whitespace-pre-wrap p-2 rounded"
        :style="{ color: t.textMuted, background: t.bg, border: `1px solid ${t.border}` }"
        >{{ code }}</pre
      >
    </div>
  </div>

  <div
    v-else
    class="my-3 p-4 rounded flex items-center justify-center overflow-x-auto mermaid-output"
    :style="{ background: t.bgInput, border: `1px solid ${t.border}`, minHeight: '100px' }"
  >
    <div
      v-if="status === 'loading'"
      class="text-[0.79em] inline-flex items-center gap-2"
      :style="{ color: t.textDim }"
    >
      <Activity :size="11" class="animate-pulse" />
      Loading mermaid…
    </div>
    <!-- eslint-disable vue/no-v-html -- svg do mermaid sinh ra, không phải input người dùng -->
    <div
      v-else
      :style="{ maxWidth: '100%', width: '100%', display: 'flex', justifyContent: 'center' }"
      v-html="svg"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<script setup lang="ts">
import { Activity, AlertCircle } from 'lucide-vue-next'
import { loadMermaid } from '~/utils/load-mermaid'

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const props = defineProps<{ code: string }>()
const { t, themeName } = useTheme()

const svg = ref<string | null>(null)
const error = ref<string | null>(null)
const status = ref<'loading' | 'rendered' | 'error'>('loading')

let cancelled = false

const darkVars = {
  darkMode: true,
  background: '#161616',
  primaryColor: '#262626',
  primaryTextColor: '#ededed',
  primaryBorderColor: '#525252',
  secondaryColor: '#1f1f1f',
  tertiaryColor: '#0a0a0a',
  lineColor: '#a3a3a3',
  textColor: '#ededed',
  mainBkg: '#262626',
  nodeBorder: '#525252',
  clusterBkg: '#1a1a1a',
  clusterBorder: '#2e2e2e',
  edgeLabelBackground: '#161616',
  actorBorder: '#525252',
  actorBkg: '#262626',
  actorTextColor: '#ededed',
  actorLineColor: '#737373',
  signalColor: '#ededed',
  signalTextColor: '#ededed',
  labelBoxBkgColor: '#262626',
  labelBoxBorderColor: '#525252',
  labelTextColor: '#ededed',
  loopTextColor: '#ededed',
  noteBkgColor: '#3f3f1a',
  noteBorderColor: '#525252',
  noteTextColor: '#ededed',
}

const lightVars = {
  background: '#ffffff',
  primaryColor: '#f5f5f4',
  primaryTextColor: '#1c1917',
  primaryBorderColor: '#a8a29e',
  lineColor: '#57534e',
  textColor: '#1c1917',
  mainBkg: '#fafaf9',
  nodeBorder: '#a8a29e',
  clusterBkg: '#f5f5f4',
  clusterBorder: '#d6d3d1',
}

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
            theme: themeName.value === 'dark' ? 'dark' : 'default',
            themeVariables: themeName.value === 'dark' ? darkVars : lightVars,
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
