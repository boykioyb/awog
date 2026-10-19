<template>
  <!-- mono-ok (các ô/nhãn font-mono dưới đây): region, tên profile, account id, role là
       định danh dùng thẳng ở `--profile`/`~/.aws/config`. -->
  <div class="flex min-h-0 flex-col gap-2.5">
    <p class="m-0 text-sm text-dim">{{ t('infra.import.sso.naming.title') }}</p>

    <div class="flex max-w-65 flex-col gap-1.5">
      <Label class="text-xs font-semibold text-foreground">
        {{ t('infra.import.sso.naming.region') }}
      </Label>
      <Input
        v-model="region"
        :placeholder="t('infra.import.sso.naming.regionPh')"
        spellcheck="false"
        class="font-mono"
      />
    </div>

    <div
      class="inline-flex cursor-pointer items-center gap-2 self-start text-sm text-foreground select-none"
      @click="overwrite = !overwrite"
    >
      <Switch :checked="overwrite" @click.stop @update:checked="overwrite = $event" />
      <span>{{ t('infra.import.sso.naming.overwrite') }}</span>
    </div>
    <div class="-mt-1.5 text-xs text-dim">{{ t('infra.import.sso.naming.overwriteHint') }}</div>

    <div class="flex max-h-[38vh] flex-col overflow-y-auto rounded-lg border">
      <div
        class="grid grid-cols-[1.2fr_1.4fr_0.8fr] items-center gap-2.5 bg-muted px-3 py-2 text-xs text-dim"
      >
        <span>{{ t('infra.import.sso.naming.colProfile') }}</span>
        <span>{{ t('infra.import.sso.naming.colAccount') }}</span>
        <span>{{ t('infra.import.sso.naming.colRole') }}</span>
      </div>
      <div v-for="row in rows" :key="rowKey(row)" class="border-t first:border-t-0">
        <div class="grid grid-cols-[1.2fr_1.4fr_0.8fr] items-center gap-2.5 px-3 py-2">
          <Input
            :class="{ 'border-destructive focus-visible:ring-destructive': !!rowError(row) }"
            :model-value="row.name"
            spellcheck="false"
            class="h-ctrl-sm min-w-0 font-mono"
            @update:model-value="emit('set-name', rowKey(row), $event)"
          />
          <span
            class="min-w-0 truncate font-mono text-xs text-dim"
            :title="`${row.accountName} · ${row.accountId}`"
          >
            {{ row.accountName }} · {{ row.accountId }}
          </span>
          <span class="min-w-0 truncate font-mono text-xs text-dim">{{ row.roleName }}</span>
        </div>
        <div v-if="rowError(row)" class="px-3 pb-2 text-xs text-destructive">
          {{ rowError(row) }}
        </div>
        <div v-else-if="rowWarning(row)" class="px-3 pb-2 text-xs text-warning">
          {{ rowWarning(row) }}
        </div>
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
import Input from '~/components/ui/input/Input.vue'

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
