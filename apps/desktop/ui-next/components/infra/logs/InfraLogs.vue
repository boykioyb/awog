<template>
  <div class="lgs">
    <!-- ── Cột trái: chọn nguồn + thư viện ─────────────────────────────────── -->
    <aside class="lgs-side">
      <InfraEmpty
        v-if="!profile"
        :title="t('infra.empty.noProfile.title')"
        :hint="t('infra.empty.noProfile.hint.logs')"
        action="accounts"
        :action-label="t('infra.empty.noProfile.action')"
      />

      <template v-else>
        <div class="lgs-ctx">
          <span class="lgs-ctx-chip">{{ profile }}</span>
          <span v-if="region" class="lgs-ctx-chip dim">{{ region }}</span>
        </div>

        <InfraLogsGroupPicker
          :groups="groups"
          :picked="picked"
          :recent="recentGroups"
          :pattern="pattern"
          :loading="groupsLoading"
          :error="groupsError"
          @toggle="toggleGroup"
          @reload="loadGroups"
          @update:pattern="pattern = $event"
        />

        <InfraLogsLibrary
          :templates="templates"
          :saved="saved"
          :history="history"
          @apply="onApplyLibrary"
          @delete="onDeleteSaved"
          @clear-history="onClearHistory"
        />
      </template>
    </aside>

    <!-- ── Cột phải: câu lệnh → chạy → kết quả ─────────────────────────────── -->
    <main class="lgs-main">
      <div class="lgs-window">
        <span class="lgs-window-lbl">{{ t('infra.logs.window.label') }}</span>
        <button
          v-for="p in presets"
          :key="p"
          class="lgs-preset"
          :class="{ on: windowPreset === p }"
          type="button"
          @click="windowPreset = p"
        >
          {{ t(`infra.logs.window.p.${p}`) }}
        </button>
        <button
          class="lgs-preset"
          :class="{ on: windowPreset === 'custom' }"
          type="button"
          @click="windowPreset = 'custom'"
        >
          {{ t('infra.logs.window.p.custom') }}
        </button>
        <template v-if="windowPreset === 'custom'">
          <input v-model="customStart" class="lgs-dt" type="datetime-local" />
          <span class="lgs-window-lbl">→</span>
          <input v-model="customEnd" class="lgs-dt" type="datetime-local" />
        </template>
      </div>

      <!-- Phím tắt ⌘Enter/⌘. do chính editor phát ra (2.3): nó bắt ở pha
           capture vì Monaco chặn sự kiện ở node con. -->
      <InfraLogsQueryEditor v-model="query" :fields="knownFields" @run="onRun" @cancel="onCancel" />

      <!-- Ước lượng TRƯỚC khi chạy (2.6). Con số này là thứ người dùng phải đọc
           trước khi bấm, nên nó nằm NGAY CẠNH nút Chạy, không phải trong tooltip. -->
      <div class="lgs-runbar">
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
        <button class="btn" type="button" :disabled="saving" @click="onSave">
          <Icon name="save" class="lgs-ic" />
          {{ t('infra.logs.run.save') }}
        </button>
        <button class="btn" type="button" @click="onCopyQuery">
          <Icon name="copy" class="lgs-ic" />
          {{ t('infra.logs.run.copyQuery') }}
        </button>

        <!-- Chiều Logs → Giám sát của cầu nối khoảng thời gian (6.3). Đối xứng với
             nút "Mở trong Logs" ở màn kia: cùng một khoảng, hỏi câu khác ("bao nhiêu"
             thay vì "chuyện gì đã xảy ra"). Không cần chạy truy vấn trước — khoảng
             đang chọn trên thanh cửa sổ là thứ được mang sang. -->
        <button
          class="btn"
          type="button"
          :title="t('infra.logs.window.sendToMonitoringHint')"
          @click="onSendToMonitoring"
        >
          <Icon name="forward" class="lgs-ic" />
          {{ t('infra.logs.window.sendToMonitoring') }}
        </button>

        <label class="lgs-check">
          <input v-model="histogramOn" type="checkbox" />
          {{ t('infra.logs.run.histogram') }}
        </label>

        <span class="lgs-est">
          <template v-if="estimating">{{ t('infra.logs.run.estimating') }}</template>
          <template v-else-if="estimate">
            {{
              t('infra.logs.run.estimate', {
                size: formatBytes(estimate.bytes * plannedQueries),
                usd: plannedUsd.toFixed(4),
              })
            }}
            <span class="lgs-est-basis">
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

      <p class="lgs-ratenote">{{ t('infra.logs.run.rateNote') }}</p>

      <div v-if="runError" class="lgs-error">{{ runError }}</div>

      <div v-if="status" class="lgs-status">
        <span class="lgs-status-chip" :class="{ ok: status === 'Complete' }">{{ status }}</span>
        <span class="lgs-status-txt">
          {{
            t('infra.logs.run.scanned', {
              size: formatBytes(bytesScanned),
              usd: actualUsd.toFixed(4),
              matched: recordsMatched,
            })
          }}
        </span>
        <span v-if="ranAt" class="lgs-status-txt dim">{{ whenLabel }}</span>
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
        @copy="onCopyText"
        @send-to-chat="onSendToChat"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
// Màn CloudWatch Logs (Mốc 2, 2.1 → 2.7). Trang chỉ điều phối; state/luồng nằm ở
// useInfraLogs(); bảng/thư viện/histogram là component riêng.
//
// LUẬT CỦA MÀN NÀY
//   · Không tự chạy. `onMounted` chỉ nạp DANH SÁCH log group (metadata, miễn phí)
//     và đọc thư viện trên đĩa. Không truy vấn Insights nào chạy mà không có cú bấm.
//   · Mọi truy vấn đi qua sidecar, nơi `runInfra` đã redact stdout TRƯỚC khi nó
//     rời tiến trình — nên dòng log hiện trên màn, nằm trên clipboard, và đi vào
//     chat đều đã qua cùng một lớp lọc (invariant #1). Màn này KHÔNG tự redact
//     lại: hai lớp lọc khác nhau là hai định nghĩa khác nhau về "bí mật".
import InfraLogsFilters from '~/components/infra/logs/InfraLogsFilters.vue'
import InfraLogsGroupPicker from '~/components/infra/logs/InfraLogsGroupPicker.vue'
import InfraLogsHistogram from '~/components/infra/logs/InfraLogsHistogram.vue'
import InfraLogsLibrary from '~/components/infra/logs/InfraLogsLibrary.vue'
import InfraLogsQueryEditor from '~/components/infra/logs/InfraLogsQueryEditor.vue'
import InfraLogsResults from '~/components/infra/logs/InfraLogsResults.vue'
import { useAwsLogsApi } from '~/composables/useAwsLogsApi'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { LOGS_WINDOW_PRESETS, useInfraLogs } from '~/composables/useInfraLogs'
import { useInfraWindowSync } from '~/composables/useInfraWindowSync'
import type { LogsSeed } from '~/composables/useInfraLogs'

// `seed` cho phép màn khác (Tổng quan) mở tab này với một câu lệnh đã điền sẵn —
// điền câu lệnh KHÔNG phải chạy. `nonce` đổi mỗi lần gieo để cùng một câu gieo hai
// lần vẫn vào editor.
const props = defineProps<{ seed?: LogsSeed | null }>()

const { t } = useI18n()
const toast = useToast()
const { askAgent, copyText } = useInfraAskAgent()
const api = useAwsLogsApi()

const {
  profile,
  region,
  groups,
  groupsLoading,
  groupsError,
  picked,
  pattern,
  recentGroups,
  loadGroups,
  toggleGroup,
  query,
  windowPreset,
  customStart,
  customEnd,
  windowSeconds,
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
} = useInfraLogs()

/** Cầu nối khoảng thời gian hai chiều với màn Giám sát (6.3). */
const bridge = useInfraWindowSync()

const presets = LOGS_WINDOW_PRESETS

const knownFields = computed<string[]>(() => {
  const out = new Set<string>()
  for (const row of rows.value) for (const k of Object.keys(row)) out.add(k)
  return [...out]
})

const whenLabel = computed(() => (ranAt.value ? new Date(ranAt.value).toLocaleTimeString() : ''))

const justCopied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

function onApplyLibrary(q: string, windowSeconds: number, _templateId: string): void {
  applyTemplate({ id: _templateId, query: q, windowSeconds })
}

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

const saving = ref(false)

async function onDeleteSaved(id: string): Promise<void> {
  await api.deleteQuery(id).catch(() => {})
  await reloadLibrary()
}

async function onClearHistory(): Promise<void> {
  await api.clearHistory().catch(() => {})
  await reloadLibrary()
}

// Nút bấm và phím tắt dùng CHUNG hai hàm này, nên guard phải nằm ở đây: phím tắt
// không được làm được việc mà cú bấm đang vô hiệu không làm được.
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

/**
 * Gieo cửa sổ đang chọn sang màn Giám sát (6.3, chiều Logs → Giám sát). Trang
 * `/infra` nghe cùng cầu nối này để CHUYỂN tab — màn kia không thể tự hiện ra.
 *
 * `windowMs` là `null` khi khoảng nhập tay không hợp lệ (end ≤ start). Khi đó không
 * gieo gì: `pushWindow` cũng từ chối, nhưng chặn ở đây thì người dùng nhận được lý
 * do thay vì một cú bấm im lặng.
 */
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
  // `copyText` là bản dùng chung với màn Tổng quan (nó tự báo toast khi hỏng); ở đây
  // chỉ thêm nhãn "Đã chép" của riêng bảng kết quả.
  if (!(await copyText(text))) return
  justCopied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    justCopied.value = false
  }, 1500)
}

/**
 * Gửi một dòng log vào chat của PHIÊN ĐANG MỞ.
 *
 * Phần "nối vào draft / không có phiên thì rơi về clipboard" nằm ở
 * `useInfraAskAgent` (dùng chung với màn Tổng quan); ở đây chỉ dựng phần TIÊU ĐỀ
 * riêng của log — nhóm nào, câu lệnh nào — để model biết khối JSON đến từ đâu.
 */
async function onSendToChat(text: string): Promise<void> {
  const header = t('infra.logs.chat.header', {
    groups: picked.value.join(', ') || '-',
    query: query.value.trim(),
  })
  await askAgent(`${header}\n\n\`\`\`json\n${text}\n\`\`\``)
}

// Khoảng thời gian do màn Giám sát gieo sang (6.3). Chỉ ĐẶT khoảng, KHÔNG chạy: thu
// hẹp cửa sổ là một cách giảm chi phí, tự chạy lại ngay sau đó thì người dùng không
// kịp đọc con số ước lượng mới — cùng luật với cú bấm histogram.
//
// `immediate: true` để bắt ca gieo TRƯỚC khi tab này được mount (tab Logs mount lười,
// cú gieo tới trong cùng tick với cú chuyển tab). `consumeWindow` xoá ngay: để lại thì
// lần vào tab sau sẽ áp lại một khoảng cũ mà người dùng không hề yêu cầu.
watch(
  bridge.pendingLogs,
  (seed) => {
    if (!seed) return
    const got = bridge.consumeWindow('logs')
    if (!got) return
    zoomToWindow(got.startMs, got.endMs)
    // Cửa sổ vừa đổi mà không có gì chạy — nói ra, nếu không cú bấm bên kia trông
    // như không có tác dụng. Câu mô tả do bên gieo đặt (nó biết mình gieo vì việc gì).
    if (got.note) toast.add({ title: got.note, color: 'info' })
  },
  { immediate: true },
)

// Câu lệnh do màn khác gieo vào (Tổng quan → "Mở trong Logs"). Điền vào editor, KHÔNG
// chạy: người dùng vẫn phải bấm Chạy và vẫn phải nhìn thấy ước lượng GB trước.
watch(
  () => props.seed,
  (seed) => {
    if (!seed) return
    // Chọn group TRƯỚC khi điền câu lệnh: một câu lệnh đúng nhưng không chọn group
    // nào thì lần chạy tiếp theo sẽ hỏi lại từ đầu — gieo mà không chọn là gieo dở.
    if (seed.group) picked.value = [seed.group]
    applyTemplate({ id: '', query: seed.query, windowSeconds: seed.windowSeconds })
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
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 14px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.lgs-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.lgs-main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
}

.lgs-ctx {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
}

.lgs-ctx-chip {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.lgs-ctx-chip.dim {
  color: var(--textDim);
}

.lgs-window {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.lgs-window-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lgs-preset {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.lgs-preset.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bgHover);
}

.lgs-dt {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-family: var(--sans);
}

.lgs-runbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.lgs-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lgs-est {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
  font-variant-numeric: tabular-nums;
}

.lgs-est-basis {
  color: var(--textFaint);
  margin-left: 5px;
}

.lgs-ratenote {
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

.lgs-status-txt {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textMuted);
  font-variant-numeric: tabular-nums;
}

.lgs-status-txt.dim {
  color: var(--textFaint);
}

.lgs-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
</style>
