<template>
  <div class="lrd">
    <!-- Thông điệp đứng RIÊNG và đứng TRƯỚC: nó là thứ người ta mở hàng này để
         đọc. Các trường còn lại là ngữ cảnh, không phải nội dung. -->
    <section v-if="message" class="lrd-sec">
      <div class="lrd-lbl">{{ t('infra.logs.row.message') }}</div>
      <pre class="lrd-msg">{{ message }}</pre>
      <!-- Log JSON thì in ra dạng thụt lề: một dòng 900 ký tự không đọc được,
           mà đó lại đúng là dạng log của phần lớn service hiện đại. -->
      <pre v-if="prettyJson" class="lrd-msg lrd-json">{{ prettyJson }}</pre>
    </section>

    <section class="lrd-sec">
      <div class="lrd-lbl">{{ t('infra.logs.row.fields') }}</div>
      <dl class="lrd-dl">
        <template v-for="[key, value] in fields" :key="key">
          <dt>{{ key }}</dt>
          <dd>{{ value }}</dd>
        </template>
      </dl>
    </section>

    <div class="lrd-acts">
      <button class="btn sm" type="button" @click="emit('copy', detailText)">
        <Icon name="copy" class="lrd-ic" />
        {{ copied ? t('infra.logs.results.copied') : t('infra.logs.row.copyJson') }}
      </button>
      <button v-if="message" class="btn sm" type="button" @click="emit('copy', message)">
        <Icon name="copy" class="lrd-ic" />
        {{ t('infra.logs.row.copyMessage') }}
      </button>
      <button class="btn sm" type="button" @click="emit('send-to-chat', detailText)">
        <Icon name="message" class="lrd-ic" />
        {{ t('infra.logs.results.sendToChat') }}
      </button>
      <!-- Chỉ hiện khi dòng này THẬT SỰ mang một id lần theo được. -->
      <button
        v-if="traceId"
        class="btn sm"
        type="button"
        :title="t('infra.logs.results.traceTitle', { id: traceId })"
        @click="emit('trace', traceId)"
      >
        <Icon name="branch" class="lrd-ic" />
        {{ t('infra.logs.results.trace') }}
      </button>
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

<style scoped>
.lrd {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.lrd-sec {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
}

.lrd-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.lrd-msg {
  margin: 0;
  max-height: 34vh;
  overflow: auto;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: dòng log nguyên bản */
  font-family: var(--code);
  white-space: pre-wrap;
  word-break: break-word;
}

.lrd-json {
  max-height: 30vh;
  color: var(--textMuted);
}

.lrd-dl {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 4px 12px;
  margin: 0;
  max-height: 22vh;
  overflow: auto;
}

.lrd-dl dt {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: tên trường của Insights */
  font-family: var(--code);
}

.lrd-dl dd {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: giá trị thô của một bản ghi log */
  font-family: var(--code);
  word-break: break-word;
}

.lrd-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.lrd-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
</style>
