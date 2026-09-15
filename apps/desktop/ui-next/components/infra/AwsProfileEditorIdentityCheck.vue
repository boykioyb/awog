<template>
  <div class="ape-identity">
    <div class="ape-identity-title">{{ t('infra.editor.identity.title') }}</div>
    <div v-if="checking" class="ape-identity-loading">
      {{ t('infra.editor.identity.checking') }}
    </div>
    <template v-else-if="result">
      <div v-if="ok" class="ape-identity-ok">
        <div class="ape-identity-row">
          <span class="ape-identity-k">{{ t('infra.editor.identity.account') }}</span>
          <code class="ape-identity-v">{{ ok.accountId }}</code>
        </div>
        <div class="ape-identity-row">
          <span class="ape-identity-k">{{ t('infra.editor.identity.arn') }}</span>
          <code class="ape-identity-v">{{ ok.arn }}</code>
        </div>
      </div>
      <div v-else class="ape-identity-err">
        <span>{{ errorMessage }}</span>
        <button type="button" class="btn sm" @click="emit('retry')">{{ t('common.retry') }}</button>
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

<style scoped>
.ape-identity {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 13px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
}
.ape-identity-title {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--textMuted);
}
.ape-identity-loading {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.ape-identity-ok {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ape-identity-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ape-identity-k {
  flex: 0 0 auto;
  min-width: 70px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ape-identity-v {
  /* mono-ok: account id / ARN là giá trị copy-paste vào terminal hoặc IAM console. */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  overflow-wrap: anywhere;
}
.ape-identity-err {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
}
</style>
