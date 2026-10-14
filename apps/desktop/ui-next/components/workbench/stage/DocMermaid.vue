<template>
  <!-- Doc 'mmd' — file .mmd/.mermaid: seg Sơ đồ (MermaidView render trực tiếp từ
       nội dung đang sửa, kể cả chưa lưu) / Mã nguồn (Monaco editable, ⌘S ghi).
       Preview theo `st.content` nên sửa source đổi ngay hình. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-[var(--bgEl)]"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="sizeLabel" class="flex-none text-[var(--textFaint)]">· {{ sizeLabel }}</span>
      <DocReloadButton class="ml-auto" :doc="props.doc" @reloaded="onReloaded" />
      <DocButtonGroup :options="modeOptions" :active="mode" @select="mode = $event" />
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
    <template v-else>
      <div
        v-show="mode === 'diagram'"
        class="diagram flex min-h-0 flex-1 flex-col overflow-hidden p-3"
      >
        <MermaidView :code="st.content" />
      </div>
      <div v-show="mode === 'source'" class="min-h-0 flex-1 overflow-hidden">
        <MonacoEditor
          ref="edRef"
          :path="props.doc.id"
          @ready="onReady"
          @change="(p) => wbDocs.markEdit(props.doc, p.value)"
          @save="void wbDocs.saveFile(props.doc)"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import MonacoEditor from '~/components/common/MonacoEditor.vue'
import MermaidView from '~/components/common/MermaidView.vue'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'
import DocButtonGroup from '~/components/workbench/stage/DocButtonGroup.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const st = wbDocs.fileStateOf(props.doc)
const rel = computed(() => wbDocs.relPathOf(props.doc))
const mode = ref<'diagram' | 'source'>('diagram')
const modeOptions = computed(() => [
  { id: 'diagram' as const, label: t('workbench.mmd.diagram') },
  { id: 'source' as const, label: t('workbench.mmd.source') },
])

const sizeLabel = computed(() => {
  if (st.status !== 'ok') return ''
  const lines = st.content === '' ? 0 : st.content.split('\n').length
  return t('workbench.file.lines', { n: lines })
})

const edRef = useTemplateRef<MonacoEditorHandle>('edRef')
let ready = false

onMounted(() => {
  void wbDocs.ensureFile(props.doc).then(() => {
    if (ready && st.status === 'ok') {
      edRef.value?.openFile(props.doc.id, st.content, 'markdown')
    }
  })
})

function onReady() {
  ready = true
  if (st.status === 'ok') {
    edRef.value?.openFile(props.doc.id, st.content, 'markdown')
  }
}

// Nạp lại từ đĩa xong: sơ đồ tự vẽ lại từ st.content; model Monaco đẩy tay.
function onReloaded() {
  edRef.value?.setValue(props.doc.id, st.content)
}
</script>

<style scoped>
/* MermaidView root (.mmd) fill khung diagram — :deep() cho lib con, Tailwind
   không emit được nên scoped còn lại. */
.diagram :deep(.mmd) {
  flex: 1;
  min-height: 0;
  height: auto;
}
</style>
