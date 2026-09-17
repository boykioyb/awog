<template>
  <div class="lgs">
    <InfraEmpty
      v-if="!profile"
      :title="t('infra.empty.noProfile.title')"
      :hint="t('infra.empty.noProfile.hint.logs')"
      action="accounts"
      :action-label="t('infra.empty.noProfile.action')"
    />

    <template v-else>
      <!-- ── Cột trái (3/12): ngữ cảnh · chế độ · khoảng · nhóm log · thư viện ── -->
      <aside class="lgs-side icard">
        <!-- Hai chế độ: xem dòng mới nhất (rẻ, tail) hay soạn truy vấn Insights. -->
        <div class="seg lgs-mode">
          <span
            v-for="m in MODES"
            :key="m"
            :class="{ on: mode === m }"
            role="button"
            :aria-pressed="mode === m"
            :title="t(`infra.logs.mode.${m}Full`)"
            @click="mode = m"
          >
            {{ t(`infra.logs.mode.${m}`) }}
          </span>
        </div>

        <!-- Khoảng thời gian: control kiểu AWS CloudWatch (thanh gọn + popover
             Absolute/Relative). Dùng chung với Giám sát/Dashboard. -->
        <div class="lgs-block">
          <span class="lgs-block-lbl">{{ t('infra.logs.window.label') }}</span>
          <InfraTimeRange v-model="win" />
        </div>

        <!-- Nhóm log dưới dạng CHIP — bấm là xem (tail) / chọn (multi). -->
        <InfraLogsGroupPicker
          :groups="groups"
          :mode="mode === 'tail' ? 'tail' : 'multi'"
          :picked="picked"
          :active="tailGroup"
          :recent="recentGroups"
          :pattern="pattern"
          :loading="groupsLoading"
          :error="groupsError"
          @tail="onTail"
          @toggle="toggleGroup"
          @reload="loadGroups"
          @update:pattern="pattern = $event"
        />

        <!-- Tầng giữa: stream của group đang xem (group → stream → event). Chỉ ở chế
             độ tail và khi đã bấm một group. -->
        <InfraLogsStreamPicker
          v-if="mode === 'tail' && tailGroup"
          :streams="streams"
          :active="activeStream"
          :loading="streamsLoading"
          :error="streamsError"
          @select="selectStream"
        />

        <InfraLogsLibrary
          v-if="mode === 'advanced'"
          :templates="templates"
          :saved="saved"
          :history="history"
          @apply="onApplyLibrary"
          @delete="onDeleteSaved"
          @clear-history="onClearHistory"
        />
      </aside>

      <!-- ── Cột phải (9/12): log chính ─────────────────────────────────────── -->
      <main class="lgs-main icard">
        <!-- ══════════ TAIL (mặc định) ══════════ -->
        <template v-if="mode === 'tail'">
          <div class="lgs-mainbar">
            <button
              class="btn"
              type="button"
              :disabled="!tailGroup || tailLoading"
              @click="refreshTail"
            >
              <Icon :name="tailLoading ? 'clock' : 'refresh'" class="lgs-ic" />
              {{ tailLoading ? t('infra.logs.tail.loading') : t('infra.logs.tail.refresh') }}
            </button>
            <span v-if="tailGroup" class="lgs-mainbar-group" :title="tailGroup">
              {{ tailGroup }}
            </span>
            <span class="lgs-spacer" />
            <span v-if="tailGroup && !tailLoading && tailRanAt" class="lgs-meta">
              {{ t('infra.logs.tail.status', { n: tailRows.length }) }}
              <span class="lgs-meta-dim">· {{ tailWhenLabel }}</span>
            </span>
            <span v-if="tailTruncated" class="lgs-trunc">{{ t('infra.logs.tail.truncated') }}</span>
          </div>

          <div v-if="tailError" class="lgs-error">{{ tailError }}</div>

          <InfraLogsFilters
            v-model:quick="quickFilter"
            v-model:level="levelFilter"
            :facets="[]"
            :active="null"
            :shown="tailFilteredRows.length"
            :total="tailRows.length"
            @insert="() => {}"
          />

          <InfraLogsResults
            :rows="tailFilteredRows"
            :copied="justCopied"
            fill
            :empty-text="
              tailGroup ? t('infra.logs.tail.emptyGroup') : t('infra.logs.tail.pickGroup')
            "
            @copy="onCopyText"
            @send-to-chat="onSendToChat"
            @trace="onTraceFromRow"
          />

          <p class="lgs-hint">{{ t('infra.logs.tail.rateNote') }}</p>
        </template>

        <!-- ══════════ LẦN THEO MỘT REQUEST (L5) ══════════ -->
        <InfraLogsTrace
          v-else-if="mode === 'trace'"
          v-model:trace-id="traceId"
          :trace="trace"
          :running="tracing"
          :can-run="canTrace"
          :error="traceError"
          :notes="traceNotes"
          :estimate="traceEstimate"
          :bytes-scanned="traceBytes"
          :open-hop-key="openHopKey"
          :has-groups="picked.length > 0"
          @run="onTraceRun"
          @cancel="cancelTrace"
          @toggle-hop="toggleHop"
          @open-logs="onOpenHopLogs"
          @show-on-graph="onShowOnGraph"
        />

        <!-- ══════════ INSIGHTS (nâng cao) ══════════ -->
        <template v-else>
          <InfraLogsQueryEditor v-model="query" @run="onRun" @cancel="onCancel" />

          <div class="itoolbar lgs-runbar">
            <div class="itoolgrp">
              <button
                class="btn pri"
                type="button"
                :disabled="!canRun"
                aria-keyshortcuts="Meta+Enter Control+Enter"
                @click="onRun"
              >
                <Icon :name="running ? 'clock' : 'play'" class="lgs-ic" />
                {{ running ? t('infra.logs.run.running') : t('infra.logs.run.go') }}
              </button>
              <button
                v-if="running"
                class="btn"
                type="button"
                aria-keyshortcuts="Meta+. Control+."
                @click="onCancel"
              >
                <Icon name="stop" class="lgs-ic" />
                {{ t('infra.logs.run.cancel') }}
              </button>
            </div>

            <div class="itoolgrp">
              <button class="btn" type="button" :disabled="saving" @click="onSave">
                <Icon name="save" class="lgs-ic" />
                {{ t('infra.logs.run.save') }}
              </button>
              <button class="btn" type="button" @click="onCopyQuery">
                <Icon name="copy" class="lgs-ic" />
                {{ t('infra.logs.run.copyQuery') }}
              </button>
              <button
                class="btn"
                type="button"
                :title="t('infra.logs.window.sendToMonitoringHint')"
                @click="onSendToMonitoring"
              >
                <Icon name="forward" class="lgs-ic" />
                {{ t('infra.logs.window.sendToMonitoring') }}
              </button>
            </div>

            <div class="itoolgrp iend lgs-meta-grp">
              <label class="lgs-check">
                <input v-model="histogramOn" type="checkbox" />
                {{ t('infra.logs.run.histogram') }}
              </label>

              <span class="lgs-meta">
                <template v-if="estimating">{{ t('infra.logs.run.estimating') }}</template>
                <template v-else-if="estimate">
                  {{
                    t('infra.logs.run.estimate', {
                      size: formatBytes(estimate.bytes * plannedQueries),
                      usd: plannedUsd.toFixed(4),
                    })
                  }}
                  <span class="lgs-meta-dim">
                    {{
                      estimate.basis === 'history'
                        ? t('infra.logs.run.basisHistory')
                        : t('infra.logs.run.basisStored')
                    }}
                  </span>
                </template>
                <template v-else>{{ t('infra.logs.run.noEstimate') }}</template>
              </span>

              <button
                class="btn sm"
                type="button"
                :disabled="picked.length === 0"
                @click="refreshEstimate"
              >
                <Icon name="refresh" class="lgs-ic" />
                {{ t('infra.logs.run.reestimate') }}
              </button>
            </div>
          </div>

          <div v-if="runError" class="lgs-error">{{ runError }}</div>

          <div v-if="status" class="lgs-status">
            <span class="lgs-status-chip" :class="{ ok: status === 'Complete' }">{{ status }}</span>
            <span class="lgs-meta">
              {{
                t('infra.logs.run.scanned', {
                  size: formatBytes(bytesScanned),
                  usd: actualUsd.toFixed(4),
                  matched: recordsMatched,
                })
              }}
            </span>
            <span v-if="ranAt" class="lgs-meta-dim">{{ whenLabel }}</span>
          </div>

          <InfraLogsHistogram :buckets="histogram" :from-rows="histogramFromRows" @zoom="onZoom" />

          <InfraLogsFilters
            v-model:quick="quickFilter"
            v-model:level="levelFilter"
            :facets="facets"
            :active="facetFilter"
            :shown="filteredRows.length"
            :total="rows.length"
            @insert="insertFacetFilter"
          />

          <InfraLogsResults
            :rows="filteredRows"
            :copied="justCopied"
            fill
            @copy="onCopyText"
            @send-to-chat="onSendToChat"
            @trace="onTraceFromRow"
          />

          <p class="lgs-hint">{{ t('infra.logs.run.rateNote') }}</p>
        </template>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
// Màn CloudWatch Logs. Trang chỉ điều phối; state/luồng nằm ở useInfraLogs().
//
// LAYOUT KIBANA 3/9 (2026-09-16): cột trái 3 phần = điều khiển (ngữ cảnh · chế độ ·
// khoảng thời gian dạng chip · nhóm log dạng chip · thư viện); cột phải 9 phần = log
// chính (bảng lấp đầy chiều cao).
//
// HAI CHẾ ĐỘ:
//   · Tail (mặc định) — bấm một nhóm log = xem dòng MỚI NHẤT ngay qua
//     `filter-log-events`. RẺ (không tính GB quét như Insights) ⇒ được phép tự chạy.
//   · Nâng cao — soạn câu Insights (textarea, KHÔNG Monaco nữa) + histogram + thư
//     viện + facet. Luật "không tự chạy Insights" giữ nguyên: truy vấn tốn tiền vẫn
//     đứng sau một cú bấm + một con số ước lượng.
//
// Mọi truy vấn đi qua sidecar, nơi `runInfra` đã redact stdout TRƯỚC khi rời tiến
// trình (invariant #1). Màn này KHÔNG tự redact lại.
import InfraLogsFilters from '~/components/infra/logs/InfraLogsFilters.vue'
import InfraLogsGroupPicker from '~/components/infra/logs/InfraLogsGroupPicker.vue'
import InfraLogsHistogram from '~/components/infra/logs/InfraLogsHistogram.vue'
import InfraLogsLibrary from '~/components/infra/logs/InfraLogsLibrary.vue'
import InfraLogsQueryEditor from '~/components/infra/logs/InfraLogsQueryEditor.vue'
import InfraLogsResults from '~/components/infra/logs/InfraLogsResults.vue'
import InfraLogsStreamPicker from '~/components/infra/logs/InfraLogsStreamPicker.vue'
import InfraLogsTrace from '~/components/infra/logs/InfraLogsTrace.vue'
import InfraTimeRange from '~/components/infra/InfraTimeRange.vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraLogs } from '~/composables/useInfraLogs'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import { useInfraTrace } from '~/composables/useInfraTrace'
import { useInfraTraceHighlight } from '~/composables/useInfraTraceHighlight'
import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
import type { LogsSeed } from '~/composables/useInfraLogs'

// `seed` cho phép màn khác (Tổng quan) mở tab này với một câu lệnh đã điền sẵn —
// điền câu lệnh KHÔNG phải chạy. Câu Insights ⇒ mở luôn chế độ nâng cao.
const props = defineProps<{ seed?: LogsSeed | null }>()

const { t } = useI18n()
const toast = useToast()
const { askAgent, copyText } = useInfraAskAgent()
const api = useAwsLogsApi()

const {
  profile,
  groups,
  groupsLoading,
  groupsError,
  picked,
  pattern,
  recentGroups,
  loadGroups,
  toggleGroup,
  query,
  win,
  windowSeconds,
  windowValid,
  estimate,
  estimating,
  histogramOn,
  plannedQueries,
  plannedUsd,
  refreshEstimate,
  running,
  status,
  rows,
  filteredRows,
  bytesScanned,
  recordsMatched,
  actualUsd,
  runError,
  ranAt,
  canRun,
  run,
  cancel,
  quickFilter,
  levelFilter,
  facetFilter,
  facets,
  insertFacetFilter,
  histogram,
  histogramFromRows,
  templates,
  saved,
  history,
  reloadLibrary,
  applyTemplate,
  zoomToWindow,
  windowMs,
  // ba chế độ của màn (tail · nâng cao · lần theo request)
  mode,
  tailGroup,
  tailRows,
  tailFilteredRows,
  tailLoading,
  tailError,
  tailTruncated,
  tailRanAt,
  openTail,
  refreshTail,
  // tầng giữa: log stream
  streams,
  streamsLoading,
  streamsError,
  activeStream,
  selectStream,
} = useInfraLogs()

/** Cầu nối khoảng thời gian hai chiều với màn Giám sát (6.3). */
const bridge = useInfraWindowSync()

/** Ba chế độ, khai một chỗ để thanh chuyển chế độ không phải liệt kê tay. */
const MODES = ['tail', 'advanced', 'trace'] as const

// ── Lần theo một request (L5) ───────────────────────────────────────────────
// Nhóm log + khoảng thời gian do CỘT TRÁI sở hữu, nên chúng được đưa vào qua hàm
// chứ không nhân bản sang `useInfraTrace` — một bản sao là một bản có thể lệch.
const {
  traceId,
  running: tracing,
  error: traceError,
  notes: traceNotes,
  estimate: traceEstimate,
  bytesScanned: traceBytes,
  trace,
  openHopKey,
  canRun: canTrace,
  run: runTrace,
  cancel: cancelTrace,
  toggleHop,
  traceFrom,
} = useInfraTrace(() => ({
  logGroups: picked.value,
  startMs: windowMs.value?.startMs ?? 0,
  endMs: windowMs.value?.endMs ?? 0,
}))

const traceHighlight = useInfraTraceHighlight()
const tabOpen = useInfraTabOpen()

/**
 * Chạy lần theo. Ước lượng được làm mới TRƯỚC khi chạy (nhánh log là một truy vấn
 * Insights thật), để dòng nhật ký mang đúng con số và để người dùng thấy nó ở lần
 * sau — cùng luật với nút Chạy của chế độ nâng cao.
 */
/**
 * Chạy lần theo.
 *
 * ⚠ KHÔNG gọi `refreshEstimate()` ở đây nữa. Hàm đó ước lượng câu Insights đang nằm
 * trong EDITOR của chế độ nâng cao — một câu khác hẳn câu lần-theo — và con số ấy
 * vừa hiện ra cho người dùng đọc vừa đi vào dòng nhật ký, tức sổ kiểm toán trả lời
 * sai đúng câu hỏi nó sinh ra để trả lời. Nay `infra.trace-start` tự ước lượng bằng
 * chính câu nó sắp chạy, và trả con số đó về để panel hiện.
 */
async function onTraceRun(): Promise<void> {
  if (!windowValid.value) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  await runTrace()
}

/** Bấm "xem log của chặng này" ⇒ về chế độ tail đúng nhóm đó. */
async function onOpenHopLogs(logGroup: string): Promise<void> {
  mode.value = 'tail'
  await openTail(logGroup)
}

/** Mang đường đi của request sang tab Sơ đồ (G4). */
function onShowOnGraph(): void {
  if (!trace.value) return
  traceHighlight.push(trace.value)
  tabOpen.request('graph')
}

const whenLabel = computed(() => (ranAt.value ? new Date(ranAt.value).toLocaleTimeString() : ''))
const tailWhenLabel = computed(() =>
  tailRanAt.value ? new Date(tailRanAt.value).toLocaleTimeString() : '',
)

const justCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

// Bấm một chip nhóm ở chế độ tail ⇒ xem dòng mới nhất của nhóm đó ngay.
async function onTail(name: string): Promise<void> {
  await openTail(name)
}

function onApplyLibrary(q: string, windowSeconds: number, _templateId: string): void {
  applyTemplate({ id: _templateId, query: q, windowSeconds })
}

const saving = ref(false)

async function onSave(): Promise<void> {
  const body = query.value.trim()
  if (!body) return
  const name = window.prompt(t('infra.logs.save.prompt'), body.slice(0, 60))
  if (!name || !name.trim()) return
  saving.value = true
  try {
    await api.saveQuery({
      name: name.trim(),
      query: body,
      logGroups: picked.value,
      windowSeconds: Math.max(60, windowSeconds.value || 3600),
    })
    toast.add({ title: t('infra.logs.save.done'), color: 'success' })
    await reloadLibrary()
  } catch (err) {
    toast.add({
      title: t('infra.logs.save.failed'),
      description: err instanceof Error ? err.message : String(err),
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

async function onDeleteSaved(id: string): Promise<void> {
  await api.deleteQuery(id).catch(() => {})
  await reloadLibrary()
}

async function onClearHistory(): Promise<void> {
  await api.clearHistory().catch(() => {})
  await reloadLibrary()
}

// Nút bấm và phím tắt dùng CHUNG hai hàm này, nên guard phải nằm ở đây.
async function onRun(): Promise<void> {
  if (!canRun.value) return
  await run()
}

async function onCancel(): Promise<void> {
  if (!running.value) return
  await cancel()
}

function onZoom(startMs: number, endMs: number): void {
  zoomToWindow(startMs, endMs)
  toast.add({ title: t('infra.logs.hist.zoomed'), color: 'info' })
}

/** Gieo cửa sổ đang chọn sang màn Giám sát (6.3, chiều Logs → Giám sát). */
function onSendToMonitoring(): void {
  const win = windowMs.value
  if (!win) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  bridge.pushWindow('monitoring', win.startMs, win.endMs, t('infra.logs.window.bridgeNote'))
}

async function onCopyQuery(): Promise<void> {
  await writeClipboard(query.value)
}

async function onCopyText(text: string): Promise<void> {
  await writeClipboard(text)
}

async function writeClipboard(text: string): Promise<void> {
  if (!(await copyText(text))) return
  justCopied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    justCopied.value = false
  }, 1500)
}

/**
 * "Lần theo request này" từ một dòng log: chuyển chế độ rồi chạy luôn.
 *
 * Chạy NGAY chứ không chỉ điền id, vì người dùng vừa bấm một nút nói rõ nó sẽ làm
 * gì — bắt họ bấm thêm một nút nữa ở màn vừa mở ra là thừa. Chi phí vẫn hiện ở
 * thanh trạng thái sau khi chạy như mọi truy vấn khác.
 */
async function onTraceFromRow(id: string): Promise<void> {
  // Cùng guard với nút Lần theo: khoảng thời gian hỏng ⇒ `windowMs` là `null` ⇒ gửi
  // `startMs: 0`, và zod ở `infra.trace-start` ném một lỗi thô lên panel thay vì một
  // câu tiếng người. Bản đầu chỉ chặn ở `onTraceRun`, để hở đúng đường vào này.
  if (!windowValid.value) {
    toast.add({ title: t('infra.logs.window.invalid'), color: 'warning' })
    return
  }
  if (picked.value.length === 0 && tailGroup.value) picked.value = [tailGroup.value]
  mode.value = 'trace'
  await traceFrom(id)
}

/** Gửi một dòng log vào chat của PHIÊN ĐANG MỞ. */
async function onSendToChat(text: string): Promise<void> {
  const groups = mode.value === 'tail' ? tailGroup.value : picked.value.join(', ')
  const header = t('infra.logs.chat.header', {
    groups: groups || '-',
    query: mode.value === 'advanced' ? query.value.trim() : t(`infra.logs.${mode.value}.mode`),
  })
  await askAgent(`${header}\n\n\`\`\`json\n${text}\n\`\`\``)
}

// Đổi cửa sổ thời gian ở chế độ tail ⇒ tail lại nhóm đang xem (cú bấm của người
// dùng, lệnh rẻ). Chế độ nâng cao KHÔNG tự chạy — Insights vẫn phải bấm Chạy.
watch(win, () => {
  if (mode.value === 'tail' && tailGroup.value) void refreshTail()
})

// Khoảng thời gian do màn Giám sát gieo sang (6.3). Chỉ ĐẶT khoảng, KHÔNG chạy.
watch(
  bridge.pendingLogs,
  (seed) => {
    if (!seed) return
    const got = bridge.consumeWindow('logs')
    if (!got) return
    zoomToWindow(got.startMs, got.endMs)
    if (got.note) toast.add({ title: got.note, color: 'info' })
  },
  { immediate: true },
)

// Câu lệnh do màn khác gieo vào (Tổng quan → "Mở trong Logs"). Câu Insights ⇒ mở
// chế độ nâng cao và điền vào editor, KHÔNG chạy.
watch(
  () => props.seed,
  (seed) => {
    if (!seed) return
    mode.value = seed.mode ?? 'advanced'
    if (seed.pattern !== undefined) {
      pattern.value = seed.pattern
      void loadGroups()
    }
    if (seed.group) {
      picked.value = [seed.group]
      // Chế độ tail xem MỘT nhóm: mở luôn nhóm được gieo, nếu không màn hiện ra
      // trống và người dùng phải tự bấm lại đúng thứ họ vừa xin.
      if (mode.value === 'tail') void openTail(seed.group)
    }
    // Câu lệnh là TUỲ CHỌN: bên gieo chỉ xin mở đúng nhóm log thì không có lý do
    // gì ghi đè câu người dùng đang soạn dở ở chế độ nâng cao.
    if (seed.query) {
      applyTemplate({ id: '', query: seed.query, windowSeconds: seed.windowSeconds })
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await Promise.all([loadGroups(), reloadLibrary()])
})

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
  void cancel()
})
</script>

<style scoped>
.lgs {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  gap: 14px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Hai cột là CARD (skin dùng chung `.icard`: viền + --r-card + --bgPanel + shadow).
   Đây chỉ thêm bố cục + padding trong khung. */
.lgs-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.lgs-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

/* Bảng kết quả bên trong cột phải đã là `.tblcard` — bỏ khung/shadow/nền của nó
   để không thành "card trong card"; header dính (--bgEl) vẫn đủ tách khỏi thân. */
.lgs-main :deep(.tblcard) {
  border: none;
  box-shadow: none;
  background: transparent;
  border-radius: 0;
}

.lgs-mode {
  align-self: stretch;
}

/* Ba chế độ trong một cột rộng 240–320px.
 *
 * ⚠ Đo được ở bản trước: ba nhãn ĐẦY ĐỦ ("Dòng mới nhất" · "Truy vấn nâng cao" ·
 * "Lần theo request") cần 302px, trong khi cột chỉ cho 230–284px — nên mỗi nhãn bị
 * bẻ GIỮA CỤM TỪ ("Dòng mới / nhất"), và thanh cao 54–72px thay vì 36px. Nhãn rút
 * ngắn lại vừa một hàng ở mọi cỡ chữ Appearance 13→18 và mọi bề rộng cột 216→296;
 * câu đầy đủ nằm ở `title`.
 *
 * `white-space: nowrap` là phần KHÔNG được bỏ dù nhãn đã ngắn: khi cột hẹp nhất gặp
 * cỡ chữ lớn nhất, thanh phải gãy thành hai hàng GỌN chứ không bẻ chữ. */
.lgs-mode > span {
  flex: 1 1 auto;
  text-align: center;
  white-space: nowrap;
  padding-left: 8px;
  padding-right: 8px;
}

.lgs-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lgs-block-lbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}

/* Thanh công cụ của cột chính (tail). Da/nền dùng lại `.itoolbar` khi cần. */
.lgs-mainbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.lgs-mainbar-group {
  /* Hiện ĐẦY ĐỦ tên nhóm: giữ nguyên khi vừa một dòng, tự ngắt khi hẹp (định danh
     dài nên ngắt ở bất kỳ đâu). `min-width: 0` cho phép co trong hàng flex. */
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  /* mono-ok: tên log group là định danh tài nguyên */
  font-family: var(--code);
}

.lgs-spacer {
  flex: 1 1 auto;
}

.lgs-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lgs-meta-grp {
  gap: 10px;
}

.lgs-meta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
  font-variant-numeric: tabular-nums;
}

.lgs-meta-dim {
  color: var(--textFaint);
  margin-left: 5px;
}

.lgs-trunc {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--amber);
}

.lgs-hint {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.lgs-error {
  padding: 6px 9px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lgs-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.lgs-status-chip {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.lgs-status-chip.ok {
  border-color: var(--green);
  color: var(--green);
}

.lgs-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
</style>
