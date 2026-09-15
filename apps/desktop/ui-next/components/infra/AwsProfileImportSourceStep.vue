<template>
  <div class="ais">
    <p class="ais-sub">{{ t('infra.import.file.subtitle') }}</p>

    <div class="seg ais-seg">
      <span :class="{ on: sourceKind === 'paste' }" @click="sourceKind = 'paste'">
        {{ t('infra.import.file.source.paste') }}
      </span>
      <span :class="{ on: sourceKind === 'file' }" @click="sourceKind = 'file'">
        {{ t('infra.import.file.source.file') }}
      </span>
      <span :class="{ on: sourceKind === 'csv' }" @click="sourceKind = 'csv'">
        {{ t('infra.import.file.source.csv') }}
      </span>
    </div>

    <div v-if="sourceKind === 'paste'" class="ais-field">
      <label class="ais-label">{{ t('infra.import.file.paste.label') }}</label>
      <!-- Textarea, KHÔNG type=password — người dùng cần sửa được khối đã dán.
           Cảnh báo rõ + cha xoá sạch khỏi state ngay khi apply xong. -->
      <textarea
        v-model="pasteText"
        class="ais-input ais-ta mono"
        rows="7"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('infra.import.file.paste.placeholder')"
      />
      <div class="ais-warn">
        <Icon name="alert" style="width: var(--icon-xs); height: var(--icon-xs)" />
        {{ t('infra.import.file.paste.warning') }}
      </div>
    </div>

    <div v-else-if="sourceKind === 'file'" class="ais-field">
      <label class="ais-label">{{ t('infra.import.file.file.label') }}</label>
      <div class="ais-path-row">
        <input
          v-model="filePath"
          class="ais-input mono"
          :placeholder="t('infra.import.file.file.pathPlaceholder')"
          spellcheck="false"
        />
        <button v-if="canBrowse" type="button" class="btn sm" @click="browseFile">
          <Icon name="folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('infra.import.file.file.browse') }}
        </button>
      </div>
      <div class="ais-hint">{{ t('infra.import.file.file.hint') }}</div>
    </div>

    <div v-else class="ais-field">
      <label class="ais-label">{{ t('infra.import.file.csv.label') }}</label>
      <div class="ais-path-row">
        <input
          v-model="csvPath"
          class="ais-input mono"
          :placeholder="t('infra.import.file.csv.pathPlaceholder')"
          spellcheck="false"
        />
        <button v-if="canBrowse" type="button" class="btn sm" @click="browseCsv">
          <Icon name="folder" style="width: var(--icon-xs); height: var(--icon-xs)" />
          {{ t('infra.import.file.csv.browse') }}
        </button>
      </div>
      <div class="ais-hint">{{ t('infra.import.file.csv.hint') }}</div>
      <!-- Người chưa từng tạo access key đọc hint trên không biết đi đâu tiếp.
           Khối này là chỗ duy nhất trong app nói cách LẤY credential
           (docs/features/aws-profile-manager.md §"Lấy credential ở đâu"). -->
      <AwsProfileCredentialHelp context="csv" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Bước 1 (chọn nguồn) của AwsProfileImport.vue, tách riêng để giữ file cha dưới
// ngưỡng ~250 dòng (docs/coding/nuxt-frontend.md). Sở hữu TOÀN BỘ state của bước
// này qua defineModel — cha chỉ giữ ref, không cần biết chi tiết UI bên trong.
import { hasBridge, pickFile } from '~/composables/useFolderPicker'
import type { AwsProfileImportSource } from '~/composables/useAwsProfilesApi'

const sourceKind = defineModel<AwsProfileImportSource>('sourceKind', { required: true })
const pasteText = defineModel<string>('pasteText', { required: true })
const filePath = defineModel<string>('filePath', { required: true })
const csvPath = defineModel<string>('csvPath', { required: true })

const { t } = useI18n()

// Native file picker chỉ có trong Electron shell; browser-dev rơi về nhập tay.
const canBrowse = hasBridge()

async function browseFile(): Promise<void> {
  const p = await pickFile({
    title: t('infra.import.file.file.browse'),
    filters: [{ name: 'AWS config/credentials', extensions: ['*'] }],
  })
  if (p) filePath.value = p
}
async function browseCsv(): Promise<void> {
  const p = await pickFile({
    title: t('infra.import.file.csv.browse'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (p) csvPath.value = p
}
</script>

<style scoped>
.ais {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ais-sub {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.ais-seg {
  align-self: flex-start;
}
.ais-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ais-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.ais-input {
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
.ais-input:focus {
  border-color: var(--accent);
}
.ais-input.mono {
  /* mono-ok: đường dẫn file/CSV + khối dán từ SSO portal — copy được thẳng vào
     terminal/editor */
  font-family: var(--code);
}
.ais-ta {
  resize: vertical;
  min-height: 8rem;
  line-height: var(--lh-md);
}
.ais-path-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ais-path-row .ais-input {
  flex: 1;
  min-width: 0;
}
.ais-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ais-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 9px 11px;
  border-radius: var(--r-btn);
  background: var(--amberDim);
  border: 1px solid var(--amberBorder);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
