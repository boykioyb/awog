<template>
  <LibraryEntityModal :open="open" :title="t('infra.export.title')" :width="640" @close="onClose">
    <div class="flex flex-col gap-4">
      <p v-if="!profiles.length" class="m-0 text-xs text-dim">{{ t('infra.export.pick.empty') }}</p>

      <template v-else>
        <!-- Hai tab: xuất ra file (cấu hình / kèm khoá) và lệnh aws configure tương
             đương — hai luồng độc lập, không chia sẻ trạng thái ngoài danh sách
             profile của trang. -->
        <Tabs
          :model-value="tab"
          @update:model-value="
            (v: string | number) => (tab = v === 'commands' ? 'commands' : 'file')
          "
        >
          <TabsList class="h-ctrl-sm">
            <TabsTrigger value="file">
              <Icon name="save" />
              {{ t('infra.export.tab.file') }}
            </TabsTrigger>
            <TabsTrigger value="commands">
              <Icon name="terminal" />
              {{ t('infra.export.tab.commands') }}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <!-- ── Tab: xuất ra file ─────────────────────────────────────────── -->
        <template v-if="tab === 'file'">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>{{ t('infra.export.pick.label') }}</span>
              <Button
                type="button"
                variant="link"
                size="xs"
                class="h-auto p-0 font-semibold"
                @click="toggleAll"
              >
                {{ allChecked ? t('infra.export.pick.none') : t('infra.export.pick.all') }}
              </Button>
            </div>
            <ul class="m-0 flex max-h-45 list-none flex-col overflow-y-auto rounded-md border p-0">
              <li v-for="p in profiles" :key="p.name" class="border-b last:border-b-0">
                <label
                  class="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm text-foreground"
                >
                  <Checkbox
                    :model-value="checked.has(p.name)"
                    @update:model-value="toggle(p.name)"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
                  <span class="text-xs text-dim">{{ p.kind }}</span>
                </label>
              </li>
            </ul>
          </div>

          <label
            class="inline-flex cursor-pointer items-center gap-2 self-start text-sm text-foreground"
          >
            <Switch :checked="includeSecrets" @update:checked="includeSecrets = $event" />
            <span>{{ t('infra.export.secrets.toggle') }}</span>
          </label>

          <!-- Cảnh báo — hiện đúng MỘT LẦN khi công tắc đang bật, không lặp lại
               dưới dạng toast mỗi lần người dùng thao tác. -->
          <Alert
            v-if="includeSecrets"
            variant="destructive"
            class="border-destructive/40 bg-destructive/10"
          >
            <Icon name="alert" />
            <AlertTitle class="font-semibold">
              {{ t('infra.export.secrets.warningTitle') }}
            </AlertTitle>
            <AlertDescription class="text-foreground">
              <p>{{ t('infra.export.secrets.warning') }}</p>
            </AlertDescription>
          </Alert>

          <div v-if="includeSecrets" class="flex flex-col gap-1.5">
            <Label class="text-xs font-semibold text-foreground" for="axp-confirm">
              {{ t('infra.export.secrets.confirmLabel') }}
            </Label>
            <Input
              id="axp-confirm"
              v-model="confirmName"
              :placeholder="t('infra.export.secrets.confirmPh')"
              :disabled="!selectedNames.length"
              spellcheck="false"
              autocomplete="off"
            />
            <div class="text-xs text-dim">
              {{
                selectedNames.length
                  ? t('infra.export.secrets.confirmHint', { names: selectedNames.join(', ') })
                  : t('infra.export.secrets.confirmHintEmpty')
              }}
            </div>
            <div class="text-xs text-dim">{{ t('infra.export.secrets.chmodNote') }}</div>
          </div>

          <!-- Xem trước chỉ có ở chế độ KHÔNG khoá — bất biến #2 của mốc: nội dung
               có khoá không bao giờ hiện lên màn hình. -->
          <div v-else class="flex flex-col gap-2">
            <div class="text-xs font-semibold text-foreground">
              {{ t('infra.export.preview.label') }}
            </div>
            <p v-if="previewError" class="m-0 text-xs text-destructive">{{ previewError }}</p>
            <p v-else-if="!selectedNames.length" class="m-0 text-xs text-dim">
              {{ t('infra.export.preview.none') }}
            </p>
            <!-- mono-ok: nội dung file INI, người dùng copy vào file thật -->
            <pre
              v-else
              class="m-0 max-h-55 overflow-y-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm wrap-anywhere whitespace-pre-wrap text-foreground"
              >{{ preview }}</pre
            >
          </div>

          <div class="flex items-center gap-2">
            <span class="flex-1" />
            <Button
              v-if="!includeSecrets"
              type="button"
              :disabled="!preview"
              variant="outline"
              @click="onCopyConfig"
            >
              <Icon name="copy" class="size-3.5" />
              {{ t('common.copy') }}
            </Button>
            <Button
              type="button"
              :disabled="!canExportFile"
              :title="saveTitle"
              variant="default"
              @click="onSaveFile"
            >
              <Icon name="save" class="size-3.5" />
              {{ t('infra.export.saveToFile') }}
            </Button>
          </div>
        </template>

        <!-- ── Tab: lệnh tương đương ─────────────────────────────────────── -->
        <template v-else>
          <div class="flex flex-col gap-1.5">
            <Label class="text-xs font-semibold text-foreground">
              {{ t('infra.export.commands.pick') }}
            </Label>
            <AppSelect v-model="commandsProfile" :options="profileOptions" width="100%" />
          </div>
          <p class="m-0 text-xs text-dim">{{ t('infra.export.commands.hint') }}</p>
          <div class="flex flex-col gap-2">
            <p v-if="commandsError" class="m-0 text-xs text-destructive">{{ commandsError }}</p>
            <p v-else-if="commandsLoading" class="m-0 text-xs text-dim">
              {{ t('common.loading') }}
            </p>
            <p v-else-if="!commandsList.length" class="m-0 text-xs text-dim">
              {{ t('infra.export.commands.empty') }}
            </p>
            <!-- mono-ok: lệnh shell tương đương, người dùng copy vào terminal -->
            <pre
              v-else
              class="m-0 max-h-55 overflow-y-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm wrap-anywhere whitespace-pre-wrap text-foreground"
              >{{ commandsText }}</pre
            >
          </div>
          <div class="flex items-center gap-2">
            <span class="flex-1" />
            <Button
              type="button"
              :disabled="!commandsList.length"
              variant="default"
              @click="onCopyCommands"
            >
              <Icon name="copy" class="size-3.5" />
              {{ t('common.copy') }}
            </Button>
          </div>
        </template>
      </template>
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button type="button" variant="outline" @click="onClose">{{ t('common.close') }}</Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
