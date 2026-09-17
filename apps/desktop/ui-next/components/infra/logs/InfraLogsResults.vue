<template>
  <div class="lrs" :class="{ fill }">
    <!-- ĐANG TẢI đứng TRƯỚC RỖNG. Cùng là "không có hàng nào", nhưng một cái là
         "chờ chút" còn cái kia là "tìm rồi, không có gì" — hiện nhầm thì người dùng
         kết luận sai về chính dữ liệu của họ ngay trước khi dữ liệu kịp về. -->
    <div v-if="loading && rows.length === 0" class="lrs-empty">
      <Icon name="clock" class="lrs-empty-ic" />
      <p class="lrs-empty-txt">{{ t('infra.logs.results.loading') }}</p>
    </div>

    <div v-else-if="rows.length === 0" class="lrs-empty">
      <Icon name="search" class="lrs-empty-ic" />
      <p class="lrs-empty-txt">{{ emptyText || t('infra.logs.results.empty') }}</p>
    </div>

    <template v-else>
      <div class="lrs-bar">
        <span class="lrs-count">{{ t('infra.logs.results.rows', { n: rows.length }) }}</span>
        <span class="lrs-gap" />
        <button
          class="btn sm"
          type="button"
          :title="t('infra.logs.prefs.hint')"
          @click="prefsOpen = true"
        >
          <Icon name="settings" class="lrs-bar-ic" />
          {{ t('infra.logs.prefs.button') }}
        </button>
      </div>

      <div ref="scrollerRef" class="lrs-tablewrap tblcard" @scroll.passive="onScroll">
        <table class="lrs-table">
          <thead>
            <tr>
              <th class="lrs-th-ix">#</th>
              <th v-for="c in visibleColumns" :key="c" class="lrs-th" :title="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(row, i) in rows" :key="i">
              <tr
                class="lrs-tr"
                :class="{ on: isOpen(i) }"
                :title="t('infra.logs.results.openRow')"
                @click="select(i)"
              >
                <td class="lrs-td-ix">{{ i + 1 }}</td>
                <td
                  v-for="c in visibleColumns"
                  :key="c"
                  class="lrs-td"
                  :class="{ msg: c === '@message' || c === 'message', wrap: prefs.wrapLines }"
                >
                  {{ row[c] ?? '' }}
                </td>
              </tr>

              <!-- Chi tiết NGAY TRONG bảng — tuỳ chọn `inline`, nhiều dòng mở cùng
                   lúc được. Ô trải hết bề ngang để chi tiết không bị bó vào một cột. -->
              <tr v-if="prefs.rowMode === 'inline' && isOpen(i)" class="lrs-xr">
                <td class="lrs-xtd" :colspan="visibleColumns.length + 1">
                  <InfraLogRowDetail
                    :row="row"
                    :copied="copied"
                    @copy="emit('copy', $event)"
                    @send-to-chat="emit('send-to-chat', $event)"
                    @trace="emit('trace', $event)"
                  />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Lên đầu / xuống cuối: NỔI ở góc, không chiếm một hàng nào của bảng, cùng
           khuôn mờ-khi-rảnh với nút đọc thêm. Chỉ hiện khi bảng THỰC SỰ cuộn được và
           chỉ hiện hướng còn đi được — một nút "lên đầu" khi đang ở đầu là một nút
           không làm gì. -->
      <div v-if="canScroll" class="lrs-nav">
        <button
          v-if="!atTop"
          class="lrs-navbtn"
          type="button"
          :title="t('infra.logs.results.toTop')"
          :aria-label="t('infra.logs.results.toTop')"
          @click="jump('top')"
        >
          <Icon name="chev" class="lrs-navic up" />
        </button>
        <button
          v-if="!atBottom"
          class="lrs-navbtn"
          type="button"
          :title="t('infra.logs.results.toBottom')"
          :aria-label="t('infra.logs.results.toBottom')"
          @click="jump('bottom')"
        >
          <Icon name="chev" class="lrs-navic" />
        </button>
      </div>
    </template>

    <!-- Tuỳ chọn `pane`: chi tiết ở cửa sổ riêng, mỗi lần một dòng. -->
    <InfraLogRowModal
      :row="paneRow"
      :copied="copied"
      @close="closePane"
      @copy="emit('copy', $event)"
      @send-to-chat="emit('send-to-chat', $event)"
      @trace="emit('trace', $event)"
    />

    <InfraLogsPrefsModal :open="prefsOpen" :all="columns" @close="prefsOpen = false" />
  </div>
</template>

<script setup lang="ts">
// Bảng kết quả + chi tiết một dòng + copy + gửi vào chat (Mốc 2 việc 2.2).
//
// Bảng dựng cột ĐỘNG theo dòng đầu rồi bổ sung cột mới gặp ở dòng sau: Insights
// không đảm bảo mọi dòng cùng tập trường (`parse` có thể sinh trường mới), và một
// bảng cứng cột sẽ im lặng nuốt mất đúng những trường người dùng đang tìm.
//
// Cách chi tiết hiện ra (cửa sổ riêng hay ngay trong bảng), có xuống dòng không, và
// cột nào hiện — cả ba do người dùng chọn ở `InfraLogsPrefsModal`.
//
// KHÔNG clipboard ở đây — component chỉ emit; chủ màn sở hữu `navigator.clipboard`
// và toast, để thông báo nằm cùng chỗ với mọi thông báo khác của màn Logs.
import InfraLogRowDetail from '~/components/infra/logs/InfraLogRowDetail.vue'
import InfraLogRowModal from '~/components/infra/logs/InfraLogRowModal.vue'
import InfraLogsPrefsModal from '~/components/infra/logs/InfraLogsPrefsModal.vue'
import { useLogPrefs } from '~/composables/useLogPrefs'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'

const props = defineProps<{
  rows: AwsInsightsRow[]
  copied?: boolean
  emptyText?: string
  /** Đang chờ lượt đầu tiên — quyết định hiện "đang tải" hay "không có dữ liệu". */
  loading?: boolean
  /** Kéo giãn bảng lấp đầy cột chính (layout Kibana 3/9) thay vì cao cố định. */
  fill?: boolean
}>()

const emit = defineEmits<{
  copy: [text: string]
  'send-to-chat': [text: string]
  trace: [id: string]
}>()

const { t } = useI18n()
const { prefs, visible } = useLogPrefs()

const prefsOpen = ref(false)
/** Chỉ số các dòng đang mở. `pane` chỉ giữ một, `inline` giữ bao nhiêu cũng được. */
const openRows = ref<Set<number>>(new Set())

const columns = computed<string[]>(() => {
  const out: string[] = []
  for (const row of props.rows) {
    for (const key of Object.keys(row)) if (!out.includes(key)) out.push(key)
  }
  // `@timestamp` và `@message` lên trước: hai cột đó là lý do người ta mở log.
  const head = ['@timestamp', '@message'].filter((c) => out.includes(c))
  return [...head, ...out.filter((c) => !head.includes(c))]
})

const visibleColumns = computed(() => visible(columns.value))

/** Dòng đang hiện ở cửa sổ riêng — `null` ở chế độ inline hoặc khi chưa chọn. */
const paneRow = computed<AwsInsightsRow | null>(() => {
  if (prefs.value.rowMode !== 'pane') return null
  const [first] = openRows.value
  return first === undefined ? null : (props.rows[first] ?? null)
})

// ── Lên đầu / xuống cuối ────────────────────────────────────────────────────
// Bảng có khung cuộn RIÊNG (`.lrs-tablewrap`), không cuộn theo trang — nên phím
// Home/End của trình duyệt không tới được nó, và hai nút này là đường duy nhất.
const scrollerRef = useTemplateRef<HTMLElement>('scrollerRef')
const canScroll = ref(false)
const atTop = ref(true)
const atBottom = ref(false)

/** Ngưỡng coi là "đã chạm mép" — cuộn mượt hiếm khi dừng đúng số nguyên. */
const EDGE_PX = 8

function measureScroll(): void {
  const el = scrollerRef.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  canScroll.value = max > EDGE_PX
  atTop.value = el.scrollTop <= EDGE_PX
  atBottom.value = el.scrollTop >= max - EDGE_PX
}

function onScroll(): void {
  measureScroll()
}

function jump(where: 'top' | 'bottom'): void {
  const el = scrollerRef.value
  if (!el) return
  el.scrollTo({ top: where === 'top' ? 0 : el.scrollHeight, behavior: 'smooth' })
}

// Đổi kết quả thì đo lại SAU khi DOM vẽ xong — `rows` đổi trước, chiều cao đổi sau.
watch(
  () => props.rows,
  async () => {
    await nextTick()
    measureScroll()
  },
)
onMounted(measureScroll)

function closePane(): void {
  openRows.value = new Set()
}

function isOpen(i: number): boolean {
  return openRows.value.has(i)
}

function select(i: number): void {
  const next = new Set(prefs.value.rowMode === 'inline' ? openRows.value : [])
  if (next.has(i)) next.delete(i)
  else next.add(i)
  openRows.value = next
}

/** Mở sẵn mọi dòng — chỉ có nghĩa ở chế độ inline, xem ghi chú trong hộp Tuỳ chọn. */
function reseed(): void {
  openRows.value =
    prefs.value.rowMode === 'inline' && prefs.value.expandByDefault
      ? new Set(props.rows.map((_, i) => i))
      : new Set()
}

// Đổi kết quả (chạy lại / lọc) thì dựng lại tập đang mở: giữ chỉ số cũ sau khi mảng
// đổi nghĩa là trỏ vào một dòng KHÁC với dòng người dùng đang đọc. Đổi tuỳ chọn cũng
// dựng lại, vì "mở sẵn" chỉ áp được tại thời điểm nó được bật.
watch(() => props.rows, reseed)
watch(() => [prefs.value.rowMode, prefs.value.expandByDefault], reseed)
onMounted(reseed)
</script>

<style scoped>
.lrs {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
  /* Khối neo cho cụm nút lên/xuống nổi ở góc. */
  position: relative;
}

/* Layout Kibana 3/9: bảng lấp đầy cột chính thay vì cao cố định 340px. */
.lrs.fill {
  flex: 1 1 auto;
}

/* Thanh công cụ KHÔNG phụ thuộc `fill` — số dòng và nút tuỳ chọn phải nằm hai đầu
   ở mọi chỗ dùng bảng. `flex: 0 0 auto` để nó không bị bảng ép bẹp. */
.lrs-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.lrs-bar-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
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

/* Ô nội dung mặc định KHÔNG xuống dòng.
   Đo được: một dòng log JSON 2.4KB khi xuống dòng chiếm 883px — cao hơn cả khung
   bảng (646px) — và một mình nó đẩy 32 hàng khác ra khỏi tầm nhìn. `<td>` thì
   `max-height` vô tác dụng (ô bảng coi height là chiều cao TỐI THIỂU), nên cách duy
   nhất giữ hàng đều là không cho chữ xuống dòng. Ai cần đọc nguyên dòng thì mở chi
   tiết; ai chấp nhận đánh đổi thì bật "Xuống dòng" trong hộp Tuỳ chọn. */
.lrs-td.msg {
  max-width: 560px;
}

.lrs-td.wrap {
  white-space: pre-wrap;
  word-break: break-word;
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

/* Cụm nút điều hướng NỔI ở góc dưới phải khung bảng. Cùng luật với nút đọc thêm:
   `absolute` nên không chiếm ô layout, mờ khi rảnh để không tranh chỗ với chính
   những dòng log nó giúp đi tới. Đặt bên PHẢI để không đụng nút đọc thêm ở giữa. */
.lrs-nav {
  position: absolute;
  right: 14px;
  bottom: 10px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lrs-navbtn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bgEl);
  color: var(--textDim);
  box-shadow: var(--shadow-md);
  opacity: 0.4;
  cursor: pointer;
  transition:
    opacity 0.15s,
    color 0.15s;
}

.lrs-navbtn:hover {
  opacity: 1;
  color: var(--text);
}

.lrs-navic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

/* Sprite không có mũi tên LÊN — xoay mũi tên xuống. */
.lrs-navic.up {
  transform: rotate(180deg);
}

.lrs-xtd {
  padding: 10px 12px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bgInput);
}
</style>
