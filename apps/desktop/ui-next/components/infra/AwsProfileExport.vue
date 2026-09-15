<template>
  <LibraryEntityModal :open="open" :title="t('infra.export.title')" :width="640" @close="onClose">
    <div class="axp">
      <p v-if="!profiles.length" class="axp-hint">{{ t('infra.export.pick.empty') }}</p>

      <template v-else>
        <!-- Hai tab: xuất ra file (cấu hình / kèm khoá) và lệnh aws configure tương
             đương — hai luồng độc lập, không chia sẻ trạng thái ngoài danh sách
             profile của trang. -->
        <div class="axp-tabs" role="tablist">
          <button
            type="button"
            class="axp-tab"
            :class="{ on: tab === 'file' }"
            role="tab"
            :aria-selected="tab === 'file'"
            @click="tab = 'file'"
          >
            <Icon name="save" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ t('infra.export.tab.file') }}
          </button>
          <button
            type="button"
            class="axp-tab"
            :class="{ on: tab === 'commands' }"
            role="tab"
            :aria-selected="tab === 'commands'"
            @click="tab = 'commands'"
          >
            <Icon name="terminal" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ t('infra.export.tab.commands') }}
          </button>
        </div>

        <!-- ── Tab: xuất ra file ─────────────────────────────────────────── -->
        <template v-if="tab === 'file'">
          <div class="axp-section">
            <div class="axp-section-label">
              <span>{{ t('infra.export.pick.label') }}</span>
              <button type="button" class="axp-linkbtn" @click="toggleAll">
                {{ allChecked ? t('infra.export.pick.none') : t('infra.export.pick.all') }}
              </button>
            </div>
            <ul class="axp-picklist">
              <li v-for="p in profiles" :key="p.name" class="axp-pickrow">
                <label class="axp-check">
                  <input type="checkbox" :checked="checked.has(p.name)" @change="toggle(p.name)" />
                  <span class="axp-pickname">{{ p.name }}</span>
                  <span class="axp-pickkind">{{ p.kind }}</span>
                </label>
              </li>
            </ul>
          </div>

          <button
            type="button"
            class="axp-toggle"
            :aria-pressed="includeSecrets"
            @click="includeSecrets = !includeSecrets"
          >
            <span class="tog2" :class="{ off: !includeSecrets }" />
            <span>{{ t('infra.export.secrets.toggle') }}</span>
          </button>

          <!-- Cảnh báo — hiện đúng MỘT LẦN khi công tắc đang bật, không lặp lại
               dưới dạng toast mỗi lần người dùng thao tác. -->
          <div v-if="includeSecrets" class="axp-warn">
            <Icon
              name="alert"
              style="width: var(--icon-md); height: var(--icon-md); color: var(--danger)"
            />
            <div class="axp-warn-body">
              <div class="axp-warn-title">{{ t('infra.export.secrets.warningTitle') }}</div>
              <p>{{ t('infra.export.secrets.warning') }}</p>
            </div>
          </div>

          <div v-if="includeSecrets" class="axp-field">
            <label class="axp-label" for="axp-confirm">
              {{ t('infra.export.secrets.confirmLabel') }}
            </label>
            <input
              id="axp-confirm"
              v-model="confirmName"
              class="axp-input"
              :placeholder="t('infra.export.secrets.confirmPh')"
              :disabled="!selectedNames.length"
              spellcheck="false"
              autocomplete="off"
            />
            <div class="axp-hint">
              {{
                selectedNames.length
                  ? t('infra.export.secrets.confirmHint', { names: selectedNames.join(', ') })
                  : t('infra.export.secrets.confirmHintEmpty')
              }}
            </div>
            <div class="axp-hint">{{ t('infra.export.secrets.chmodNote') }}</div>
          </div>

          <!-- Xem trước chỉ có ở chế độ KHÔNG khoá — bất biến #2 của mốc: nội dung
               có khoá không bao giờ hiện lên màn hình. -->
          <div v-else class="axp-section">
            <div class="axp-section-label">
              <span>{{ t('infra.export.preview.label') }}</span>
            </div>
            <p v-if="previewError" class="axp-hint axp-hint-error">{{ previewError }}</p>
            <p v-else-if="!selectedNames.length" class="axp-hint">
              {{ t('infra.export.preview.none') }}
            </p>
            <!-- mono-ok: nội dung file INI, người dùng copy vào file thật -->
            <pre v-else class="axp-preview">{{ preview }}</pre>
          </div>

          <div class="axp-actions">
            <span style="flex: 1" />
            <button
              v-if="!includeSecrets"
              type="button"
              class="btn"
              :disabled="!preview"
              @click="onCopyConfig"
            >
              <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.copy') }}
            </button>
            <button
              type="button"
              class="btn pri"
              :disabled="!canExportFile"
              :title="saveTitle"
              @click="onSaveFile"
            >
              <Icon name="save" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('infra.export.saveToFile') }}
            </button>
          </div>
        </template>

        <!-- ── Tab: lệnh tương đương ─────────────────────────────────────── -->
        <template v-else>
          <div class="axp-field">
            <label class="axp-label">{{ t('infra.export.commands.pick') }}</label>
            <AppSelect v-model="commandsProfile" :options="profileOptions" width="100%" />
          </div>
          <p class="axp-hint">{{ t('infra.export.commands.hint') }}</p>
          <div class="axp-section">
            <p v-if="commandsError" class="axp-hint axp-hint-error">{{ commandsError }}</p>
            <p v-else-if="commandsLoading" class="axp-hint">{{ t('common.loading') }}</p>
            <p v-else-if="!commandsList.length" class="axp-hint">
              {{ t('infra.export.commands.empty') }}
            </p>
            <!-- mono-ok: lệnh shell tương đương, người dùng copy vào terminal -->
            <pre v-else class="axp-preview-cmd">{{ commandsText }}</pre>
          </div>
          <div class="axp-actions">
            <span style="flex: 1" />
            <button
              type="button"
              class="btn pri"
              :disabled="!commandsList.length"
              @click="onCopyCommands"
            >
              <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
              {{ t('common.copy') }}
            </button>
          </div>
        </template>
      </template>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button type="button" class="btn" @click="onClose">{{ t('common.close') }}</button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// A6 — Xuất profile AWS (docs/features/aws-profile-manager.md §"Xuất").
//
// Hai luồng độc lập trong cùng một modal:
//   · Tab "Xuất ra file" — chọn nhiều profile qua checkbox, rồi HOẶC xuất cấu
//     hình (mặc định, không rào — xem trước + copy được) HOẶC bật "Gồm cả khoá"
//     (mặc định TẮT) để xuất kèm access key, lúc đó bắt buộc gõ lại đúng một tên
//     profile đã chọn để xác nhận, KHÔNG xem trước/copy nội dung có khoá — chỉ
//     ghi thẳng ra file qua dialog lưu native (sidecar tự `chmod 600`).
//   · Tab "Lệnh tương đương" — chọn một profile, sinh các dòng `aws configure
//     set …`; dòng khoá luôn là placeholder vì `profileExportCommands` không có
//     cách nào biết giá trị secret thật (sidecar vứt nó ngay trong vòng lặp đọc).
//
// Xuất không đổi danh sách profile ⇒ chỉ emit 'close', không có 'done'.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useAwsProfilesApi } from '~/composables/useAwsProfilesApi'
import { hasBridge, saveFilePath } from '~/composables/useFolderPicker'
import { useToast } from '~/composables/useToast'
import type { AwsProfile } from '~/types'

const props = defineProps<{
  open: boolean
  profiles: AwsProfile[]
  selected: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const toast = useToast()
const api = useAwsProfilesApi()

// Mã lỗi sidecar ném ra (đứng ở ĐẦU message) → câu tiếng người. Không khớp mã
// nào thì trả nguyên message (đường lùi cho lỗi hệ thống chưa lường trước).
function friendlyExportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (raw.startsWith('FORBIDDEN_TARGET')) return t('infra.export.err.forbiddenTarget')
  if (raw.startsWith('CONFIRM_REQUIRED')) return t('infra.export.err.confirmRequired')
  // Sidecar từ chối xuất kèm khoá mà không có đích ghi (luật cứng #5). UI luôn
  // gọi `saveFilePath()` trước nên người dùng không gặp mã này qua đường thường
  // — nó ở đây để một lần refactor làm hỏng thứ tự vẫn hiện ra câu tiếng người.
  if (raw.startsWith('TARGET_REQUIRED')) return t('infra.export.err.targetRequired')
  if (raw.startsWith('NO_PROFILES')) return t('infra.export.err.noProfiles')
  if (raw.startsWith('INVALID_NAME')) return t('infra.export.err.invalidName')
  return raw
}

const tab = ref<'file' | 'commands'>('file')

// ── chọn profile (dùng chung cho xem-trước và xuất-ra-file) ─────────────────
// Set<string> thay vì Record<string, boolean> — khớp mẫu SshImportPicker.vue,
// và tránh `noUncheckedIndexedAccess` biến mọi lần đọc `record[key]` thành
// `boolean | undefined`.
const checked = ref<Set<string>>(new Set())
const selectedNames = computed(() =>
  props.profiles.filter((p) => checked.value.has(p.name)).map((p) => p.name),
)
const allChecked = computed(
  () => props.profiles.length > 0 && props.profiles.every((p) => checked.value.has(p.name)),
)
function toggle(name: string): void {
  const next = new Set(checked.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  checked.value = next
}
function toggleAll(): void {
  checked.value = allChecked.value ? new Set() : new Set(props.profiles.map((p) => p.name))
}

// ── chế độ "gồm cả khoá" ─────────────────────────────────────────────────────
const includeSecrets = ref(false)
const confirmName = ref('')

// ── xem trước (chỉ chế độ không-khoá) ───────────────────────────────────────
const preview = ref('')
const previewError = ref('')
let previewSeq = 0

async function loadPreview(): Promise<void> {
  if (!selectedNames.value.length) {
    preview.value = ''
    previewError.value = ''
    return
  }
  const seq = ++previewSeq
  previewError.value = ''
  try {
    const res = await api.profileExport({
      names: selectedNames.value,
      includeSecrets: false,
    })
    if (seq !== previewSeq) return
    // `includeSecrets: false` ⇒ sidecar luôn đi nhánh `text` (không truyền đích).
    preview.value = 'text' in res ? res.text : ''
  } catch (err) {
    if (seq !== previewSeq) return
    preview.value = ''
    previewError.value = t('infra.export.preview.loadFailed', { error: friendlyExportError(err) })
  }
}

watch([selectedNames, includeSecrets, tab, () => props.open], () => {
  if (!props.open || tab.value !== 'file' || includeSecrets.value) return
  void loadPreview()
})

// ── xuất ra file ─────────────────────────────────────────────────────────────
const saving = ref(false)

const canExportFile = computed(() => {
  if (saving.value || !selectedNames.value.length) return false
  if (!includeSecrets.value) return true
  const c = confirmName.value.trim()
  return c !== '' && selectedNames.value.includes(c)
})

const saveTitle = computed(() => (hasBridge() ? '' : t('infra.export.noBridge')))

async function onCopyConfig(): Promise<void> {
  if (!preview.value) return
  try {
    await navigator.clipboard.writeText(preview.value)
    toast.add({ title: t('infra.export.copied'), color: 'success' })
  } catch {
    toast.add({ title: t('infra.export.copyFailed'), color: 'error' })
  }
}

async function onSaveFile(): Promise<void> {
  if (!canExportFile.value) return
  if (!hasBridge()) {
    toast.add({ title: t('infra.export.noBridge'), color: 'warning' })
    return
  }
  const defaultName =
    selectedNames.value.length === 1 ? `${selectedNames.value[0]}.ini` : 'aws-profiles-export.ini'
  const path = await saveFilePath({
    title: t('infra.export.saveDialogTitle'),
    defaultPath: defaultName,
    filters: [{ name: 'INI', extensions: ['ini', 'txt'] }],
  })
  if (!path) return // người dùng bấm Cancel trên dialog hệ điều hành

  saving.value = true
  try {
    const res = await api.profileExport({
      names: selectedNames.value,
      includeSecrets: includeSecrets.value,
      ...(includeSecrets.value ? { confirmName: confirmName.value.trim() } : {}),
      targetPath: path,
    })
    // Luôn có `targetPath` ở nhánh này ⇒ sidecar luôn trả `path`.
    const savedPath = 'path' in res ? res.path : path
    toast.add({ title: t('infra.export.saved', { path: savedPath }), color: 'success' })
    if (includeSecrets.value) {
      // Xong việc rủi ro nhất của cả họ tính năng — tắt lại công tắc + xoá ô gõ
      // xác nhận thay vì để nó nằm sẵn sàng cho một lần bấm nhầm tiếp theo.
      includeSecrets.value = false
      confirmName.value = ''
    }
  } catch (err) {
    toast.add({
      title: t('infra.export.saveFailed', { error: friendlyExportError(err) }),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

// ── lệnh tương đương ─────────────────────────────────────────────────────────
const commandsProfile = ref('')
const commandsList = ref<string[]>([])
const commandsError = ref('')
const commandsLoading = ref(false)
let commandsSeq = 0

const profileOptions = computed<AppSelectOption[]>(() =>
  props.profiles.map((p) => ({ label: p.name, value: p.name })),
)
const commandsText = computed(() => commandsList.value.join('\n'))

async function loadCommands(): Promise<void> {
  const name = commandsProfile.value
  if (!name) {
    commandsList.value = []
    commandsError.value = ''
    return
  }
  const seq = ++commandsSeq
  commandsLoading.value = true
  commandsError.value = ''
  try {
    const res = await api.profileExportCommands(name)
    if (seq !== commandsSeq) return
    commandsList.value = res.commands
  } catch (err) {
    if (seq !== commandsSeq) return
    commandsList.value = []
    commandsError.value = t('infra.export.commands.loadFailed', {
      error: friendlyExportError(err),
    })
  } finally {
    if (seq === commandsSeq) commandsLoading.value = false
  }
}

watch([commandsProfile, tab, () => props.open], () => {
  if (!props.open || tab.value !== 'commands') return
  void loadCommands()
})

async function onCopyCommands(): Promise<void> {
  if (!commandsText.value) return
  try {
    await navigator.clipboard.writeText(commandsText.value)
    toast.add({ title: t('infra.export.copied'), color: 'success' })
  } catch {
    toast.add({ title: t('infra.export.copyFailed'), color: 'error' })
  }
}

// ── mở/đóng ──────────────────────────────────────────────────────────────────
function onClose(): void {
  emit('close')
}

// Reset toàn bộ trạng thái mỗi lần modal mở — kể cả `confirmName`, dù nó không
// phải secret, để không ai thấy lại ô xác nhận đã gõ của lượt xuất trước.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    tab.value = 'file'
    includeSecrets.value = false
    confirmName.value = ''
    preview.value = ''
    previewError.value = ''
    commandsError.value = ''
    commandsList.value = []
    checked.value = props.selected ? new Set([props.selected]) : new Set()
    commandsProfile.value = props.selected || props.profiles[0]?.name || ''
  },
)
</script>

<style scoped>
.axp {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.axp-tabs {
  display: inline-flex;
  gap: 4px;
}
.axp-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  cursor: pointer;
}
.axp-tab:hover {
  color: var(--text);
  border-color: var(--borderStrong);
}
.axp-tab.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}

.axp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.axp-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.axp-linkbtn {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  cursor: pointer;
}
.axp-linkbtn:hover {
  text-decoration: underline;
}

.axp-picklist {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.axp-pickrow {
  border-bottom: 1px solid var(--border);
}
.axp-pickrow:last-child {
  border-bottom: none;
}
.axp-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.axp-check input[type='checkbox'] {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  accent-color: var(--accent);
}
.axp-pickname {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.axp-pickkind {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.axp-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.axp-hint-error {
  color: var(--danger);
}

/* Toggle "gồm cả khoá" — dùng chung switch `.tog2` toàn cục (SshEditor.vue đã
   đặt tiền lệ), không định nghĩa lại. */
.axp-toggle {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}

.axp-warn {
  display: flex;
  gap: 10px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--dangerBg);
  border: 1px solid var(--dangerBorder);
}
.axp-warn-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.axp-warn-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
  color: var(--danger);
}
.axp-warn-body p {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--text);
}

.axp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.axp-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.axp-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.axp-input:focus {
  border-color: var(--accent);
}
.axp-input:disabled {
  opacity: 0.6;
}

.axp-preview,
.axp-preview-cmd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--text);
}
.axp-preview {
  /* mono-ok: nội dung file INI, người dùng copy vào file thật */
  font-family: var(--code);
}
.axp-preview-cmd {
  /* mono-ok: lệnh shell tương đương, người dùng copy vào terminal */
  font-family: var(--code);
}

.axp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
