<template>
  <!-- Chi tiết một dòng (task 3.1). Mở bằng cú bấm, KHÔNG tự nạp: mỗi dòng là một
       lời gọi API thật, nên nạp sẵn 50 dòng là 50 lời gọi mà 49 cái không ai đọc. -->
  <Card v-if="row" class="mt-2 max-h-[38%] shrink-0 gap-0 overflow-hidden py-0">
    <header class="flex items-center gap-2 border-b px-2.5 py-1.5 text-muted-foreground">
      <Icon name="info" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {{ row['name'] || row['id'] }}
      </span>
      <Button type="button" variant="outline" size="sm" @click="$emit('ask', row)">
        <Icon name="sparkles" />
        {{ t('infra.explorer.ask') }}
      </Button>
      <Button type="button" variant="outline" size="sm" @click="$emit('close')">
        <Icon name="x" />
      </Button>
    </header>

    <p v-if="loading" :class="STATE">{{ t('infra.explorer.loading') }}</p>
    <p v-else-if="error" :class="[STATE, 'text-destructive']">{{ error }}</p>
    <!-- mono-ok: JSON thô của AWS — người dùng đọc khoá/giá trị và copy ra ngoài -->
    <pre
      v-else-if="json"
      class="overflow-auto px-3 py-2.5 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground"
      >{{ json }}</pre
    >
    <!-- View không khai `detail` thì không có gì để hiện — nói ra, đừng để khung
         trống khiến người dùng tưởng dữ liệu đang tải. -->
    <p v-else-if="!hasDetail" :class="STATE">{{ t('infra.explorer.error.noDetail') }}</p>
    <p v-else :class="STATE">{{ t('infra.explorer.empty') }}</p>
  </Card>
</template>

<script setup lang="ts">
import type { InfraResourceRow } from '~/composables/useInfraResourcesApi'
import Button from '~/components/ui/button/Button.vue'

defineProps<{
  row: InfraResourceRow | null
  json: string
  loading: boolean
  error: string
  hasDetail: boolean
}>()

defineEmits<{ (e: 'ask', row: InfraResourceRow): void; (e: 'close'): void }>()

const { t } = useI18n()

/** Câu trạng thái thay chỗ nội dung (đang tải / lỗi / trống). */
const STATE = 'px-3 py-4 text-sm text-dim'
</script>
