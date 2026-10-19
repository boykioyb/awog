<template>
  <!-- Doc 'office' — Word / Excel (.docx/.xlsx…) đọc-chỉ: bytes qua fs.readFileBase64 (cap
       phía sidecar), parse bằng utils/office-* rồi vẽ bằng ĐÚNG view của PreviewModal
       (OfficeDocView / OfficeSheetView) — không có trình xem Office thứ hai. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-[var(--bgEl)]"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="st.byteSize" class="flex-none text-[var(--textFaint)]">
        · {{ formatBytes(st.byteSize) }}
      </span>
      <span v-if="office.truncated.value" class="flex-none text-warning">
        · {{ t('workbench.file.truncated') }}
      </span>
      <DocReloadButton class="ml-auto" :doc="props.doc" />
      <Button
        variant="ghost"
        size="iconSm"
        :title="t('workbench.office.openExternal')"
        :aria-label="t('workbench.office.openExternal')"
        @click="openExternal"
      >
        <Icon name="external" />
      </Button>
    </div>
    <div
      v-if="st.status === 'loading' || st.status === 'idle' || parsing"
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
      v-else-if="st.truncated || !st.base64"
      class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.office.tooLarge', { size: st.byteSize ? formatBytes(st.byteSize) : '—' }) }}
    </div>
    <div
      v-else-if="parseFailed"
      class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-[var(--textFaint)]"
    >
      {{ t('common.preview.officeError') }}
    </div>
    <div
      v-else-if="office.isEmpty.value"
      class="grid min-h-0 flex-1 place-items-center p-5 text-center text-sm text-[var(--textFaint)]"
    >
      {{ t('common.preview.officeEmpty') }}
    </div>
    <div v-else-if="kind === 'sheet' && office.sheet.value" class="relative min-h-0 flex-1">
      <!-- OfficeSheetView cần một hộp có chiều cao xác định cho chuỗi height:100%. -->
      <div class="absolute inset-0">
        <OfficeSheetView :office="office" />
      </div>
    </div>
    <div v-else-if="office.doc.value" class="min-h-0 flex-1 overflow-auto">
      <OfficeDocView :doc="office.doc.value" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { OFFICE_EXT, useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useOfficePreview } from '~/composables/useOfficePreview'
import { useSidecar } from '~/composables/useSidecar'
import { base64ToBytes } from '~/utils/office-zip'
import { formatBytes } from '~/utils/format-bytes'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'
import OfficeDocView from '~/components/common/OfficeDocView.vue'
import OfficeSheetView from '~/components/common/OfficeSheetView.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const sc = useSidecar()
const st = wbDocs.fileStateOf(props.doc)
const rel = computed(() => wbDocs.relPathOf(props.doc))
const kind = computed(() => OFFICE_EXT[rel.value.split('.').pop()?.toLowerCase() ?? ''] ?? 'doc')

const office = useOfficePreview()
const parsing = ref(false)
const parseFailed = ref(false)

// Parse lại mỗi khi bytes đổi (mở lần đầu, hoặc bấm nạp lại sau khi file đổi trên đĩa).
// `seq` bỏ kết quả parse cũ về muộn hơn lần nạp mới.
let seq = 0
async function parseCurrent(): Promise<void> {
  const mine = ++seq
  parseFailed.value = false
  if (st.status !== 'ok' || st.truncated || !st.base64) {
    office.reset()
    return
  }
  parsing.value = true
  const ok = await office.parse(kind.value, base64ToBytes(st.base64))
  if (mine !== seq) return
  parsing.value = false
  parseFailed.value = !ok
}

onMounted(async () => {
  await wbDocs.ensureFile(props.doc)
  // Tab mở từ trước khi có trình xem Office đã được nạp theo kiểu TEXT (cache ghi
  // isBinary, không có bytes) ⇒ ensureFile trả cache cũ. Nạp lại một lần theo đường base64.
  if (st.status === 'ok' && !st.base64 && !st.truncated) await wbDocs.reloadFile(props.doc)
})
watch(
  () => [st.status, st.base64] as const,
  () => void parseCurrent(),
  { immediate: true },
)

function openExternal(): void {
  const root = st.root || wbDocs.rootFor(props.doc)
  if (root) void sc.openFileExternal(root, rel.value).catch(() => {})
}
</script>
