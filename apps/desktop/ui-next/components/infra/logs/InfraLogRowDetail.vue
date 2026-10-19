<template>
  <div class="flex min-h-0 flex-col gap-2.5">
    <!-- Thông điệp đứng RIÊNG và đứng TRƯỚC: nó là thứ người ta mở hàng này để
         đọc. Các trường còn lại là ngữ cảnh, không phải nội dung. -->
    <section v-if="message" class="flex min-h-0 flex-col gap-1">
      <div class="text-xs text-dim">{{ t('infra.logs.row.message') }}</div>
      <!-- mono-ok: dòng log nguyên bản -->
      <pre
        class="m-0 max-h-[34vh] overflow-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-foreground"
        >{{ message }}</pre
      >
      <!-- Log JSON thì in ra dạng thụt lề: một dòng 900 ký tự không đọc được,
           mà đó lại đúng là dạng log của phần lớn service hiện đại. -->
      <pre
        v-if="prettyJson"
        class="m-0 max-h-[30vh] overflow-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground"
        >{{ prettyJson }}</pre
      >
    </section>

    <section class="flex min-h-0 flex-col gap-1">
      <div class="text-xs text-dim">{{ t('infra.logs.row.fields') }}</div>
      <!-- mono-ok: tên trường + giá trị thô của một bản ghi Insights -->
      <dl
        class="m-0 grid max-h-[22vh] grid-cols-[minmax(7.5rem,max-content)_1fr] gap-x-3 gap-y-1 overflow-auto font-mono text-xs leading-(--lh-sm)"
      >
        <template v-for="[key, value] in fields" :key="key">
          <dt class="text-dim">{{ key }}</dt>
          <dd class="m-0 break-words text-foreground">{{ value }}</dd>
        </template>
      </dl>
    </section>

    <div class="flex flex-wrap items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" @click="emit('copy', detailText)">
        <Icon name="copy" />
        {{ copied ? t('infra.logs.results.copied') : t('infra.logs.row.copyJson') }}
      </Button>
      <Button
        v-if="message"
        type="button"
        variant="outline"
        size="sm"
        @click="emit('copy', message)"
      >
        <Icon name="copy" />
        {{ t('infra.logs.row.copyMessage') }}
      </Button>
      <Button type="button" variant="outline" size="sm" @click="emit('send-to-chat', detailText)">
        <Icon name="message" />
        {{ t('infra.logs.results.sendToChat') }}
      </Button>
      <!-- Chỉ hiện khi dòng này THẬT SỰ mang một id lần theo được. -->
      <Button
        v-if="traceId"
        type="button"
        :title="t('infra.logs.results.traceTitle', { id: traceId })"
        variant="outline"
        size="sm"
        @click="emit('trace', traceId)"
      >
        <Icon name="branch" />
        {{ t('infra.logs.results.trace') }}
      </Button>
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Thân chi tiết của MỘT dòng log — dùng chung cho cả hai kiểu hiển thị mà hộp
// Tuỳ chọn cho chọn: cửa sổ riêng (`InfraLogRowModal`) và mở ngay trong bảng.
//
// Ở chung một chỗ vì phép đoán "nội dung này có phải JSON không" mà lệch nhau giữa
// hai kiểu thì cùng một dòng log sẽ hiện khác nhau tuỳ tuỳ chọn — một khác biệt
// người dùng không có cách nào giải thích được.
//
// KHÔNG tự redact: mọi dòng tới đây đã đi qua `runInfra`, nơi stdout được
// `redactString` xử lý TRƯỚC khi rời tiến trình con (invariant #1).
import { traceIdFromRow } from '~/utils/infra-trace-id'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  row: AwsInsightsRow
  copied?: boolean
}>()

const emit = defineEmits<{
  copy: [text: string]
  'send-to-chat': [text: string]
  trace: [id: string]
}>()

const { t } = useI18n()

const message = computed(() => props.row['@message'] ?? props.row['message'] ?? '')
const traceId = computed(() => traceIdFromRow(props.row))

/** Mọi trường TRỪ `@message` — nó đã có khối riêng ở trên, in hai lần là nhiễu. */
const fields = computed<[string, string][]>(() =>
  Object.entries(props.row).filter(([k]) => k !== '@message' && k !== 'message'),
)

/**
 * `@message` là JSON ⇒ in thêm bản thụt lề.
 *
 * Chỉ khi nó THỰC SỰ là một object/array: rất nhiều dòng log bắt đầu bằng một dấu
 * `{` của thứ khác (chuỗi định dạng, log lai), và ép chúng qua `JSON.parse` rồi in
 * ra "bản đẹp" sẽ dựng ra một cấu trúc không có thật.
 */
const prettyJson = computed(() => {
  const raw = message.value.trim()
  if (!raw.startsWith('{') && !raw.startsWith('[')) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return ''
    const pretty = JSON.stringify(parsed, null, 2)
    // Bằng đúng chuỗi gốc ⇒ không có gì để thêm.
    return pretty === raw ? '' : pretty
  } catch {
    return ''
  }
})

const detailText = computed(() => {
  try {
    return JSON.stringify(props.row, null, 2)
  } catch {
    return Object.entries(props.row)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }
})
</script>
