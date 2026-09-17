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

        <!-- Thông điệp đứng RIÊNG và đứng TRƯỚC: nó là thứ người ta mở hàng này để
             đọc. Các trường còn lại là ngữ cảnh, không phải nội dung. -->
        <section v-if="message" class="lrm-sec">
          <div class="lrm-lbl">{{ t('infra.logs.row.message') }}</div>
          <pre class="lrm-msg">{{ message }}</pre>
          <!-- Log JSON thì in ra dạng thụt lề: một dòng 900 ký tự không đọc được,
               mà đó lại đúng là dạng log của phần lớn service hiện đại. -->
          <pre v-if="prettyJson" class="lrm-msg lrm-json">{{ prettyJson }}</pre>
        </section>

        <section class="lrm-sec">
          <div class="lrm-lbl">{{ t('infra.logs.row.fields') }}</div>
          <dl class="lrm-dl">
            <template v-for="[key, value] in fields" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ value }}</dd>
            </template>
          </dl>
        </section>

        <footer class="lrm-ft">
          <button class="btn sm" type="button" @click="emit('copy', detailText)">
            <Icon name="copy" class="lrm-ic" />
            {{ copied ? t('infra.logs.results.copied') : t('infra.logs.row.copyJson') }}
          </button>
          <button v-if="message" class="btn sm" type="button" @click="emit('copy', message)">
            <Icon name="copy" class="lrm-ic" />
            {{ t('infra.logs.row.copyMessage') }}
          </button>
          <button class="btn sm" type="button" @click="emit('send-to-chat', detailText)">
            <Icon name="message" class="lrm-ic" />
            {{ t('infra.logs.results.sendToChat') }}
          </button>
          <!-- Chỉ hiện khi dòng này THẬT SỰ mang một id lần theo được — cùng luật
               với nút cũ trên khung chi tiết inline. -->
          <button
            v-if="traceId"
            class="btn sm"
            type="button"
            :title="t('infra.logs.results.traceTitle', { id: traceId })"
            @click="emit('trace', traceId)"
          >
            <Icon name="branch" class="lrm-ic" />
            {{ t('infra.logs.results.trace') }}
          </button>
          <span class="lrm-gap" />
          <button class="btn" type="button" @click="emit('close')">
            {{ t('infra.logs.results.close') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Chi tiết MỘT dòng log + các hành động của nó.
//
// Trước 2026-09-17 khối này nằm inline dưới bảng: nó ăn chiều cao của chính bảng
// đang đọc, và với một dòng log JSON dài thì bảng bị đẩy khuất gần hết. Modal trả
// lại toàn bộ chiều cao cho bảng và cho phép in `@message` ở dạng thụt lề.
//
// KHÔNG tự redact: mọi dòng tới đây đã đi qua `runInfra`, nơi stdout được
// `redactString` xử lý TRƯỚC khi rời tiến trình con (invariant #1).
import { traceIdFromRow } from '~/utils/infra-trace-id'
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

const message = computed(() => props.row?.['@message'] ?? props.row?.['message'] ?? '')
const stamp = computed(() => props.row?.['@timestamp'] ?? '')
const traceId = computed(() => (props.row ? traceIdFromRow(props.row) : null))

/** Mọi trường TRỪ `@message` — nó đã có khối riêng ở trên, in hai lần là nhiễu. */
const fields = computed<[string, string][]>(() =>
  Object.entries(props.row ?? {}).filter(([k]) => k !== '@message' && k !== 'message'),
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
  if (!props.row) return ''
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
}

.lrm-hd-ic,
.lrm-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.lrm-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
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

.lrm-sec {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 0;
}

.lrm-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.lrm-msg {
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

.lrm-json {
  max-height: 30vh;
  color: var(--textMuted);
}

.lrm-dl {
  display: grid;
  grid-template-columns: minmax(120px, max-content) 1fr;
  gap: 4px 12px;
  margin: 0;
  max-height: 22vh;
  overflow: auto;
}

.lrm-dl dt {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: tên trường của Insights */
  font-family: var(--code);
}

.lrm-dl dd {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: giá trị thô của một bản ghi log */
  font-family: var(--code);
  word-break: break-word;
}

.lrm-ft {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.lrm-gap {
  flex: 1 1 auto;
}
</style>
