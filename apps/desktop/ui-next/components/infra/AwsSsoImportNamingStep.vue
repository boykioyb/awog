<template>
  <div class="asn">
    <p class="asn-sub">{{ t('infra.import.sso.naming.title') }}</p>

    <div class="asn-field">
      <label class="asn-label">{{ t('infra.import.sso.naming.region') }}</label>
      <input
        v-model="region"
        class="asn-input mono"
        :placeholder="t('infra.import.sso.naming.regionPh')"
        spellcheck="false"
      />
    </div>

    <div class="asn-toggle" @click="overwrite = !overwrite">
      <span class="tog2 sm" :class="{ off: !overwrite }" />
      <span>{{ t('infra.import.sso.naming.overwrite') }}</span>
    </div>
    <div class="asn-hint">{{ t('infra.import.sso.naming.overwriteHint') }}</div>

    <div class="asn-table">
      <div class="asn-head">
        <span>{{ t('infra.import.sso.naming.colProfile') }}</span>
        <span>{{ t('infra.import.sso.naming.colAccount') }}</span>
        <span>{{ t('infra.import.sso.naming.colRole') }}</span>
      </div>
      <div v-for="row in rows" :key="rowKey(row)" class="asn-row">
        <div class="asn-row-main">
          <input
            class="asn-name-input mono"
            :class="{ 'has-err': !!rowError(row) }"
            :value="row.name"
            spellcheck="false"
            @input="emit('set-name', rowKey(row), ($event.target as HTMLInputElement).value)"
          />
          <span class="asn-acc mono" :title="`${row.accountName} · ${row.accountId}`">
            {{ row.accountName }} · {{ row.accountId }}
          </span>
          <span class="asn-role mono">{{ row.roleName }}</span>
        </div>
        <div v-if="rowError(row)" class="asn-msg err">{{ rowError(row) }}</div>
        <div v-else-if="rowWarning(row)" class="asn-msg warn">{{ rowWarning(row) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng đặt tên hàng loạt của AwsSsoImport.vue (bước 3) — mỗi hàng là một cặp
// (account, role) người dùng đã tick ở bước 2, tên mặc định `<accountId>_<role>`
// (không bao giờ trùng — accountId làm cho key duy nhất theo cấu trúc), sửa
// được từng dòng.
import { computed } from 'vue'
import { AWS_PROFILE_NAME_RE } from '~/utils/aws-profile-view'

export type NamingRow = {
  accountId: string
  accountName: string
  roleName: string
  name: string
}

const props = defineProps<{
  rows: NamingRow[]
  // Tên profile ĐÃ CÓ trong ~/.aws hiện tại — chỉ để cảnh báo mềm, KHÔNG chặn
  // (sidecar tự bỏ qua dòng trùng tên khi `overwrite` tắt, xem AwsSsoImport.vue).
  existingNames: Set<string>
}>()

const emit = defineEmits<{ 'set-name': [key: string, value: string] }>()

const region = defineModel<string>('region', { required: true })
const overwrite = defineModel<boolean>('overwrite', { required: true })

const { t } = useI18n()

function rowKey(row: NamingRow): string {
  return `${row.accountId}::${row.roleName}`
}

// Trùng trong CHÍNH lô này — lỗi CỨNG (chặn nút "Tạo profile" ở cha), vì hai
// selection cùng tên đích sẽ giẫm lên nhau ở `ssoCreateProfiles`.
const duplicateNames = computed<Set<string>>(() => {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const row of props.rows) {
    const name = row.name.trim()
    if (seen.has(name)) dupes.add(name)
    seen.add(name)
  }
  return dupes
})

function rowError(row: NamingRow): string {
  const name = row.name.trim()
  if (!AWS_PROFILE_NAME_RE.test(name)) return t('infra.import.sso.naming.invalid')
  if (duplicateNames.value.has(name)) return t('infra.import.sso.naming.duplicateBatch')
  return ''
}

// Trùng với một profile CÓ SẴN — cảnh báo MỀM, không chặn: sidecar tự bỏ qua
// dòng đó (`skipped`) khi `overwrite` tắt.
function rowWarning(row: NamingRow): string {
  if (rowError(row)) return ''
  const name = row.name.trim()
  if (props.existingNames.has(name) && !overwrite.value) {
    return t('infra.import.sso.naming.duplicateExisting')
  }
  return ''
}
</script>

<style scoped>
.asn {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.asn-sub {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.asn-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 260px;
}
.asn-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.asn-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.asn-input:focus {
  border-color: var(--accent);
}
.asn-toggle {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  align-self: flex-start;
  cursor: pointer;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.asn-hint {
  margin-top: -6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.asn-table {
  display: flex;
  flex-direction: column;
  max-height: 38vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.asn-head,
.asn-row-main {
  display: grid;
  grid-template-columns: 1.2fr 1.4fr 0.8fr;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
}
.asn-head {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  background: var(--bgHover);
}
.asn-row + .asn-row {
  border-top: 1px solid var(--border);
}
.asn-name-input {
  width: 100%;
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
.asn-name-input:focus {
  border-color: var(--accent);
}
.asn-name-input.has-err,
.asn-name-input.has-err:focus {
  border-color: var(--danger);
}
.asn-acc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.asn-role {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.asn-msg {
  padding: 0 12px 8px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.asn-msg.err {
  color: var(--danger);
}
.asn-msg.warn {
  color: var(--amber);
}
</style>
