<template>
  <Teleport to="body">
    <div v-if="row" class="ovl on" @click.self="emit('close')">
      <div class="lrm" role="dialog" aria-modal="true">
        <header class="lrm-hd">
          <Icon name="file" class="lrm-hd-ic" />
          <span class="lrm-ttl">{{ t('infra.logs.row.title') }}</span>
          <span v-if="stamp" class="lrm-stamp">{{ stamp }}</span>
          <button class="lrm-x" type="button" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" class="lrm-hd-ic" />
          </button>
        </header>

        <InfraLogRowDetail
          :row="row"
          :copied="copied"
          @copy="emit('copy', $event)"
          @send-to-chat="emit('send-to-chat', $event)"
          @trace="emit('trace', $event)"
        >
          <template #actions>
            <span class="lrm-gap" />
            <button class="btn" type="button" @click="emit('close')">
              {{ t('infra.logs.results.close') }}
            </button>
          </template>
        </InfraLogRowDetail>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Chi tiết MỘT dòng log trong một cửa sổ riêng — tuỳ chọn `pane` của hộp Tuỳ chọn.
//
// Trước 2026-09-17 khối này nằm inline dưới bảng và KHÔNG có cách nào đổi: nó ăn
// chiều cao của chính bảng đang đọc. Nay mở-trong-bảng là một lựa chọn ngang hàng
// (`inline`), còn đây là lựa chọn mặc định vì nó trả lại toàn bộ chiều cao cho bảng.
//
// Phần thân nằm ở `InfraLogRowDetail` dùng chung với chế độ inline.
import InfraLogRowDetail from '~/components/infra/logs/InfraLogRowDetail.vue'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'

const props = defineProps<{
  /** `null` = đóng. Truyền cả dòng chứ không chỉ id: bảng đã có sẵn dữ liệu. */
  row: AwsInsightsRow | null
  copied?: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: [text: string]
  'send-to-chat': [text: string]
  trace: [id: string]
}>()

const { t } = useI18n()

useEscToClose(
  computed(() => props.row !== null),
  () => emit('close'),
)

const stamp = computed(() => props.row?.['@timestamp'] ?? '')
</script>

<style scoped>
.lrm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(900px, calc(100vw - 32px));
  max-height: 78vh;
  margin-top: 6vh;
  padding: 14px 16px 12px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
}

.lrm-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.lrm-hd-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.lrm-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
}

.lrm-stamp {
  flex: 1 1 auto;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
  /* mono-ok: mốc thời gian của CloudWatch, người dùng dán lại vào query */
  font-family: var(--code);
}

.lrm-x {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.lrm-x:hover {
  background: var(--bgHover);
  color: var(--text);
}

.lrm-gap {
  flex: 1 1 auto;
}
</style>
