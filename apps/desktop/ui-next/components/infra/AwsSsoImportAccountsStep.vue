<template>
  <div class="flex min-h-0 flex-col gap-2.5">
    <div class="flex items-center gap-2">
      <div class="relative min-w-0 flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim"
        />
        <Input
          v-model="filterText"
          class="h-ctrl-sm pl-8"
          :placeholder="t('infra.import.sso.accounts.search')"
        />
      </div>
      <Button
        type="button"
        :disabled="!visibleKeys.length"
        variant="outline"
        size="sm"
        @click="emit('select-all', visibleKeys)"
      >
        {{
          allVisibleSelected
            ? t('infra.import.sso.accounts.deselectAllVisible')
            : t('infra.import.sso.accounts.selectAllVisible')
        }}
      </Button>
    </div>

    <div
      v-if="warnings.length"
      class="flex flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <div v-for="(w, i) in warnings" :key="i">{{ w }}</div>
    </div>

    <div v-if="loading" class="px-1 py-6 text-center text-sm text-muted-foreground">
      {{ t('infra.import.sso.accounts.loading') }}
    </div>
    <div
      v-else-if="!filteredAccounts.length"
      class="px-1 py-6 text-center text-sm text-muted-foreground"
    >
      {{ t('infra.import.sso.accounts.empty') }}
    </div>

    <!-- mono-ok (account id / role dưới đây): định danh dùng thẳng ở ~/.aws/config. -->
    <div v-else class="flex max-h-[46vh] flex-col overflow-y-auto rounded-lg border">
      <div v-for="acc in filteredAccounts" :key="acc.accountId" class="border-t first:border-t-0">
        <label class="flex cursor-pointer items-center gap-2 bg-muted px-3 py-2">
          <Checkbox
            :model-value="accountAllSelected(acc)"
            :disabled="!acc.roles.length"
            @update:model-value="emit('toggle-account', acc.accountId, roleKeys(acc))"
          />
          <span class="text-sm font-semibold text-foreground">{{ acc.accountName }}</span>
          <span class="font-mono text-xs text-dim">{{ acc.accountId }}</span>
          <span v-if="acc.emailAddress" class="ml-auto text-xs text-faint">
            {{ acc.emailAddress }}
          </span>
        </label>

        <label
          v-for="role in acc.roles"
          :key="role"
          class="flex cursor-pointer items-center gap-2 py-1.5 pr-3 pl-8.5 hover:bg-accent"
        >
          <Checkbox
            :model-value="selected.has(key(acc.accountId, role))"
            @update:model-value="emit('toggle', acc.accountId, role)"
          />
          <span class="font-mono text-sm text-foreground">{{ role }}</span>
        </label>
        <div v-if="!acc.roles.length" class="pt-1.5 pr-3 pb-2.5 pl-8.5 text-xs text-faint">
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
