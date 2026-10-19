<template>
  <!-- Khối neo (`relative`) cho cụm nút lên/xuống nổi ở góc. `fill` = layout Kibana
       3/9: bảng lấp đầy cột chính thay vì cao cố định. -->
  <div class="relative flex min-h-0 flex-col gap-1.5" :class="{ 'flex-auto': fill }">
    <!-- ĐANG TẢI đứng TRƯỚC RỖNG. Cùng là "không có hàng nào", nhưng một cái là
         "chờ chút" còn cái kia là "tìm rồi, không có gì" — hiện nhầm thì người dùng
         kết luận sai về chính dữ liệu của họ ngay trước khi dữ liệu kịp về. -->
    <div
      v-if="loading && rows.length === 0"
      class="flex flex-col items-center gap-1.5 px-3 py-6 text-dim"
      :class="{ 'flex-auto justify-center': fill }"
    >
      <Icon name="clock" class="size-5" />
      <p class="text-sm">{{ t('infra.logs.results.loading') }}</p>
    </div>

    <div
      v-else-if="rows.length === 0"
      class="flex flex-col items-center gap-1.5 px-3 py-6 text-dim"
      :class="{ 'flex-auto justify-center': fill }"
    >
      <Icon name="search" class="size-5" />
      <p class="text-sm">{{ emptyText || t('infra.logs.results.empty') }}</p>
    </div>

    <template v-else>
      <!-- Thanh công cụ KHÔNG phụ thuộc `fill` — số dòng và nút tuỳ chọn phải nằm hai
           đầu ở mọi chỗ dùng bảng; `shrink-0` để nó không bị bảng ép bẹp. -->
      <div class="flex shrink-0 items-center gap-2">
        <span class="text-xs text-dim tabular-nums">
          {{ t('infra.logs.results.rows', { n: rows.length }) }}
        </span>
        <span class="flex-auto" />
        <Button
          type="button"
          :title="t('infra.logs.prefs.hint')"
          variant="outline"
          size="sm"
          @click="prefsOpen = true"
        >
          <Icon name="settings" />
          {{ t('infra.logs.prefs.button') }}
        </Button>
      </div>

      <!-- Khung cuộn RIÊNG của bảng (ref `scrollerRef` đo vị trí cuộn). Bảng luôn nằm
           trong cột chính đã là một Card nên không tự mang khung — card trong card.
           Một luật `max-height` duy nhất: 340px khi không `fill`, bỏ hẳn khi `fill`
           (trước đây hai luật ngang cơ nên bảng `fill` bị ghim 340px). -->
      <div
        ref="scrollerRef"
        class="flex-auto overflow-auto"
        :class="{ 'max-h-85': !fill }"
        @scroll.passive="onScroll"
      >
        <!-- `<table>` trần thay cho `Table` shadcn: `Table` tự bọc một khung
             `overflow-auto` thứ hai, làm header `sticky` bám vào khung đó (không cao
             giới hạn) thay vì khung cuộn ở trên — header trôi mất khi cuộn. Các phần
             bên trong vẫn là TableHeader/TableRow/TableHead/TableCell. -->
        <table class="w-full border-collapse">
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead
                class="sticky top-0 z-1 h-auto w-10 bg-muted px-2 py-1 text-right text-xs font-normal text-faint"
              >
                #
              </TableHead>
              <TableHead
                v-for="c in visibleColumns"
                :key="c"
                class="sticky top-0 z-1 h-auto max-w-55 truncate bg-muted px-2 py-1 text-xs font-semibold text-dim"
                :title="c"
              >
                {{ c }}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-for="(row, i) in rows" :key="i">
              <TableRow
                class="cursor-pointer"
                :class="{ 'bg-selected hover:bg-selected': isOpen(i) }"
                :title="t('infra.logs.results.openRow')"
                @click="select(i)"
              >
                <TableCell class="px-2 py-1 text-right text-xs text-faint tabular-nums">
                  {{ i + 1 }}
                </TableCell>
                <!-- mono-ok: bảng kết quả là bản ghi log thô, cột phải thẳng hàng.
                     Ô nội dung mặc định KHÔNG xuống dòng: một dòng log JSON 2.4KB khi
                     xuống dòng cao hơn cả khung bảng và đẩy 32 hàng khác ra khỏi tầm
                     nhìn; `<td>` thì `max-height` vô tác dụng. Ai cần đọc nguyên dòng
                     thì mở chi tiết, hoặc bật "Xuống dòng" trong hộp Tuỳ chọn. -->
                <TableCell
                  v-for="c in visibleColumns"
                  :key="c"
                  class="overflow-hidden px-2 py-1 font-mono text-xs text-ellipsis text-muted-foreground"
                  :class="[
                    c === '@message' || c === 'message' ? 'max-w-140' : 'max-w-80',
                    prefs.wrapLines ? 'break-words whitespace-pre-wrap' : 'whitespace-nowrap',
                  ]"
                >
                  {{ row[c] ?? '' }}
                </TableCell>
              </TableRow>

              <!-- Chi tiết NGAY TRONG bảng — tuỳ chọn `inline`, nhiều dòng mở cùng
                   lúc được. Ô trải hết bề ngang để chi tiết không bị bó vào một cột. -->
              <TableRow v-if="prefs.rowMode === 'inline' && isOpen(i)" class="hover:bg-transparent">
                <TableCell class="bg-muted px-3 pt-2.5 pb-3" :colspan="visibleColumns.length + 1">
                  <InfraLogRowDetail
                    :row="row"
                    :copied="copied"
                    @copy="emit('copy', $event)"
                    @send-to-chat="emit('send-to-chat', $event)"
                    @trace="emit('trace', $event)"
                  />
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </table>
      </div>

      <!-- Lên đầu / xuống cuối: NỔI ở góc dưới phải, không chiếm một hàng nào của
           bảng, cùng khuôn mờ-khi-rảnh với nút đọc thêm (đặt bên PHẢI để không đụng
           nút đó ở giữa). Chỉ hiện khi bảng THỰC SỰ cuộn được và chỉ hiện hướng còn
           đi được — một nút "lên đầu" khi đang ở đầu là một nút không làm gì. -->
      <div v-if="canScroll" class="absolute right-3.5 bottom-2.5 z-2 flex flex-col gap-1.5">
        <Button
          v-if="!atTop"
          variant="outline"
          size="iconSm"
          class="rounded-full bg-card text-dim opacity-40 shadow-md hover:bg-card hover:text-foreground hover:opacity-100 [&_svg]:size-3"
          :title="t('infra.logs.results.toTop')"
          :aria-label="t('infra.logs.results.toTop')"
          @click="jump('top')"
        >
          <!-- Sprite không có mũi tên LÊN — xoay mũi tên xuống. -->
          <Icon name="chev" class="rotate-180" />
        </Button>
        <Button
          v-if="!atBottom"
          variant="outline"
          size="iconSm"
          class="rounded-full bg-card text-dim opacity-40 shadow-md hover:bg-card hover:text-foreground hover:opacity-100 [&_svg]:size-3"
          :title="t('infra.logs.results.toBottom')"
          :aria-label="t('infra.logs.results.toBottom')"
          @click="jump('bottom')"
        >
          <Icon name="chev" />
        </Button>
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
import Button from '~/components/ui/button/Button.vue'

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
// Bảng có khung cuộn RIÊNG (`scrollerRef`), không cuộn theo trang — nên phím
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
