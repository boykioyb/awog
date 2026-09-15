<template>
  <div class="aps">
    <p class="aps-sub">{{ t('infra.import.file.preview.subtitle') }}</p>

    <div v-if="warnings.length" class="aps-warnbox">
      <div class="aps-warnbox-title">{{ t('infra.import.warnings.title') }}</div>
      <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
    </div>

    <div v-if="!rows.length" class="aps-empty">{{ t('infra.import.file.preview.empty') }}</div>

    <div v-else class="aps-table">
      <div class="aps-head">
        <span class="aps-col-name">{{ t('infra.import.file.preview.colName') }}</span>
        <span class="aps-col-kind">{{ t('infra.import.file.preview.colKind') }}</span>
        <span class="aps-col-keys">{{ t('infra.import.file.preview.colKeys') }}</span>
        <span class="aps-col-conflict">{{ t('infra.import.file.preview.colConflict') }}</span>
        <span class="aps-col-action">{{ t('infra.import.file.preview.colAction') }}</span>
      </div>

      <div v-for="row in rows" :key="row.name" class="aps-row">
        <div class="aps-row-main">
          <span class="aps-name mono" :title="row.name">{{ row.name }}</span>
          <span class="aps-kind">{{ kindLabel(row.kind) }}</span>
          <span class="aps-keys">
            <span v-if="row.hasStaticKeys" class="aps-badge">
              {{ t('infra.import.file.preview.hasStaticKeys') }}
            </span>
            <span v-if="row.hasSessionToken" class="aps-badge">
              {{ t('infra.import.file.preview.hasSessionToken') }}
            </span>
          </span>
          <span class="aps-conflict" :class="{ warn: row.conflict !== 'none' }">
            {{ conflictLabel(row.conflict) }}
          </span>
          <AppSelect
            class="aps-mode"
            :model-value="row.mode"
            :options="modeOptions(row)"
            width="152px"
            @update:model-value="(v) => emit('set-mode', row.name, v as ImportRowMode)"
          />
        </div>
        <div v-if="row.mode === 'rename'" class="aps-rename">
          <input
            class="aps-rename-input mono"
            :class="{ 'has-err': !!rowError(row) }"
            :value="row.to"
            :placeholder="t('infra.import.file.preview.renamePlaceholder')"
            spellcheck="false"
            @input="emit('set-to', row.name, ($event.target as HTMLInputElement).value)"
          />
          <span v-if="rowError(row)" class="aps-rename-err">{{ rowError(row) }}</span>
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

<style scoped>
.aps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.aps-sub {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.aps-warnbox {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.aps-warnbox-title {
  font-weight: 650;
}
.aps-empty {
  padding: 24px 4px;
  text-align: center;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.aps-table {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.aps-head,
.aps-row-main {
  display: grid;
  grid-template-columns: 1.6fr 0.9fr 1.1fr 1.1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
}
.aps-head {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  background: var(--bgHover);
}
.aps-row + .aps-row {
  border-top: 1px solid var(--border);
}
.aps-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.aps-kind {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.aps-keys {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.aps-badge {
  padding: 2px 7px;
  border-radius: var(--r-xs);
  background: var(--bgActive);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}
.aps-conflict {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.aps-conflict.warn {
  color: var(--amber);
}
.aps-mode {
  justify-self: end;
}
.aps-rename {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 10px;
}
.aps-rename-input {
  flex: 1;
  min-width: 0;
  padding: 6px 9px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.aps-rename-input:focus {
  border-color: var(--accent);
}
.aps-rename-input.has-err,
.aps-rename-input.has-err:focus {
  border-color: var(--danger);
}
.aps-rename-err {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--danger);
}
</style>
