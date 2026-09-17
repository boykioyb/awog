<template>
  <!-- Log ứng dụng trong màn Giám sát — HAI TẦNG, và thứ tự là có chủ ý.

       Số liệu CloudWatch nói CÓ BAO NHIÊU lỗi; chúng không nói LỖI GÌ. Câu người ta
       hỏi trước là câu thứ hai ("5 phút qua có lỗi gì"), nên phần ĐỌC đứng trên và
       chạy bằng `filter-log-events` — tính tiền theo số request, rẻ, không cần hộp
       duyệt. Phần ĐẾM theo thời gian dùng Insights (tính theo GB quét) nên nó nằm
       dưới, thu lại, và có ước lượng riêng.

       Bản đầu chỉ có phần đếm, và người dùng chỉ ra ngay rằng một cột số không trả
       lời được câu hỏi của họ. -->
  <section class="ile icard">
    <div class="ile-head">
      <span class="ile-title">{{ t('infra.monitoring.logErrors.title') }}</span>
      <span v-if="read" class="ile-sum" :class="recentTotal > 0 ? 'is-bad' : 'is-ok'">
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
    <div v-if="!ready" class="ile-row">
      <p class="ile-hint">{{ t('infra.monitoring.logErrors.needGroups') }}</p>
      <button
        type="button"
        class="btn sm"
        :disabled="resolving || !target"
        :aria-busy="resolving"
        @click="emit('resolve')"
      >
        <Icon name="search" class="ile-ic" />
        {{ t('infra.monitoring.logErrors.find') }}
      </button>
    </div>

    <template v-else>
      <div class="ile-row">
        <!-- Nhóm log hiện RA, không giấu: mọi kết luận bên dưới chỉ đúng nếu danh
             sách này đúng, và người dùng là người duy nhất biết nó có đúng không. -->
        <span class="ile-groups" :title="groups.join('\n')">{{ groups.join(' · ') }}</span>

        <!-- Cửa sổ nhanh, TÁCH khỏi khoảng thời gian của biểu đồ: "5 phút qua" là
             câu hỏi lúc vừa có chuyện, không cùng nhịp với trục 3 giờ của số liệu. -->
        <div class="ile-spans">
          <button
            v-for="s in RECENT_SPANS"
            :key="s"
            type="button"
            class="ile-span"
            :class="{ on: readSpan === s && read }"
            :disabled="reading"
            @click="emit('read', s)"
          >
            {{ spanLabelOf(s) }}
          </button>
        </div>

        <button
          type="button"
          class="btn sm pri"
          :disabled="reading"
          :aria-busy="reading"
          @click="emit('read', readSpan)"
        >
          <Icon name="refresh" class="ile-ic" :class="reading ? 'ile-spin' : ''" />
          {{ read ? t('infra.monitoring.logErrors.reread') : t('infra.monitoring.logErrors.read') }}
        </button>
      </div>

      <!-- PHỎNG ĐOÁN PHẢI NÓI RA LÀ PHỎNG ĐOÁN. Với ECS ta đọc tên nhóm từ task
           definition; với loại khác ta khớp theo tên, nên danh sách sót được — và
           "không có lỗi nào" dựng trên nhóm log sai là kết luận sai tệ nhất. -->
      <p v-if="basis === 'guess'" class="ile-warn">
        {{ t('infra.monitoring.logErrors.guessed') }}
      </p>
      <p v-if="readError" class="ile-warn" :title="readError">
        {{ t('infra.monitoring.logErrors.partial', { err: readError }) }}
      </p>
      <p v-if="readTruncated" class="ile-warn">
        {{ t('infra.monitoring.logErrors.tooMany') }}
      </p>
      <!-- Bộ lọc của CloudWatch chỉ so chuỗi con, nên nó bắt cả dòng INFO có chữ
           "exception" trong tên component. Số bị loại nói ra ở đây, KHÔNG giấu: nó
           là lý do con số trên đầu nhỏ hơn số dòng AWS trả về. -->
      <p v-if="read && readDropped > 0" class="ile-note">
        {{ t('infra.monitoring.logErrors.dropped', { n: readDropped }) }}
      </p>

      <!-- Một nhóm = một lỗi, KHÔNG phải một dòng. Năm trăm dòng cùng một timeout
           đọc ra là "×500", nên ba lỗi khác không bị đẩy khỏi tầm mắt. -->
      <ul v-if="recent.length > 0" class="ile-list">
        <li v-for="g in recent" :key="g.key" class="ile-item">
          <div class="ile-item-hd">
            <span class="ile-when">{{ timeOf(g.lastMs) }}</span>
            <span v-if="g.count > 1" class="ile-count">×{{ g.count }}</span>
            <!-- Một task hỏng hay cả cụm hỏng là HAI sự cố khác nhau, và số stream
                 là thứ duy nhất ở đây phân biệt được chúng. -->
            <span v-if="g.streams > 1" class="ile-streams">
              {{ t('infra.monitoring.logErrors.streams', { n: g.streams }) }}
            </span>
          </div>
          <pre class="ile-msg">{{ g.sample }}</pre>
        </li>
      </ul>

      <p v-else-if="read" class="ile-hint">
        {{ t('infra.monitoring.logErrors.noneFound', { span: spanLabel }) }}
      </p>

      <!-- ĐẾM theo thời gian: câu hỏi thứ hai, đồng hồ tính tiền thứ hai. Thu lại
           mặc định vì phần lớn lượt mở màn này chỉ cần phần đọc ở trên. -->
      <details class="ile-more">
        <summary class="ile-sum-line">{{ t('infra.monitoring.logErrors.countTitle') }}</summary>
        <div class="ile-more-body">
          <p class="ile-hint">{{ t('infra.monitoring.logErrors.countWhy') }}</p>
          <div class="ile-row">
            <span v-if="ran" class="ile-scan">
              {{ t('infra.monitoring.logErrors.scanned', { gb: scannedGb }) }}
            </span>
            <button
              type="button"
              class="btn sm"
              :disabled="running || !window"
              :aria-busy="running"
              @click="emit('run')"
            >
              <Icon name="act" class="ile-ic" />
              {{
                ran ? t('infra.monitoring.logErrors.rerun') : t('infra.monitoring.logErrors.run')
              }}
            </button>
          </div>
          <p v-if="error" class="ierr">{{ error }}</p>
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
        </div>
      </details>
    </template>
  </section>
</template>

<script setup lang="ts">
// Lớp bind thuần — mọi state và lời gọi ở `useInfraLogErrors`.
import { computed } from 'vue'
import { RECENT_SPANS, type RecentSpan } from '~/composables/useInfraLogErrors'
import { formatAxisTime } from '~/composables/useInfraMetrics'
import type { ChartSeriesView, MonitorTarget, WirePoint } from '~/composables/useInfraMetrics'
import type { ErrorGroup } from '~/utils/log-errors'

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

<style scoped>
.ile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  /* Da (viền, bo góc, nền, đổ bóng) do `.icard` cấp — xem app-shell.css. Bốn khối
     của màn này TỪNG tự khai lại cùng một bộ, với ba nền khác nhau (`--bgSubtle`,
     `--bgEl`), nên chúng đọc ra thành ba loại bề mặt trong cùng một màn. */
}

.ile-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.ile-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
  color: var(--text);
}

.ile-sum {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
}

.ile-sum.is-bad {
  color: var(--danger);
}

.ile-sum.is-ok {
  color: var(--accent);
}

.ile-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.ile-hint {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}

/* Một dòng: danh sách nhóm log dài và khung này nằm trong cột cuộn. Toàn văn ở `title`. */
.ile-groups {
  flex: 1 1 160px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textMuted);
  font-family: var(--code); /* mono-ok: tên nhóm log dán được vào lệnh aws */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ile-spans {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 4px;
}

.ile-span {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.ile-span:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}

/* Accent-tint, KHÔNG nền xám đặc — cùng luật chọn của `.ni.on` toàn app. */
.ile-span.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}

.ile-span:disabled {
  opacity: 0.45;
  cursor: default;
}

.ile-note {
  margin: 0;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}

.ile-warn {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}

.ile-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  /* Nhiều lỗi khác nhau thì khung này không được nuốt cả màn — cuộn trong chính nó. */
  max-height: 340px;
  overflow-y: auto;
}

.ile-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bg);
}

.ile-item-hd {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ile-when {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.ile-count {
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.ile-streams {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Nguyên văn dòng log: giữ xuống dòng của stack trace, nhưng bọc chứ không tràn
   ngang — khung này nằm trong một cột hẹp. */
.ile-msg {
  margin: 0;
  max-height: 96px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text);
  font-family: var(--code); /* mono-ok: nguyên văn dòng log, dán lại được */
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ile-more {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}

.ile-sum-line {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.ile-more-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

.ile-scan {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.ile-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.ile-spin {
  animation: ile-rot 1s linear infinite;
}

@keyframes ile-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
