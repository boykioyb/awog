<template>
  <div class="flex min-h-0 flex-auto flex-col gap-2">
    <!-- ── Thanh chạy: id + nút ─────────────────────────────────────────────── -->
    <!-- Thanh công cụ là một Card; mỗi cụm nghĩa là một đơn vị gãy dòng (`shrink-0`)
         nên khi hẹp thanh xuống dòng theo cụm, không bỏ rơi một nút lẻ. -->
    <Card class="shrink-0 flex-row flex-wrap items-center gap-2.5 px-2.5 py-2">
      <div class="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-1.5">
        <div class="relative flex min-w-0 flex-auto items-center">
          <!-- mono-ok: trace id là chuỗi người dùng copy-paste từ log/terminal -->
          <Input
            v-model="traceId"
            type="text"
            spellcheck="false"
            :placeholder="t('infra.trace.idPh')"
            :aria-label="t('infra.trace.idLabel')"
            class="h-ctrl-sm font-mono"
            :class="kindLabel ? 'pr-24' : ''"
            @keydown.enter.prevent="emit('run')"
          />
          <span
            v-if="kindLabel"
            class="pointer-events-none absolute right-2.5 text-xs whitespace-nowrap text-dim"
          >
            {{ kindLabel }}
          </span>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-1.5">
        <Button type="button" :disabled="!canRun" variant="default" @click="emit('run')">
          <Icon :name="running ? 'clock' : 'branch'" />
          {{ running ? t('infra.trace.running') : t('infra.trace.go') }}
        </Button>
        <Button v-if="running" type="button" variant="outline" @click="emit('cancel')">
          <Icon name="stop" />
          {{ t('infra.trace.cancel') }}
        </Button>
      </div>

      <div class="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        <span v-if="trace" class="text-xs text-muted-foreground">
          {{ t(`infra.trace.source.${trace.source}`) }}
          <span v-if="trace.totalMs !== null" class="text-faint">
            · {{ t('infra.trace.total', { ms: formatMs(trace.totalMs) }) }}
          </span>
        </span>
        <!-- Chi phí: số ĐO ĐƯỢC khi đã có, còn lúc đang chạy thì con số ước lượng
             mà sidecar tính bằng CHÍNH câu lần-theo này. -->
        <span v-if="bytesScanned > 0" class="text-xs text-muted-foreground">
          {{
            t('infra.trace.scanned', { size: formatBytes(bytesScanned), usd: usdOf(bytesScanned) })
          }}
        </span>
        <span v-else-if="estimate" class="text-xs text-faint">
          {{
            t('infra.trace.estimate', {
              size: formatBytes(estimate.bytes),
              usd: estimate.usd.toFixed(4),
            })
          }}
          {{
            estimate.basis === 'history'
              ? t('infra.trace.basisHistory')
              : t('infra.trace.basisStored')
          }}
        </span>
        <Button
          v-if="trace && trace.hops.length > 0"
          type="button"
          :title="t('infra.trace.onGraphHint')"
          variant="outline"
          size="sm"
          @click="emit('show-on-graph')"
        >
          <Icon name="branch" />
          {{ t('infra.trace.onGraph') }}
        </Button>
      </div>
    </Card>

    <!-- Câu nói thật về NGUỒN. Nhánh log không có độ trễ từng chặng, và người đọc
         phải biết điều đó TRƯỚC khi diễn giải các con số bên dưới. -->
    <p v-if="trace" class="text-xs leading-(--lh-sm) text-dim">
      {{ t(`infra.trace.sourceNote.${trace.source}`) }}
    </p>
    <p v-for="key in notes" :key="key" class="text-xs leading-(--lh-sm) text-dim">{{ t(key) }}</p>
    <p v-if="error" class="text-xs leading-(--lh-sm) text-destructive">{{ errorText }}</p>
    <p v-if="trace?.truncated" class="text-xs leading-(--lh-sm) text-warning">
      {{ t('infra.trace.truncated') }}
    </p>

    <!-- ── Dòng thời gian dọc ───────────────────────────────────────────────── -->
    <div
      v-if="trace && trace.hops.length > 0"
      class="flex flex-auto flex-col overflow-auto px-0.5 py-1"
    >
      <div v-for="(hop, i) in trace.hops" :key="hop.key" class="flex min-h-0 gap-2.5">
        <div class="flex shrink-0 flex-col items-center">
          <span
            class="flex size-6.5 shrink-0 items-center justify-center rounded-full border"
            :class="
              hop.status === 'error'
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'bg-card text-muted-foreground'
            "
          >
            <Icon :name="serviceIcon(hop.service)" class="size-3.5" />
          </span>
          <!-- Đường nối kéo dài hết phần thân của chặng — chiều cao do flex quyết
               định, nên một chặng đang mở log vẫn nối liền xuống chặng sau. -->
          <span v-if="i < trace.hops.length - 1" class="min-h-3 w-px flex-auto bg-border" />
        </div>

        <div class="min-w-0 flex-auto pb-2.5">
          <!-- raw-ok: tiêu đề chặng là cả một hàng bấm để mở/đóng log, không phải nút -->
          <button
            class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-0.5 text-left text-foreground hover:bg-accent"
            type="button"
            @click="emit('toggle-hop', hop.key)"
          >
            <span class="max-w-85 truncate text-sm font-semibold" :title="hop.label">
              {{ hop.label }}
            </span>
            <span class="text-xs whitespace-nowrap text-dim">{{ hop.service }}</span>
            <Badge
              v-if="hop.status === 'error'"
              variant="outline"
              class="border-destructive/40 px-1.5 py-0 font-normal text-destructive"
            >
              {{ hop.note || t('infra.trace.failed') }}
            </Badge>
            <Badge v-else-if="hop.note" variant="outline" class="px-1.5 py-0 font-normal text-dim">
              {{ hop.note }}
            </Badge>
            <span class="flex-auto" />
            <span class="text-xs whitespace-nowrap text-dim tabular-nums">
              {{ clock(hop.firstAt) }}
            </span>
            <!-- Độ trễ THẬT chỉ có ở nhánh X-Ray; nhãn khác nhau cố ý, để không ai
                 đọc "cách chặng sau 400ms" thành "chặng này chạy mất 400ms". -->
            <span
              v-if="hop.durationMs !== null"
              class="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {{ t('infra.trace.duration', { ms: formatMs(hop.durationMs) }) }}
            </span>
            <span
              v-else-if="hop.gapToNextMs !== null"
              class="text-xs whitespace-nowrap text-faint tabular-nums"
            >
              {{ t('infra.trace.gap', { ms: formatMs(hop.gapToNextMs) }) }}
            </span>
            <Icon :name="openHopKey === hop.key ? 'chev' : 'chev-right'" class="size-3" />
          </button>

          <div class="flex items-center gap-2 px-1.5 text-xs text-faint">
            <!-- `count` ở nhánh X-Ray đếm SEGMENT, không đếm dòng log — hiện "1 dòng"
                 cạnh một chặng mà mở ra lại nói "không kèm dòng log nào" là tự mâu
                 thuẫn. Nhãn này vì thế chỉ có nghĩa ở nhánh log. -->
            <span v-if="trace?.source === 'logs'">
              {{ t('infra.trace.lines', { n: hop.count }) }}
            </span>
            <Button
              v-if="hop.logGroup"
              variant="link"
              size="xs"
              class="h-auto p-0 font-normal"
              :title="hop.logGroup"
              @click="emit('open-logs', hop.logGroup)"
            >
              {{ t('infra.trace.openLogs') }}
            </Button>
          </div>

          <div
            v-if="openHopKey === hop.key"
            class="mt-1 max-h-55 overflow-auto rounded-md border bg-card"
          >
            <p
              v-if="hop.rows.length === 0"
              class="px-2 py-1.5 text-xs leading-(--lh-sm) text-faint"
            >
              {{ t('infra.trace.noRows') }}
            </p>
            <template v-else>
              <!-- mono-ok: dòng log nguyên bản -->
              <pre
                v-for="(row, ri) in hop.rows"
                :key="ri"
                class="m-0 border-b px-2 py-1 font-mono text-xs leading-(--lh-sm) break-words whitespace-pre-wrap text-muted-foreground last:border-b-0"
                >{{ row['@message'] ?? '' }}</pre
              >
              <p v-if="hop.rowsTruncated" class="px-2 py-1.5 text-xs leading-(--lh-sm) text-faint">
                {{ t('infra.trace.rowsTruncated', { n: hop.count }) }}
              </p>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Rỗng KHÔNG im lặng: mỗi ca nói ra bước tiếp theo. -->
    <div
      v-else
      class="flex flex-auto flex-col items-center justify-center gap-1.5 px-3 py-5.5 text-dim"
    >
      <Icon name="branch" class="size-5" />
      <p class="max-w-105 text-center text-sm">{{ emptyText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Dòng thời gian của MỘT request (L5, `cloudwatch-logs.md` §6).
//
// SFC này chỉ VẼ: state + lời gọi RPC nằm ở `useInfraTrace()`. Nó cố ý không biết
// truy vấn nào đang chạy hay tài khoản nào đang ghim.
//
// HAI CON SỐ KHÁC NHAU, HAI NHÃN KHÁC NHAU. `durationMs` là độ trễ THẬT của chặng
// (chỉ X-Ray có); `gapToNextMs` chỉ là khoảng cách giữa hai mốc log. Dùng chung một
// nhãn cho cả hai là mời người đọc kết luận sai về chỗ hệ thống chậm — đúng thứ màn
// này sinh ra để trả lời.
import type { AwsTrace, AwsTraceIdKind } from '~/composables/useAwsLogsApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  trace: AwsTrace | null
  running: boolean
  canRun: boolean
  error: string
  notes: string[]
  /** Ước lượng quét do sidecar tính bằng đúng câu lần-theo (nhánh log). */
  estimate: { bytes: number; usd: number; basis: 'history' | 'stored' } | null
  /** Byte THẬT đã quét của lượt vừa rồi — con số quyết định hoá đơn. */
  bytesScanned: number
  openHopKey: string
  /** Đã chọn nhóm log nào chưa — quyết định câu nói ở trạng thái rỗng. */
  hasGroups: boolean
}>()

const traceId = defineModel<string>('traceId', { required: true })

const emit = defineEmits<{
  run: []
  cancel: []
  'toggle-hop': [key: string]
  'open-logs': [logGroup: string]
  'show-on-graph': []
}>()

const { t } = useI18n()

/** Loại id — suy TẠI CHỖ để ô id nói ngay khi gõ, không đợi một lượt chạy. */
const kind = computed<AwsTraceIdKind | null>(() => {
  const id = traceId.value.trim()
  if (id.length === 0) return null
  if (/^1-[0-9a-f]{8}-[0-9a-f]{24}$/.test(id)) return 'xray'
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'request'
  return 'free'
})

const kindLabel = computed(() => (kind.value ? t(`infra.trace.kind.${kind.value}`) : ''))

/**
 * Mã lỗi mà sidecar/AWS có thể trả về và ta có câu tiếng người cho. Mã NGOÀI danh
 * sách vẫn hiện được — kèm nguyên mã — thay vì rơi vào một khoá i18n không tồn tại
 * rồi in ra `infra.trace.error.XYZ` trên màn hình.
 */
const KNOWN_ERRORS = new Set([
  'EMPTY_TRACE_ID',
  'TRACE_ID_TOO_LONG',
  'INVALID_TRACE_ID',
  'NO_LOG_GROUP',
  'TOO_MANY_LOG_GROUPS',
  'INVALID_WINDOW',
  'TIMEOUT',
  'Failed',
  'Cancelled',
  'Timeout',
  'Unknown',
])

const errorText = computed(() => {
  const code = props.error
  if (!code) return ''
  return KNOWN_ERRORS.has(code)
    ? t(`infra.trace.error.${code}`)
    : t('infra.trace.error.other', { code })
})

const emptyText = computed(() => {
  if (props.running) return t('infra.trace.emptyRunning')
  if (props.trace) return t('infra.trace.emptyNoHop')
  if (!props.hasGroups) return t('infra.trace.emptyNoGroup')
  return t('infra.trace.emptyIdle')
})

/** Biểu tượng theo dịch vụ — cùng từ vựng với node của sơ đồ. */
function serviceIcon(service: string): string {
  switch (service) {
    case 'lambda':
      return 'zap'
    case 'apigateway':
      return 'globe'
    case 'ecs':
    case 'eks':
      return 'k8s'
    case 'rds':
      return 'table'
    case 'cloudfront':
      return 'globe'
    default:
      return 'file'
  }
}

function clock(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, '0')}`
}

/** Khớp `INSIGHTS_USD_PER_GB` của sidecar — đây chỉ là bản hiển thị. */
const USD_PER_GB = 0.005

function usdOf(bytes: number): string {
  return ((bytes / 1024 ** 3) * USD_PER_GB).toFixed(4)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

/** Mili-giây → chuỗi đọc được. Dưới 1s giữ nguyên ms, trên thì đổi sang giây. */
function formatMs(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${String(Math.round(ms))} ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}
</script>
