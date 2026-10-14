<template>
  <!-- Doc 'img' — ảnh workspace qua fs.readFileBase64 (cap 25MB phía sidecar):
       vbar (path · size) + seg Zoom−/Fit/Zoom+; ảnh fit khung mặc định, zoom/pan
       qua useZoomPan khi phóng. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-[var(--bgEl)]"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="metaLabel" class="flex-none text-[var(--textFaint)]">· {{ metaLabel }}</span>
      <DocReloadButton class="ml-auto" :doc="props.doc" />
      <DocButtonGroup
        :options="zoomOptions"
        :active="fitted ? 'fit' : null"
        @select="onZoomAction"
      />
    </div>
    <div
      v-if="st.status === 'loading' || st.status === 'idle'"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.file.loading') }}
    </div>
    <div
      v-else-if="st.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-destructive"
    >
      {{ st.error }}
    </div>
    <div
      v-else-if="st.truncated || !src"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.img.tooLarge', { size: st.byteSize ? formatBytes(st.byteSize) : '—' }) }}
    </div>
    <div
      v-else
      class="relative flex min-h-0 flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
      :style="{
        background:
          'linear-gradient(45deg, var(--bgEl) 25%, transparent 25%, transparent 75%, var(--bgEl) 75%), var(--bgPanel)',
        backgroundSize: '16px 16px',
      }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img
        ref="imgEl"
        :src="src"
        class="max-h-[88%] max-w-[92%] select-none rounded-[var(--r-sm)] object-contain"
        :style="picStyle"
        draggable="false"
        alt=""
        @load="onImgLoad"
      />
      <div
        class="pointer-events-none absolute inset-x-0 bottom-2.5 text-center text-xs text-[var(--textFaint)]"
      >
        {{ rel }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useZoomPan } from '~/composables/useZoomPan'
import { formatBytes } from '~/utils/format-bytes'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'
import DocButtonGroup from '~/components/workbench/stage/DocButtonGroup.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const st = wbDocs.fileStateOf(props.doc)
const rel = computed(() => wbDocs.relPathOf(props.doc))

const src = computed(() =>
  st.base64 && st.mimeType ? `data:${st.mimeType};base64,${st.base64}` : '',
)

const metaLabel = computed(() => {
  if (st.status !== 'ok') return ''
  const size = st.byteSize > 0 ? formatBytes(st.byteSize) : ''
  return dims.value ? `${size} · ${dims.value}` : size
})

const { scale, tx, ty, zoomBy, reset, onWheel, onPointerDown, onPointerMove, onPointerUp } =
  useZoomPan({ min: 0.05, max: 8 })

// Fit mặc định: ảnh trong khung (object-fit), zoom = 1 nghĩa là "vừa khung".
// `fitted` = không pan/zoom thủ công — khi đó img giữ max-width/max-height.
const fitted = computed(() => scale.value === 1 && tx.value === 0 && ty.value === 0)
const natural = ref<{ w: number; h: number } | null>(null)
const dims = computed(() => (natural.value ? `${natural.value.w}×${natural.value.h}` : ''))
const imgEl = useTemplateRef<HTMLImageElement>('imgEl')

const picStyle = computed(() =>
  fitted.value
    ? {}
    : {
        transform: `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`,
        maxWidth: 'none',
        maxHeight: 'none',
      },
)

function onImgLoad() {
  const el = imgEl.value
  if (el && el.naturalWidth > 0) natural.value = { w: el.naturalWidth, h: el.naturalHeight }
}

// Fit = về thang mặc định (ảnh chứa trọn trong khung).
type ZoomAction = 'out' | 'fit' | 'in'
const zoomOptions = computed(() => [
  { id: 'out' as const, label: t('workbench.img.zoomOut'), title: t('workbench.img.zoomOut') },
  { id: 'fit' as const, label: t('workbench.img.fit'), title: t('workbench.img.fit') },
  { id: 'in' as const, label: t('workbench.img.zoomIn'), title: t('workbench.img.zoomIn') },
])
function onZoomAction(a: ZoomAction) {
  if (a === 'fit') reset()
  else zoomBy(a === 'in' ? 0.2 : -0.2)
}

onMounted(() => {
  void wbDocs.ensureFile(props.doc)
})
</script>
