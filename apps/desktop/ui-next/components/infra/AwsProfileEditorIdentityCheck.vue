<template>
  <div class="flex flex-col gap-2 rounded-lg border bg-muted p-3">
    <div class="text-xs font-semibold text-muted-foreground">
      {{ t('infra.editor.identity.title') }}
    </div>
    <div v-if="checking" class="text-sm text-dim">
      {{ t('infra.editor.identity.checking') }}
    </div>
    <template v-else-if="result">
      <div v-if="ok" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="min-w-18 flex-none text-xs text-dim">
            {{ t('infra.editor.identity.account') }}
          </span>
          <!-- mono-ok: account id / ARN là giá trị copy-paste vào terminal hoặc IAM console. -->
          <code class="font-mono text-sm wrap-anywhere text-foreground">{{ ok.accountId }}</code>
        </div>
        <div class="flex items-baseline gap-2">
          <span class="min-w-18 flex-none text-xs text-dim">
            {{ t('infra.editor.identity.arn') }}
          </span>
          <code class="font-mono text-sm wrap-anywhere text-foreground">{{ ok.arn }}</code>
        </div>
      </div>
      <div v-else class="flex items-center gap-2.5 text-sm text-destructive">
        <span>{{ errorMessage }}</span>
        <Button type="button" variant="outline" size="sm" @click="emit('retry')">
          {{ t('common.retry') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Kết quả `sts get-caller-identity` sau khi lưu profile thành công — tách
// khỏi AwsProfileEditor.vue chỉ để giữ file cha ngắn lại (thuần hiển thị,
// KHÔNG tự gọi RPC — cha chạy `identityCheck()` và bơm `result`/`checking`
// xuống qua props, `retry` yêu cầu cha chạy lại).
import { computed } from 'vue'
import type { AwsIdentityCheckResult } from '~/composables/useAwsProfilesApi'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  checking: boolean
  result: AwsIdentityCheckResult | null
}>()

const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()

// Tách sẵn 2 nhánh của discriminated union ra computed — template chỉ cần
// truthy-check, không phải tự narrow theo `result.ok` (vue-tsc narrow union
// trong template không đáng tin bằng narrow trong script).
const ok = computed(() => {
  const r = props.result
  return r?.ok ? r : null
})
const errorMessage = computed(() => {
  const r = props.result
  return r && !r.ok ? r.error : ''
})
</script>
