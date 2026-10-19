<template>
  <!-- Doc 'file' — editor code (Monaco) cho một file workspace. Một instance
       Monaco per doc (KeepAlive giữ model + undo + cursor); nội dung + cờ dirty
       chia sẻ qua useWorkbenchDocs nên tab hiện ● đúng và DocMd cùng file thấy
       edit kịp thời. File .html/.htm có thêm chế độ "Xem trước": iframe sandbox
       (opaque origin) nạp qua scheme wspreview:// của Electron main để css/js/img
       tương đối chạy như trong trình duyệt. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-[var(--bgEl)]"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="sizeLabel" class="flex-none text-[var(--textFaint)]">· {{ sizeLabel }}</span>
      <span v-if="st.truncated" class="flex-none text-warning">
        · {{ t('workbench.file.truncated') }}
      </span>
      <DocReloadButton class="ml-auto" :doc="props.doc" @reloaded="onReloaded" />
      <DocButtonGroup
        v-if="isTable"
        :options="tableModeOptions"
        :active="tableMode"
        @select="(m) => (tableMode = m)"
      />
      <template v-if="isHtml">
        <DocButtonGroup :options="modeOptions" :active="mode" @select="setMode" />
        <button
          class="flex-none rounded p-1.5 text-dim transition hover:bg-[var(--bgHover)] hover:text-[var(--text)]"
          type="button"
          :title="t('workbench.file.openInBrowser')"
          @click="openInBrowser"
        >
          <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </template>
    </div>
    <template v-if="isHtml && mode === 'preview'">
      <div
        v-if="!previewSrc"
        class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-[var(--textFaint)]"
      >
        {{ previewFailed ? t('workbench.file.previewDesktopOnly') : t('workbench.file.loading') }}
      </div>
      <!-- sandbox KHÔNG có allow-same-origin: trang chạy ở origin mờ, JS của nó không
           với tới app. Nền trắng = nền mặc định của trình duyệt cho trang không đặt nền. -->
      <iframe
        v-else
        :key="previewSrc"
        :src="previewSrc"
        sandbox="allow-scripts allow-popups allow-forms allow-modals"
        class="min-h-0 w-full flex-1 border-0 bg-white"
        :title="rel"
      />
    </template>
    <!-- CSV/TSV: xem dạng bảng bằng lưới Excel dùng chung (OfficeSheetView). Bảng dựng
         từ nội dung ĐANG sửa (st.content) nên sửa ở Mã nguồn rồi quay lại là thấy ngay. -->
    <div
      v-else-if="isTable && tableMode === 'table' && st.status === 'ok' && !st.isBinary"
      class="relative min-h-0 flex-1"
    >
      <div class="absolute inset-0">
        <OfficeSheetView :office="tableView" />
      </div>
    </div>
    <div
      v-else-if="st.status === 'loading' || st.status === 'idle'"
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
      v-else-if="st.isBinary"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.file.binary') }}
    </div>
    <MonacoEditor
      v-else
      ref="edRef"
      :path="props.doc.id"
      @ready="onReady"
      @change="(p) => wbDocs.markEdit(props.doc, p.value)"
      @save="void wbDocs.saveFile(props.doc)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { htmlPreviewUrl, isHtmlPath } from '~/composables/usePreview'
import { useSidecar } from '~/composables/useSidecar'
import { formatBytes } from '~/utils/format-bytes'
import MonacoEditor from '~/components/common/MonacoEditor.vue'
import OfficeSheetView from '~/components/common/OfficeSheetView.vue'
import { useOfficePreview } from '~/composables/useOfficePreview'
import { parseCsv } from '~/utils/office-csv'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'
import DocButtonGroup from '~/components/workbench/stage/DocButtonGroup.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const st = wbDocs.fileStateOf(props.doc)
const rel = computed(() => wbDocs.relPathOf(props.doc))

// Cỡ byte thật chỉ có từ readFileBase64 — với text doc hiển thị số dòng thay
// cho kích thước không đo được (vbar vẫn có metadata hữu dụng).
const sizeLabel = computed(() => {
  if (st.isBinary) return st.byteSize > 0 ? formatBytes(st.byteSize) : ''
  if (st.status !== 'ok') return ''
  const lines = st.content === '' ? 0 : st.content.split('\n').length
  return t('workbench.file.lines', { n: lines })
})

const edRef = useTemplateRef<MonacoEditorHandle>('edRef')
let ready = false

onMounted(() => {
  void wbDocs.ensureFile(props.doc).then(() => {
    if (ready && st.status === 'ok' && !st.isBinary) {
      edRef.value?.openFile(props.doc.id, st.content, st.language)
    }
  })
})

function onReady() {
  ready = true
  if (st.status === 'ok' && !st.isBinary) {
    edRef.value?.openFile(props.doc.id, st.content, st.language)
  }
}

// Nạp lại từ đĩa xong: đẩy nội dung mới vào model Monaco (setValue không phát
// change ⇒ cờ dirty giữ đúng) và nạp lại iframe xem trước HTML.
function onReloaded() {
  edRef.value?.setValue(props.doc.id, st.content)
  previewVersion.value++
}

// ── Chế độ HTML: Xem trước | Mã nguồn (nhớ theo doc khi tab còn mở) ──────────
type FileMode = 'preview' | 'code'
const mode = ref<FileMode>('preview')
const modeOptions = computed(() => [
  { id: 'preview' as const, label: t('workbench.file.modePreview') },
  { id: 'code' as const, label: t('workbench.file.modeCode') },
])
const isHtml = computed(() => isHtmlPath(rel.value))
const sc = useSidecar()

const previewSrc = ref('')
const previewFailed = ref(false)
const previewVersion = ref(0)

async function resolvePreview(): Promise<void> {
  const root = st.root || wbDocs.rootFor(props.doc)
  if (!root) return
  try {
    const url = await htmlPreviewUrl(root, rel.value, previewVersion.value)
    previewFailed.value = url === null
    previewSrc.value = url ?? ''
  } catch {
    previewFailed.value = true
    previewSrc.value = ''
  }
}

// Chỉ nạp khi thật sự đang xem trước; đổi version (nạp lại từ đĩa / quay lại từ
// code, lúc đó file đã được lưu ra đĩa) sinh URL mới nên iframe nạp lại bản mới nhất.
watch(
  [isHtml, mode, previewVersion],
  () => {
    if (isHtml.value && mode.value === 'preview') void resolvePreview()
  },
  { immediate: true },
)

function setMode(next: FileMode) {
  if (next === mode.value) return
  mode.value = next
  if (next === 'preview') previewVersion.value++
}

// ── CSV/TSV: Bảng | Mã nguồn (mặc định Bảng) ─────────────────────────────────
type TableMode = 'table' | 'code'
const isTable = computed(() => /\.(csv|tsv)$/i.test(rel.value))
const tableMode = ref<TableMode>('table')
const tableModeOptions = computed(() => [
  { id: 'table' as const, label: t('workbench.file.modeTable') },
  { id: 'code' as const, label: t('workbench.file.modeCode') },
])
const tableView = useOfficePreview()
// Dựng lại bảng khi đang xem Bảng và nội dung đổi (nạp xong / nạp lại / sửa ở Mã nguồn).
watch(
  [isTable, tableMode, () => st.content, () => st.status],
  () => {
    if (!isTable.value || tableMode.value !== 'table' || st.status !== 'ok') return
    const name = rel.value.split('/').pop() ?? rel.value
    tableView.load(parseCsv(st.content, name, /\.tsv$/i.test(rel.value) ? '\t' : undefined))
  },
  { immediate: true },
)

function openInBrowser() {
  const root = st.root || wbDocs.rootFor(props.doc)
  if (root) void sc.openFileExternal(root, rel.value).catch(() => {})
}
</script>
