<template>
  <div class="flex min-h-0 flex-col gap-2.5">
    <p class="m-0 text-sm text-dim">{{ t('infra.import.file.preview.subtitle') }}</p>

    <div
      v-if="warnings.length"
      class="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <div class="font-semibold">{{ t('infra.import.warnings.title') }}</div>
      <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
    </div>

    <div v-if="!rows.length" class="px-1 py-6 text-center text-sm text-muted-foreground">
      {{ t('infra.import.file.preview.empty') }}
    </div>

    <div v-else class="flex max-h-[46vh] flex-col overflow-y-auto rounded-lg border">
      <div
        class="grid grid-cols-[1.6fr_0.9fr_1.1fr_1.1fr_auto] items-center gap-2.5 bg-muted px-3 py-2 text-xs text-dim"
      >
        <span>{{ t('infra.import.file.preview.colName') }}</span>
        <span>{{ t('infra.import.file.preview.colKind') }}</span>
        <span>{{ t('infra.import.file.preview.colKeys') }}</span>
        <span>{{ t('infra.import.file.preview.colConflict') }}</span>
        <span>{{ t('infra.import.file.preview.colAction') }}</span>
      </div>

      <div v-for="row in rows" :key="row.name" class="border-t first:border-t-0">
        <div class="grid grid-cols-[1.6fr_0.9fr_1.1fr_1.1fr_auto] items-center gap-2.5 px-3 py-2">
          <!-- mono-ok: tên profile là identifier dùng ở `--profile` của CLI. -->
          <span
            class="min-w-0 truncate font-mono text-sm font-semibold text-foreground"
            :title="row.name"
          >
            {{ row.name }}
          </span>
          <span class="text-xs text-dim">{{ kindLabel(row.kind) }}</span>
          <span class="flex flex-wrap gap-1">
            <Badge v-if="row.hasStaticKeys" variant="secondary" class="rounded-sm font-normal">
              {{ t('infra.import.file.preview.hasStaticKeys') }}
            </Badge>
            <Badge v-if="row.hasSessionToken" variant="secondary" class="rounded-sm font-normal">
              {{ t('infra.import.file.preview.hasSessionToken') }}
            </Badge>
          </span>
          <span class="text-xs" :class="row.conflict !== 'none' ? 'text-warning' : 'text-dim'">
            {{ conflictLabel(row.conflict) }}
          </span>
          <AppSelect
            class="justify-self-end"
            :model-value="row.mode"
            :options="modeOptions(row)"
            width="152px"
            @update:model-value="(v) => emit('set-mode', row.name, v as ImportRowMode)"
          />
        </div>
        <div v-if="row.mode === 'rename'" class="flex items-center gap-2 px-3 pb-2.5">
          <Input
            :class="{ 'border-destructive focus-visible:ring-destructive': !!rowError(row) }"
            :model-value="row.to"
            :placeholder="t('infra.import.file.preview.renamePlaceholder')"
            spellcheck="false"
            class="h-ctrl-sm min-w-0 flex-1 font-mono"
            @update:model-value="emit('set-to', row.name, $event)"
          />
          <span v-if="rowError(row)" class="flex-none text-xs text-destructive">
            {{ rowError(row) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng xem trước dùng chung cho ba nguồn nhập (paste/file/csv) của
// AwsProfileImport.vue — component ĐÂY KHÔNG gọi RPC, chỉ trình bày `rows` do
// cha sở hữu và emit thay đổi lên (đúng luật "props readonly, mutate qua emit").
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { AwsProfileImportEntry } from '~/composables/useAwsProfilesApi'
import type { AwsProfileKind } from '~/types'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'
import Input from '~/components/ui/input/Input.vue'

export type ImportRowMode = 'create' | 'overwrite' | 'rename' | 'skip'
export type ImportRow = AwsProfileImportEntry & { mode: ImportRowMode; to: string }

const props = defineProps<{
  rows: ImportRow[]
  warnings: string[]
  // Tên đích (đã resolve) bị trùng NHIỀU HƠN MỘT hàng trong chính lô này — cha
  // tính (AwsProfileImport.vue), ở đây chỉ đọc để tô đỏ dòng liên quan.
  duplicateNames: Set<string>
}>()

const emit = defineEmits<{
  'set-mode': [name: string, mode: ImportRowMode]
  'set-to': [name: string, value: string]
}>()

const { t } = useI18n()

const KIND_I18N_KEY: Record<Exclude<AwsProfileKind, 'unknown'>, string> = {
  sso: 'infra.kind.sso',
  login: 'infra.kind.login',
  'assume-role': 'infra.kind.assumeRole',
  process: 'infra.kind.process',
  static: 'infra.kind.static',
}

function kindLabel(kind: AwsProfileKind): string {
  return kind === 'unknown' ? t('infra.import.file.kindUnknown') : t(KIND_I18N_KEY[kind])
}

function conflictLabel(conflict: ImportRow['conflict']): string {
  if (conflict === 'config') return t('infra.import.file.preview.conflictConfig')
  if (conflict === 'credentials') return t('infra.import.file.preview.conflictCredentials')
  if (conflict === 'both') return t('infra.import.file.preview.conflictBoth')
  return t('infra.import.file.preview.conflictNone')
}

function modeOptions(row: ImportRow): AppSelectOption[] {
  const rename: AppSelectOption = {
    value: 'rename',
    label: t('infra.import.file.preview.modeRename'),
  }
  const skip: AppSelectOption = { value: 'skip', label: t('infra.import.file.preview.modeSkip') }
  if (row.conflict === 'none') {
    return [{ value: 'create', label: t('infra.import.file.preview.modeCreate') }, rename, skip]
  }
  return [{ value: 'overwrite', label: t('infra.import.file.preview.modeOverwrite') }, rename, skip]
}

function rowError(row: ImportRow): string {
  if (row.mode !== 'rename') return ''
  const to = row.to.trim()
  if (!AWS_PROFILE_NAME_RE.test(to)) return t('infra.import.file.preview.renameInvalid')
  if (props.duplicateNames.has(to)) return t('infra.import.file.preview.renameDuplicate')
  return ''
}
</script>
