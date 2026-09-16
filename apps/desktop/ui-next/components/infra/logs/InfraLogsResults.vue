<template>
  <div class="lrs" :class="{ fill }">
    <div v-if="rows.length === 0" class="lrs-empty">
      <Icon name="search" class="lrs-empty-ic" />
      <p class="lrs-empty-txt">{{ emptyText || t('infra.logs.results.empty') }}</p>
    </div>

    <template v-else>
      <div class="lrs-tablewrap tblcard">
        <table class="lrs-table">
          <thead>
            <tr>
              <th class="lrs-th-ix">#</th>
              <th v-for="c in columns" :key="c" class="lrs-th" :title="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in rows"
              :key="i"
              class="lrs-tr"
              :class="{ on: selected === i }"
              @click="select(i)"
            >
              <td class="lrs-td-ix">{{ i + 1 }}</td>
              <td
                v-for="c in columns"
                :key="c"
                class="lrs-td"
                :class="{ msg: c === '@message' || c === 'message' }"
              >
                {{ row[c] ?? '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="selectedRow" class="lrs-detail">
        <div class="lrs-detail-head">
          <span class="lrs-detail-title">{{ t('infra.logs.results.detail') }}</span>
          <span class="lrs-detail-acts">
            <button class="btn sm" type="button" @click="emit('copy', detailText)">
              <Icon name="copy" class="lrs-ic" />
              {{ copied ? t('infra.logs.results.copied') : t('infra.logs.results.copy') }}
            </button>
            <button class="btn sm" type="button" @click="emit('send-to-chat', detailText)">
              <Icon name="message" class="lrs-ic" />
              {{ t('infra.logs.results.sendToChat') }}
            </button>
            <!-- Chỉ hiện khi dòng này THẬT SỰ mang một id lần theo được. Không có
                 id mà vẫn hiện nút là hứa một việc không làm được. -->
            <button
              v-if="rowTraceId"
              class="btn sm"
              type="button"
              :title="t('infra.logs.results.traceTitle', { id: rowTraceId })"
              @click="emit('trace', rowTraceId)"
            >
              <Icon name="branch" class="lrs-ic" />
              {{ t('infra.logs.results.trace') }}
            </button>
            <button class="btn sm" type="button" @click="selected = null">
              {{ t('infra.logs.results.close') }}
            </button>
          </span>
        </div>
        <pre class="lrs-json">{{ detailText }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Bảng kết quả + JSON chi tiết + copy + gửi vào chat (Mốc 2 việc 2.2).
//
// Bảng dựng cột ĐỘNG theo dòng đầu rồi bổ sung cột mới gặp ở dòng sau: Insights
// không đảm bảo mọi dòng cùng tập trường (`parse` có thể sinh trường mới), và một
// bảng cứng cột sẽ im lặng nuốt mất đúng những trường người dùng đang tìm.
//
// KHÔNG clipboard ở đây — component chỉ emit; chủ màn sở hữu `navigator.clipboard`
// và toast, để thông báo nằm cùng chỗ với mọi thông báo khác của màn Logs.
import { traceIdFromRow } from '~/utils/infra-trace-id'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'

const props = defineProps<{
  rows: AwsInsightsRow[]
  copied?: boolean
  emptyText?: string
  /** Kéo giãn bảng lấp đầy cột chính (layout Kibana 3/9) thay vì cao cố định. */
  fill?: boolean
}>()

const emit = defineEmits<{
  copy: [text: string]
  'send-to-chat': [text: string]
  trace: [id: string]
}>()

const { t } = useI18n()
const selected = ref<number | null>(null)

const columns = computed<string[]>(() => {
  const out: string[] = []
  for (const row of props.rows) {
    for (const key of Object.keys(row)) if (!out.includes(key)) out.push(key)
  }
  // `@timestamp` và `@message` lên trước: hai cột đó là lý do người ta mở log.
  const head = ['@timestamp', '@message'].filter((c) => out.includes(c))
  return [...head, ...out.filter((c) => !head.includes(c))]
})

const selectedRow = computed<AwsInsightsRow | null>(() =>
  selected.value === null ? null : (props.rows[selected.value] ?? null),
)

/** Id lần theo được của dòng đang mở, hoặc `null` — xem `utils/infra-trace-id.ts`. */
const rowTraceId = computed(() => {
  const row = selectedRow.value
  return row ? traceIdFromRow(row) : null
})

const detailText = computed(() => {
  const row = selectedRow.value
  if (!row) return ''
  try {
    return JSON.stringify(row, null, 2)
  } catch {
    return Object.entries(row)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  }
})

function select(i: number): void {
  selected.value = selected.value === i ? null : i
}

// Đổi kết quả (chạy lại / lọc) thì bỏ chọn: giữ chỉ số cũ sau khi mảng đổi nghĩa
// là trỏ vào một dòng KHÁC với dòng người dùng đang đọc.
watch(
  () => props.rows,
  () => {
    selected.value = null
  },
)
</script>

<style scoped>
.lrs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
}

/* Layout Kibana 3/9: bảng lấp đầy cột chính thay vì cao cố định 340px. */
.lrs.fill {
  flex: 1 1 auto;
}

.lrs.fill .lrs-tablewrap {
  flex: 1 1 auto;
  max-height: none;
}

.lrs.fill .lrs-empty {
  flex: 1 1 auto;
  justify-content: center;
}

.lrs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 12px;
  color: var(--textDim);
}

.lrs-empty-ic {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.lrs-empty-txt {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* Skin card ở `.tblcard` toàn cục (app-shell.css); đây chỉ còn bố cục.
   Trước đây khai tại chỗ với `--r-sm` + `--bgEl` — lệch khuôn so với ba bảng card
   còn lại của app (--r-card + --bgPanel) mà không có lý do nào. */
.lrs-tablewrap {
  overflow: auto;
  max-height: 340px;
}

.lrs-table {
  border-collapse: collapse;
  width: 100%;
}

.lrs-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 8px;
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lrs-th-ix {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 5px 8px;
  background: var(--bgEl);
  border-bottom: 1px solid var(--border);
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: right;
  width: 40px;
}

.lrs-tr {
  cursor: pointer;
}

.lrs-tr.on {
  background: var(--bgHover);
}

.lrs-td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  /* mono-ok: bảng kết quả là bản ghi log thô, cột phải thẳng hàng */
  font-family: var(--code);
}

.lrs-td.msg {
  white-space: pre-wrap;
  word-break: break-word;
  max-width: 560px;
}

.lrs-td-ix {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.lrs-detail {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
  overflow: hidden;
}

.lrs-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px;
  border-bottom: 1px solid var(--border);
}

.lrs-detail-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lrs-detail-acts {
  display: flex;
  gap: 4px;
}

.lrs-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.lrs-json {
  margin: 0;
  padding: 9px;
  max-height: 220px;
  overflow: auto;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: JSON của một bản ghi log */
  font-family: var(--code);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
