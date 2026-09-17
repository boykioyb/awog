<template>
  <div class="lrs" :class="{ fill }">
    <div v-if="rows.length === 0" class="lrs-empty">
      <Icon name="search" class="lrs-empty-ic" />
      <p class="lrs-empty-txt">{{ emptyText || t('infra.logs.results.empty') }}</p>
    </div>

    <template v-else>
      <div class="lrs-bar">
        <span class="lrs-count">{{ t('infra.logs.results.rows', { n: rows.length }) }}</span>
        <span class="lrs-gap" />
        <InfraLogsColumns :all="columns" />
      </div>

      <div class="lrs-tablewrap tblcard">
        <table class="lrs-table">
          <thead>
            <tr>
              <th class="lrs-th-ix">#</th>
              <th v-for="c in visibleColumns" :key="c" class="lrs-th" :title="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in rows"
              :key="i"
              class="lrs-tr"
              :class="{ on: selected === i }"
              :title="t('infra.logs.results.openRow')"
              @click="select(i)"
            >
              <td class="lrs-td-ix">{{ i + 1 }}</td>
              <td
                v-for="c in visibleColumns"
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
    </template>

    <!-- Chi tiết một dòng là MODAL, không phải khối inline dưới bảng: khối cũ ăn
         chiều cao của chính bảng đang đọc, và một dòng log JSON dài đẩy bảng khuất
         gần hết. -->
    <InfraLogRowModal
      :row="selectedRow"
      :copied="copied"
      @close="selected = null"
      @copy="emit('copy', $event)"
      @send-to-chat="emit('send-to-chat', $event)"
      @trace="emit('trace', $event)"
    />
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
import InfraLogRowModal from '~/components/infra/logs/InfraLogRowModal.vue'
import InfraLogsColumns from '~/components/infra/logs/InfraLogsColumns.vue'
import { useLogColumnPrefs } from '~/composables/useLogColumnPrefs'
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

/** Cột người dùng chọn hiện — thứ tự giữ nguyên như bảng dựng ra. */
const { visible } = useLogColumnPrefs()
const visibleColumns = computed(() => visible(columns.value))

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

/* Thanh công cụ KHÔNG phụ thuộc `fill` — số dòng và nút chọn cột phải nằm hai đầu
   ở mọi chỗ dùng bảng. `flex: 0 0 auto` để nó không bị bảng ép bẹp. */
.lrs-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.lrs-count {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.lrs-gap {
  flex: 1 1 auto;
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
  flex: 1 1 auto;
  overflow: auto;
  max-height: 340px;
}

/* MỘT luật duy nhất cho `max-height`, và bản nới ra phải THẮNG về độ đặc hiệu.
   Trước đây bản nới viết là `.lrs-tablewrap` trơn, ngang cơ với luật 340px ở trên
   nên luật đứng sau thắng: bảng ở chế độ `fill` bị ghim 340px và bỏ phí phần còn
   lại của cột chính (đo được 318px trống dưới bảng ở cửa sổ cao 695px). */
.lrs.fill .lrs-tablewrap {
  max-height: none;
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

/* Ô nội dung KHÔNG xuống dòng.
   Trước đây ô này `pre-wrap`: một dòng log JSON 2.4KB đo được cao 883px — cao hơn
   cả khung bảng (646px) — và một mình nó đẩy 32 hàng khác ra khỏi tầm nhìn. `<td>`
   thì `max-height` vô tác dụng (ô bảng coi height là chiều cao TỐI THIỂU), nên cách
   duy nhất giữ hàng đều là không cho chữ xuống dòng. Toàn văn nay nằm một cú bấm
   bên trong modal chi tiết, nên bảng không còn phải gánh việc hiển thị đủ. */
.lrs-td.msg {
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
</style>
