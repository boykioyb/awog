<template>
  <!-- Log ứng dụng trong màn Giám sát — HAI TẦNG, và thứ tự là có chủ ý.

       Số liệu CloudWatch nói CÓ BAO NHIÊU lỗi; chúng không nói LỖI GÌ. Câu người ta
       hỏi trước là câu thứ hai ("5 phút qua có lỗi gì"), nên phần ĐỌC đứng trên và
       chạy bằng `filter-log-events` — tính tiền theo số request, rẻ, không cần hộp
       duyệt. Phần ĐẾM theo thời gian dùng Insights (tính theo GB quét) nên nó nằm
       dưới, thu lại, và có ước lượng riêng.

       Bản đầu chỉ có phần đếm, và người dùng chỉ ra ngay rằng một cột số không trả
       lời được câu hỏi của họ. -->
  <Card class="gap-2 px-3 py-2.5">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-sm font-semibold text-foreground">
        {{ t('infra.monitoring.logErrors.title') }}
      </span>
      <span
        v-if="read"
        class="text-xs font-semibold"
        :class="recentTotal > 0 ? 'text-destructive' : 'text-primary'"
      >
        {{
          recentTotal > 0
            ? t('infra.monitoring.logErrors.found', {
                n: recentTotal,
                k: recent.length,
                span: spanLabel,
              })
            : t('infra.monitoring.logErrors.clean', { span: spanLabel })
        }}
      </span>
    </div>

    <!-- Chưa biết nhóm log nào ⇒ bước RẺ trước: đi tìm, rồi mới đọc được. -->
    <div v-if="!ready" class="flex min-w-0 flex-wrap items-center gap-2">
      <p class="min-w-0 flex-auto text-xs leading-(--lh-prose) text-dim">
        {{ t('infra.monitoring.logErrors.needGroups') }}
      </p>
      <Button
        type="button"
        :disabled="resolving || !target"
        :aria-busy="resolving"
        variant="outline"
        size="sm"
        @click="emit('resolve')"
      >
        <Icon name="search" />
        {{ t('infra.monitoring.logErrors.find') }}
      </Button>
    </div>

    <template v-else>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <!-- Nhóm log hiện RA, không giấu: mọi kết luận bên dưới chỉ đúng nếu danh
             sách này đúng, và người dùng là người duy nhất biết nó có đúng không.
             Một dòng: danh sách dài và khung này nằm trong cột cuộn — toàn văn ở `title`. -->
        <!-- mono-ok: tên nhóm log dán được vào lệnh aws -->
        <span
          class="min-w-0 flex-[1_1_10rem] truncate font-mono text-xs text-muted-foreground"
          :title="groups.join('\n')"
        >
          {{ groups.join(' · ') }}
        </span>

        <!-- Cửa sổ nhanh, TÁCH khỏi khoảng thời gian của biểu đồ: "5 phút qua" là
             câu hỏi lúc vừa có chuyện, không cùng nhịp với trục 3 giờ của số liệu.
             Mỗi nút là một LỆNH đọc (bấm lại ô đang chọn = đọc lại), nên dùng Button
             chứ không ToggleGroup — ToggleGroup bấm lại ô đang bật là bỏ chọn. -->
        <div class="inline-flex shrink-0 gap-1">
          <Button
            v-for="s in RECENT_SPANS"
            :key="s"
            variant="outline"
            size="xs"
            class="h-auto rounded-full px-2 py-0.5 font-normal shadow-none"
            :class="
              readSpan === s && read
                ? 'border-selected-border bg-selected text-primary'
                : 'text-dim hover:border-selected-border hover:bg-transparent hover:text-primary'
            "
            :aria-pressed="readSpan === s && read"
            :disabled="reading"
            @click="emit('read', s)"
          >
            {{ spanLabelOf(s) }}
          </Button>
        </div>

        <Button
          type="button"
          :disabled="reading"
          :aria-busy="reading"
          variant="default"
          size="sm"
          @click="emit('read', readSpan)"
        >
          <Icon name="refresh" :class="reading ? 'animate-spin' : ''" />
          {{ read ? t('infra.monitoring.logErrors.reread') : t('infra.monitoring.logErrors.read') }}
        </Button>
      </div>

      <!-- PHỎNG ĐOÁN PHẢI NÓI RA LÀ PHỎNG ĐOÁN. Với ECS ta đọc tên nhóm từ task
           definition; với loại khác ta khớp theo tên, nên danh sách sót được — và
           "không có lỗi nào" dựng trên nhóm log sai là kết luận sai tệ nhất. -->
      <p v-if="basis === 'guess'" class="truncate text-xs leading-(--lh-prose) text-warning">
        {{ t('infra.monitoring.logErrors.guessed') }}
      </p>
      <p
        v-if="readError"
        class="truncate text-xs leading-(--lh-prose) text-warning"
        :title="readError"
      >
        {{ t('infra.monitoring.logErrors.partial', { err: readError }) }}
      </p>
      <p v-if="readTruncated" class="truncate text-xs leading-(--lh-prose) text-warning">
        {{ t('infra.monitoring.logErrors.tooMany') }}
      </p>
      <!-- Bộ lọc của CloudWatch chỉ so chuỗi con, nên nó bắt cả dòng INFO có chữ
           "exception" trong tên component. Số bị loại nói ra ở đây, KHÔNG giấu: nó
           là lý do con số trên đầu nhỏ hơn số dòng AWS trả về. -->
      <p v-if="read && readDropped > 0" class="text-xs leading-(--lh-prose) text-faint">
        {{ t('infra.monitoring.logErrors.dropped', { n: readDropped }) }}
      </p>

      <!-- Một nhóm = một lỗi, KHÔNG phải một dòng. Năm trăm dòng cùng một timeout
           đọc ra là "×500", nên ba lỗi khác không bị đẩy khỏi tầm mắt. Nhiều lỗi khác
           nhau thì khung này không được nuốt cả màn — cuộn trong chính nó. -->
      <ul
        v-if="recent.length > 0"
        class="m-0 flex max-h-85 list-none flex-col gap-1.5 overflow-y-auto p-0"
      >
        <li
          v-for="g in recent"
          :key="g.key"
          class="flex flex-col gap-0.5 rounded-sm border bg-background px-2 py-1.5"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-xs text-faint tabular-nums">{{ timeOf(g.lastMs) }}</span>
            <span v-if="g.count > 1" class="text-xs font-semibold text-destructive tabular-nums">
              ×{{ g.count }}
            </span>
            <!-- Một task hỏng hay cả cụm hỏng là HAI sự cố khác nhau, và số stream
                 là thứ duy nhất ở đây phân biệt được chúng. -->
            <span v-if="g.streams > 1" class="text-xs text-dim">
              {{ t('infra.monitoring.logErrors.streams', { n: g.streams }) }}
            </span>
          </div>
          <!-- mono-ok: nguyên văn dòng log, dán lại được. Giữ xuống dòng của stack
               trace nhưng bọc chứ không tràn ngang — khung này nằm trong cột hẹp. -->
          <pre
            class="m-0 max-h-24 overflow-auto font-mono text-xs wrap-anywhere whitespace-pre-wrap text-foreground"
            >{{ g.sample }}</pre
          >
        </li>
      </ul>

      <p v-else-if="read" class="text-xs leading-(--lh-prose) text-dim">
        {{ t('infra.monitoring.logErrors.noneFound', { span: spanLabel }) }}
      </p>

      <!-- ĐẾM theo thời gian: câu hỏi thứ hai, đồng hồ tính tiền thứ hai. Thu lại
           mặc định vì phần lớn lượt mở màn này chỉ cần phần đọc ở trên. Giữ nội dung
           MOUNT khi thu (`unmount-on-hide=false`) như `<details>` trước đây — biểu đồ
           đã chạy không bị dựng lại mỗi lần mở. -->
      <Collapsible :unmount-on-hide="false" class="border-t pt-1.5">
        <CollapsibleTrigger
          class="cursor-pointer text-xs text-dim hover:text-foreground [&[data-state=open]_svg]:rotate-90"
        >
          <span class="inline-flex items-center gap-1">
            <Icon name="chev-right" class="size-3 transition-transform" />
            {{ t('infra.monitoring.logErrors.countTitle') }}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent class="flex flex-col gap-2 pt-2">
          <p class="text-xs leading-(--lh-prose) text-dim">
            {{ t('infra.monitoring.logErrors.countWhy') }}
          </p>
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <span v-if="ran" class="text-xs text-faint tabular-nums">
              {{ t('infra.monitoring.logErrors.scanned', { gb: scannedGb }) }}
            </span>
            <Button
              type="button"
              :disabled="running || !window"
              :aria-busy="running"
              variant="outline"
              size="sm"
              @click="emit('run')"
            >
              <Icon name="act" />
              {{
                ran ? t('infra.monitoring.logErrors.rerun') : t('infra.monitoring.logErrors.run')
              }}
            </Button>
          </div>
          <p v-if="error" class="mt-1.5 text-xs text-destructive">{{ error }}</p>
          <MetricChart
            v-if="ran"
            :title="t('infra.monitoring.logErrors.chart')"
            kind="bar"
            unit="Count"
            :series="series"
            :window="window"
            :window-seconds="windowSeconds"
            :period-seconds="periodSeconds"
            :incidents="[]"
            :threshold="null"
            :loading="running"
          />
        </CollapsibleContent>
      </Collapsible>
    </template>
  </Card>
</template>

<script setup lang="ts">
// Lớp bind thuần — mọi state và lời gọi ở `useInfraLogErrors`.
import { computed } from 'vue'
import { RECENT_SPANS, type RecentSpan } from '~/composables/useInfraLogErrors'
import { formatAxisTime } from '~/composables/useInfraMetrics'
import type { ChartSeriesView, MonitorTarget, WirePoint } from '~/composables/useInfraMetrics'
import type { ErrorGroup } from '~/utils/log-errors'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  target: MonitorTarget | null
  groups: string[]
  basis: 'exact' | 'guess'
  resolving: boolean
  ready: boolean
  // đọc
  reading: boolean
  recent: ErrorGroup[]
  recentTotal: number
  read: boolean
  readSpan: RecentSpan
  readTruncated: boolean
  readDropped: number
  readError: string
  // đếm
  running: boolean
  points: WirePoint[]
  ran: boolean
  bytesScanned: number
  error: string
  window: { startMs: number; endMs: number } | null
  windowSeconds: number
  periodSeconds: number
}>()

const emit = defineEmits<{
  (e: 'resolve'): void
  (e: 'read', span: RecentSpan): void
  (e: 'run'): void
}>()

const { t } = useI18n()

const scannedGb = computed(() => (props.bytesScanned / 1024 ** 3).toFixed(2))

function spanLabelOf(seconds: number): string {
  return seconds < 3600
    ? t('infra.monitoring.logErrors.spanMin', { n: Math.round(seconds / 60) })
    : t('infra.monitoring.logErrors.spanHour', { n: Math.round(seconds / 3600) })
}

const spanLabel = computed(() => spanLabelOf(props.readSpan))

/** Giờ-phút của dòng mới nhất trong nhóm. Cùng định dạng trục thời gian của biểu đồ. */
function timeOf(ms: number): string {
  return formatAxisTime(ms, 3600)
}

/** Một chuỗi duy nhất cho biểu đồ đếm. */
const series = computed<ChartSeriesView[]>(() => [
  {
    key: 'log-errors',
    label: t('infra.monitoring.logErrors.series'),
    color: 'var(--accent)',
    shade: 1,
    points: props.points,
    missing: props.points.length === 0,
  },
])
</script>
