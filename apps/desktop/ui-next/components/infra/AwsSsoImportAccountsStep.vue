<template>
  <div class="asa">
    <div class="asa-toolbar">
      <div class="asa-search">
        <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <input v-model="filterText" :placeholder="t('infra.import.sso.accounts.search')" />
      </div>
      <button
        class="btn sm"
        type="button"
        :disabled="!visibleKeys.length"
        @click="emit('select-all', visibleKeys)"
      >
        {{
          allVisibleSelected
            ? t('infra.import.sso.accounts.deselectAllVisible')
            : t('infra.import.sso.accounts.selectAllVisible')
        }}
      </button>
    </div>

    <div v-if="warnings.length" class="asa-warnbox">
      <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
    </div>

    <div v-if="loading" class="asa-state">{{ t('infra.import.sso.accounts.loading') }}</div>
    <div v-else-if="!filteredAccounts.length" class="asa-state">
      {{ t('infra.import.sso.accounts.empty') }}
    </div>

    <div v-else class="asa-list">
      <div v-for="acc in filteredAccounts" :key="acc.accountId" class="asa-group">
        <label class="asa-group-head">
          <input
            type="checkbox"
            :checked="accountAllSelected(acc)"
            :disabled="!acc.roles.length"
            @change="emit('toggle-account', acc.accountId, roleKeys(acc))"
          />
          <span class="asa-acc-name">{{ acc.accountName }}</span>
          <span class="asa-acc-id mono">{{ acc.accountId }}</span>
          <span v-if="acc.emailAddress" class="asa-acc-email">{{ acc.emailAddress }}</span>
        </label>

        <label v-for="role in acc.roles" :key="role" class="asa-row">
          <input
            type="checkbox"
            :checked="selected.has(key(acc.accountId, role))"
            @change="emit('toggle', acc.accountId, role)"
          />
          <span class="asa-role mono">{{ role }}</span>
        </label>
        <div v-if="!acc.roles.length" class="asa-noroles">
          {{ t('infra.import.sso.accounts.noRoles') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng account × role của AwsSsoImport.vue (bước 2) — tick hàng loạt: chọn tất
// cả (theo ô lọc hiện tại) / theo từng account / từng dòng. Component ĐÂY không
// gọi RPC, chỉ trình bày `accounts`/`selected` do cha sở hữu và emit lên.
import { computed, ref } from 'vue'
import type { AwsSsoAccount } from '~/composables/useAwsProfilesApi'

const props = defineProps<{
  accounts: AwsSsoAccount[]
  // Set các key `${accountId}::${roleName}` đang tick — cha sở hữu (AwsSsoImport.vue).
  selected: Set<string>
  loading: boolean
  warnings: string[]
}>()

const emit = defineEmits<{
  toggle: [accountId: string, roleName: string]
  'toggle-account': [accountId: string, keys: string[]]
  'select-all': [keys: string[]]
}>()

const { t } = useI18n()

const filterText = ref('')

function key(accountId: string, roleName: string): string {
  return `${accountId}::${roleName}`
}
function roleKeys(acc: AwsSsoAccount): string[] {
  return acc.roles.map((r) => key(acc.accountId, r))
}
function accountAllSelected(acc: AwsSsoAccount): boolean {
  return acc.roles.length > 0 && acc.roles.every((r) => props.selected.has(key(acc.accountId, r)))
}

// Khớp accountId/accountName ⇒ giữ NGUYÊN mọi role của account đó (đang tìm
// đúng account); khớp riêng role ⇒ chỉ giữ role khớp.
const filteredAccounts = computed<AwsSsoAccount[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return props.accounts
  const out: AwsSsoAccount[] = []
  for (const acc of props.accounts) {
    const accMatch = acc.accountId.includes(q) || acc.accountName.toLowerCase().includes(q)
    const roles = accMatch ? acc.roles : acc.roles.filter((r) => r.toLowerCase().includes(q))
    if (accMatch || roles.length > 0) out.push({ ...acc, roles })
  }
  return out
})

const visibleKeys = computed<string[]>(() => filteredAccounts.value.flatMap((acc) => roleKeys(acc)))
const allVisibleSelected = computed(
  () => visibleKeys.value.length > 0 && visibleKeys.value.every((k) => props.selected.has(k)),
)
</script>

<style scoped>
.asa {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.asa-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.asa-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  color: var(--textDim);
}
.asa-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}
.asa-warnbox {
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
.asa-state {
  padding: 24px 4px;
  text-align: center;
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.asa-list {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
}
.asa-group + .asa-group {
  border-top: 1px solid var(--border);
}
.asa-group-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  background: var(--bgHover);
  cursor: pointer;
}
.asa-acc-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.asa-acc-id {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.asa-acc-email {
  margin-left: auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.asa-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px 7px 34px;
  cursor: pointer;
}
.asa-row:hover {
  background: var(--bgHover);
}
.asa-role {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
}
.asa-noroles {
  padding: 6px 12px 10px 34px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
</style>
