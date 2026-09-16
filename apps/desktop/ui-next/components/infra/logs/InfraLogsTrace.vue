<template>
  <div class="ltr">
    <!-- ── Thanh chạy: id + nút ─────────────────────────────────────────────── -->
    <div class="itoolbar ltr-bar">
      <div class="itoolgrp ltr-idgrp">
        <input
          v-model="traceId"
          class="inp ltr-id"
          type="text"
          spellcheck="false"
          :placeholder="t('infra.trace.idPh')"
          :aria-label="t('infra.trace.idLabel')"
          @keydown.enter.prevent="emit('run')"
        />
        <span class="ltr-kind">{{ kindLabel }}</span>
      </div>

      <div class="itoolgrp">
        <button class="btn pri" type="button" :disabled="!canRun" @click="emit('run')">
          <Icon :name="running ? 'clock' : 'branch'" class="ltr-ic" />
          {{ running ? t('infra.trace.running') : t('infra.trace.go') }}
        </button>
        <button v-if="running" class="btn" type="button" @click="emit('cancel')">
          <Icon name="stop" class="ltr-ic" />
          {{ t('infra.trace.cancel') }}
        </button>
      </div>

      <div class="itoolgrp iend">
        <span v-if="trace" class="ltr-meta">
          {{ t(`infra.trace.source.${trace.source}`) }}
          <span v-if="trace.totalMs !== null" class="ltr-meta-dim">
            · {{ t('infra.trace.total', { ms: formatMs(trace.totalMs) }) }}
          </span>
        </span>
        <button
          v-if="trace && trace.hops.length > 0"
          class="btn sm"
          type="button"
          :title="t('infra.trace.onGraphHint')"
          @click="emit('show-on-graph')"
        >
          <Icon name="branch" class="ltr-ic" />
          {{ t('infra.trace.onGraph') }}
        </button>
      </div>
    </div>

    <!-- Câu nói thật về NGUỒN. Nhánh log không có độ trễ từng chặng, và người đọc
         phải biết điều đó TRƯỚC khi diễn giải các con số bên dưới. -->
    <p v-if="trace" class="ltr-note">{{ t(`infra.trace.sourceNote.${trace.source}`) }}</p>
    <p v-for="key in notes" :key="key" class="ltr-note">{{ t(key) }}</p>
    <p v-if="error" class="ltr-error">{{ errorText }}</p>
    <p v-if="trace?.truncated" class="ltr-warn">{{ t('infra.trace.truncated') }}</p>

    <!-- ── Dòng thời gian dọc ───────────────────────────────────────────────── -->
    <div v-if="trace && trace.hops.length > 0" class="ltr-timeline">
      <div v-for="(hop, i) in trace.hops" :key="hop.key" class="ltr-hop">
        <div class="ltr-rail">
          <span class="ltr-dot" :class="{ bad: hop.status === 'error' }">
            <Icon :name="serviceIcon(hop.service)" class="ltr-dot-ic" />
          </span>
          <span v-if="i < trace.hops.length - 1" class="ltr-line" />
        </div>

        <div class="ltr-body">
          <button class="ltr-head" type="button" @click="emit('toggle-hop', hop.key)">
            <span class="ltr-name" :title="hop.label">{{ hop.label }}</span>
            <span class="ltr-svc">{{ hop.service }}</span>
            <span v-if="hop.status === 'error'" class="ltr-badge bad">
              {{ hop.note || t('infra.trace.failed') }}
            </span>
            <span v-else-if="hop.note" class="ltr-badge">{{ hop.note }}</span>
            <span class="ltr-gap" />
            <span class="ltr-time">{{ clock(hop.firstAt) }}</span>
            <!-- Độ trễ THẬT chỉ có ở nhánh X-Ray; nhãn khác nhau cố ý, để không ai
                 đọc "cách chặng sau 400ms" thành "chặng này chạy mất 400ms". -->
            <span v-if="hop.durationMs !== null" class="ltr-dur">
              {{ t('infra.trace.duration', { ms: formatMs(hop.durationMs) }) }}
            </span>
            <span v-else-if="hop.gapToNextMs !== null" class="ltr-dur dim">
              {{ t('infra.trace.gap', { ms: formatMs(hop.gapToNextMs) }) }}
            </span>
            <Icon :name="openHopKey === hop.key ? 'chev' : 'chev-right'" class="ltr-ic" />
          </button>

          <div class="ltr-sub">
            <span>{{ t('infra.trace.lines', { n: hop.count }) }}</span>
            <button
              v-if="hop.logGroup"
              class="ltr-link"
              type="button"
              :title="hop.logGroup"
              @click="emit('open-logs', hop.logGroup)"
            >
              {{ t('infra.trace.openLogs') }}
            </button>
          </div>

          <div v-if="openHopKey === hop.key" class="ltr-rows">
            <p v-if="hop.rows.length === 0" class="ltr-rows-empty">
              {{ t('infra.trace.noRows') }}
            </p>
            <template v-else>
              <pre v-for="(row, ri) in hop.rows" :key="ri" class="ltr-row">{{
                row['@message'] ?? ''
              }}</pre>
              <p v-if="hop.rowsTruncated" class="ltr-rows-empty">
                {{ t('infra.trace.rowsTruncated', { n: hop.count }) }}
              </p>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Rỗng KHÔNG im lặng: mỗi ca nói ra bước tiếp theo. -->
    <div v-else class="ltr-empty">
      <Icon name="branch" class="ltr-empty-ic" />
      <p class="ltr-empty-txt">{{ emptyText }}</p>
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

const props = defineProps<{
  trace: AwsTrace | null
  running: boolean
  canRun: boolean
  error: string
  notes: string[]
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

/** Mili-giây → chuỗi đọc được. Dưới 1s giữ nguyên ms, trên thì đổi sang giây. */
function formatMs(ms: number): string {
  const abs = Math.abs(ms)
  if (abs < 1000) return `${String(Math.round(ms))} ms`
  if (abs < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}
</script>

<style scoped>
.ltr {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
  flex: 1 1 auto;
}

.ltr-bar {
  flex-wrap: wrap;
}

.ltr-idgrp {
  flex: 1 1 260px;
  min-width: 0;
}

.ltr-id {
  flex: 1 1 auto;
  min-width: 0;
  /* mono-ok: trace id là chuỗi người dùng copy-paste từ log/terminal */
  font-family: var(--code);
}

.ltr-kind {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}

.ltr-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.ltr-meta {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ltr-meta-dim {
  color: var(--textFaint);
}

.ltr-note,
.ltr-warn,
.ltr-error {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ltr-note {
  color: var(--textDim);
}

.ltr-warn {
  color: var(--warn);
}

.ltr-error {
  color: var(--danger);
}

/* ── Dòng thời gian ───────────────────────────────────────────────────────── */

.ltr-timeline {
  flex: 1 1 auto;
  overflow: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 2px;
}

.ltr-hop {
  display: flex;
  gap: 10px;
  min-height: 0;
}

.ltr-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
}

.ltr-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bgEl);
  color: var(--textMuted);
  flex: 0 0 auto;
}

.ltr-dot.bad {
  border-color: var(--dangerBorder, var(--danger));
  background: var(--dangerBg, var(--bgEl));
  color: var(--danger);
}

.ltr-dot-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

/* Đường nối kéo dài hết phần thân của chặng — chiều cao do flex quyết định, nên
   một chặng đang mở log vẫn nối liền xuống chặng sau. */
.ltr-line {
  flex: 1 1 auto;
  width: 1px;
  min-height: 12px;
  background: var(--border);
}

.ltr-body {
  flex: 1 1 auto;
  min-width: 0;
  padding-bottom: 10px;
}

.ltr-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.ltr-head:hover {
  background: var(--bgHover);
}

.ltr-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}

.ltr-svc,
.ltr-time,
.ltr-dur {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  white-space: nowrap;
}

.ltr-time {
  font-variant-numeric: tabular-nums;
}

.ltr-dur {
  font-variant-numeric: tabular-nums;
  color: var(--textMuted);
}

.ltr-dur.dim {
  color: var(--textFaint);
}

.ltr-badge {
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: 16px;
  white-space: nowrap;
}

.ltr-badge.bad {
  border-color: var(--dangerBorder, var(--danger));
  color: var(--danger);
}

.ltr-gap {
  flex: 1 1 auto;
}

.ltr-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ltr-link {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.ltr-link:hover {
  text-decoration: underline;
}

.ltr-rows {
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
  max-height: 220px;
  overflow: auto;
}

.ltr-row {
  margin: 0;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: dòng log nguyên bản */
  font-family: var(--code);
  white-space: pre-wrap;
  word-break: break-word;
}

.ltr-row:last-child {
  border-bottom: 0;
}

.ltr-rows-empty {
  margin: 0;
  padding: 6px 8px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ltr-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 22px 12px;
  color: var(--textDim);
}

.ltr-empty-ic {
  width: var(--icon-lg);
  height: var(--icon-lg);
}

.ltr-empty-txt {
  margin: 0;
  max-width: 420px;
  text-align: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
