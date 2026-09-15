<template>
  <LibraryEntityModal
    :open="open"
    :title="t('infra.import.file.title')"
    :width="680"
    :lock-scrim="busy"
    @close="onClose"
  >
    <div class="api">
      <!-- Bước 1: chọn nguồn (dán khối / file / CSV) — tách riêng, xem file đó. -->
      <AwsProfileImportSourceStep
        v-if="step === 'source'"
        v-model:source-kind="sourceKind"
        v-model:paste-text="pasteText"
        v-model:file-path="filePath"
        v-model:csv-path="csvPath"
      />

      <!-- Bước 2: xem trước — KHÔNG gì chạm đĩa trước bước này. -->
      <AwsProfileImportPreviewStep
        v-else-if="step === 'preview'"
        :rows="rows"
        :warnings="previewWarnings"
        :duplicate-names="duplicateToNames"
        @set-mode="setMode"
        @set-to="setTo"
      />

      <!-- Bước 3: kết quả. -->
      <div v-else class="api-result">
        <Icon
          name="check"
          style="width: var(--icon-lg); height: var(--icon-lg); color: var(--green)"
        />
        <div class="api-result-title">{{ t('infra.import.file.result.title') }}</div>
        <div class="api-result-line">
          {{ t('infra.import.file.result.created', { n: applyResult?.created.length ?? 0 }) }}
        </div>
        <div class="api-result-line">
          {{
            t('infra.import.file.result.overwritten', {
              n: applyResult?.overwritten.length ?? 0,
            })
          }}
        </div>
        <div class="api-result-line">
          {{ t('infra.import.file.result.skipped', { n: applyResult?.skipped.length ?? 0 }) }}
        </div>
        <div v-if="applyResult && applyResult.backups.length > 0" class="api-hint">
          {{ t('infra.import.backupsNote', { n: applyResult.backups.length }) }}
        </div>
        <div v-if="applyResult && applyResult.warnings.length > 0" class="api-warnbox">
          <div v-for="(w, i) in applyResult.warnings" :key="i">{{ w }}</div>
        </div>
      </div>

      <div v-if="errorMsg && step !== 'result'" class="api-error">{{ errorMsg }}</div>
    </div>

    <template #footer>
      <span v-if="step === 'preview'" class="api-count">
        {{ t('infra.import.file.preview.selectedCount', { n: selectedCount }) }}
      </span>
      <span style="flex: 1" />
      <template v-if="step === 'source'">
        <button class="btn" type="button" @click="onClose">{{ t('common.cancel') }}</button>
        <button
          class="btn pri"
          type="button"
          :disabled="!canPreview || previewing"
          @click="onPreview"
        >
          {{
            previewing ? t('infra.import.file.previewing') : t('infra.import.file.previewAction')
          }}
        </button>
      </template>
      <template v-else-if="step === 'preview'">
        <button class="btn" type="button" :disabled="applying" @click="step = 'source'">
          {{ t('common.back') }}
        </button>
        <button
          class="btn pri"
          type="button"
          :disabled="!selectedCount || applying || hasInvalidRow"
          @click="onApply"
        >
          {{ applying ? t('infra.import.file.applying') : t('infra.import.file.apply') }}
        </button>
      </template>
      <template v-else>
        <button class="btn pri" type="button" @click="onDone">{{ t('common.close') }}</button>
      </template>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// A4 — Nhập profile: dán khối / file credentials-config / CSV của IAM console
// (docs/features/aws-profile-manager.md §Nhập). MỘT màn xem trước dùng chung cho
// cả ba nguồn — không gì chạm đĩa trước khi người dùng thấy bảng xem trước và bấm
// "Nhập" ở bước 2. Component ruột tự gọi useAwsProfilesApi() và chỉ emit('done')
// SAU KHI profileImportApply xong (xem comment đầu useInfraPage.ts).
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AwsProfileImportPreviewStep, {
  type ImportRow,
  type ImportRowMode,
} from '~/components/infra/AwsProfileImportPreviewStep.vue'
import AwsProfileImportSourceStep from '~/components/infra/AwsProfileImportSourceStep.vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import type {
  AwsProfileImportApplyResult,
  AwsProfileImportPreviewParams,
  AwsProfileImportSelection,
  AwsProfileImportSource,
} from '~/composables/useAwsProfilesApi'
import type { AwsProfile } from '~/types'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'

// `profiles` không dùng trực tiếp ở đây — sidecar đã tính sẵn `entry.conflict`
// so với `~/.aws` hiện tại. Giữ prop vì hợp đồng của trang (pages/infra.vue)
// luôn truyền `allProfiles`, giống ba overlay còn lại.
const props = defineProps<{
  open: boolean
  profiles: AwsProfile[]
}>()

const emit = defineEmits<{ close: []; done: [] }>()

const { t } = useI18n()
const api = useAwsProfilesApi()

type Step = 'source' | 'preview' | 'result'

const step = ref<Step>('source')
const sourceKind = ref<AwsProfileImportSource>('paste')
const pasteText = ref('')
const filePath = ref('')
const csvPath = ref('')

const previewing = ref(false)
const applying = ref(false)
const errorMsg = ref('')
const previewWarnings = ref<string[]>([])
const rows = ref<ImportRow[]>([])
const applyResult = ref<AwsProfileImportApplyResult | null>(null)

// Đầu vào ĐÃ gửi cho preview — apply phải gửi lại NGUYÊN VĂN (source/text/path)
// kèm selections, vì sidecar đọc lại nguồn để lấy giá trị secret (đường xem
// trước không giữ chúng). Biến thường, không phải ref — không cần render.
let lastInput: AwsProfileImportPreviewParams | null = null

const busy = computed(() => previewing.value || applying.value)

const canPreview = computed(() => {
  if (sourceKind.value === 'paste') return pasteText.value.trim().length > 0
  if (sourceKind.value === 'file') return filePath.value.trim().length > 0
  return csvPath.value.trim().length > 0
})

function defaultMode(conflict: ImportRow['conflict']): ImportRowMode {
  return conflict === 'none' ? 'create' : 'skip'
}

function buildInput(): AwsProfileImportPreviewParams {
  if (sourceKind.value === 'paste') return { source: 'paste', text: pasteText.value }
  if (sourceKind.value === 'file') return { source: 'file', path: filePath.value.trim() }
  return { source: 'csv', path: csvPath.value.trim() }
}

// Tên đích đã resolve của mỗi hàng KHÔNG bị bỏ qua — dùng để phát hiện trùng
// trong CHÍNH lô này trước khi gửi apply (hai selection cùng `to` sẽ ghi đè lẫn
// nhau ở tầng dưới vì `existing` chỉ chụp MỘT lần trước vòng lặp).
const resolvedNames = computed<string[]>(() =>
  rows.value
    .filter((r) => r.mode !== 'skip')
    .map((r) => (r.mode === 'rename' ? r.to.trim() : r.name)),
)
const duplicateToNames = computed<Set<string>>(() => {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const name of resolvedNames.value) {
    if (seen.has(name)) dupes.add(name)
    seen.add(name)
  }
  return dupes
})

const hasInvalidRow = computed(() =>
  rows.value.some((row) => {
    if (row.mode !== 'rename') return false
    const to = row.to.trim()
    return !AWS_PROFILE_NAME_RE.test(to) || duplicateToNames.value.has(to)
  }),
)

const selectedCount = computed(() => rows.value.filter((r) => r.mode !== 'skip').length)

function setMode(name: string, mode: ImportRowMode): void {
  rows.value = rows.value.map((r) => (r.name === name ? { ...r, mode } : r))
}
function setTo(name: string, value: string): void {
  rows.value = rows.value.map((r) => (r.name === name ? { ...r, to: value } : r))
}

async function onPreview(): Promise<void> {
  if (!canPreview.value || previewing.value) return
  previewing.value = true
  errorMsg.value = ''
  try {
    const input = buildInput()
    const res = await api.profileImportPreview(input)
    lastInput = input
    previewWarnings.value = res.warnings
    rows.value = res.entries.map((entry) => ({
      ...entry,
      mode: defaultMode(entry.conflict),
      to: entry.name,
    }))
    step.value = 'preview'
  } catch (err) {
    console.error('[infra] profile import preview failed', err)
    errorMsg.value = errText(err)
  } finally {
    previewing.value = false
  }
}

function buildSelections(): AwsProfileImportSelection[] {
  const out: AwsProfileImportSelection[] = []
  for (const row of rows.value) {
    if (row.mode === 'skip') continue
    const to = row.mode === 'rename' ? row.to.trim() : row.name
    if (!to) continue
    out.push({ from: row.name, to, overwrite: row.mode === 'overwrite' })
  }
  return out
}

async function onApply(): Promise<void> {
  if (!lastInput || applying.value || hasInvalidRow.value) return
  const selections = buildSelections()
  if (!selections.length) return
  applying.value = true
  errorMsg.value = ''
  try {
    const res = await api.profileImportApply({ ...lastInput, selections })
    applyResult.value = res
    // Xoá sạch mọi giá trị đã dán/đường dẫn ngay khi ghi xong — luật cứng #2.
    pasteText.value = ''
    filePath.value = ''
    csvPath.value = ''
    lastInput = null
    step.value = 'result'
  } catch (err) {
    console.error('[infra] profile import apply failed', err)
    errorMsg.value = errText(err)
  } finally {
    applying.value = false
  }
}

function resetAll(): void {
  step.value = 'source'
  sourceKind.value = 'paste'
  pasteText.value = ''
  filePath.value = ''
  csvPath.value = ''
  previewing.value = false
  applying.value = false
  errorMsg.value = ''
  previewWarnings.value = []
  rows.value = []
  applyResult.value = null
  lastInput = null
}

// Đóng bằng scrim/Esc/nút Huỷ đều phải xoá sạch — không chỉ đường "Nhập xong".
function onClose(): void {
  resetAll()
  emit('close')
}
function onDone(): void {
  resetAll()
  emit('done')
}

// Mở lại từ đầu mỗi lần overlay bật, phòng lần trước đóng dở giữa chừng bằng Esc
// (LibraryEntityModal tự đóng khi Esc/scrim mà không đi qua onClose() ở trên).
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) resetAll()
  },
)

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<style scoped>
.api {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}
.api-error {
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--dangerDim);
  border: 1px solid var(--dangerBorder);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.api-warnbox {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.api-count {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.api-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 8px 8px;
  text-align: center;
}
.api-result-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
  margin-top: 4px;
}
.api-result-line {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
</style>
