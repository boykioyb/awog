<template>
  <!-- Chi tiết một dòng (task 3.1). Mở bằng cú bấm, KHÔNG tự nạp: mỗi dòng là một
       lời gọi API thật, nên nạp sẵn 50 dòng là 50 lời gọi mà 49 cái không ai đọc. -->
  <section v-if="row" class="icard ixd">
    <header class="ixd-hd">
      <Icon name="info" />
      <span class="ixd-title">{{ row['name'] || row['id'] }}</span>
      <button class="btn sm" type="button" @click="$emit('ask', row)">
        <Icon name="sparkles" />
        {{ t('infra.explorer.ask') }}
      </button>
      <button class="btn sm" type="button" @click="$emit('close')">
        <Icon name="x" />
      </button>
    </header>

    <p v-if="loading" class="ixd-state">{{ t('infra.explorer.loading') }}</p>
    <p v-else-if="error" class="ixd-state err">{{ error }}</p>
    <pre v-else-if="json" class="ixd-json">{{ json }}</pre>
    <!-- View không khai `detail` thì không có gì để hiện — nói ra, đừng để khung
         trống khiến người dùng tưởng dữ liệu đang tải. -->
    <p v-else-if="!hasDetail" class="ixd-state">{{ t('infra.explorer.error.noDetail') }}</p>
    <p v-else class="ixd-state">{{ t('infra.explorer.empty') }}</p>
  </section>
</template>

<script setup lang="ts">
import type { InfraResourceRow } from '~/composables/useInfraResourcesApi'

defineProps<{
  row: InfraResourceRow | null
  json: string
  loading: boolean
  error: string
  hasDetail: boolean
}>()

defineEmits<{ (e: 'ask', row: InfraResourceRow): void; (e: 'close'): void }>()

const { t } = useI18n()
</script>

<style scoped>
.ixd {
  flex: 0 0 auto;
  max-height: 38%;
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  overflow: hidden;
}

.ixd-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textMuted);
}

.ixd-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixd-state {
  margin: 0;
  padding: 16px 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.ixd-state.err {
  color: var(--red);
}

.ixd-json {
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  /* mono-ok: JSON thô của AWS — người dùng đọc khoá/giá trị và copy ra ngoài */
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textMuted);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
