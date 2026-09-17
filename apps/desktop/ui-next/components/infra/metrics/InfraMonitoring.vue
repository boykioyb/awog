<template>
  <!-- Tab Giám sát của `/infra`.

       BỐ CỤC: chọn TÀI NGUYÊN + khoảng thời gian, rồi tới dải cảnh báo của chính
       tài nguyên đó, hàng ô số, và lưới biểu đồ. Panel cảnh báo / lịch sử trượt vào
       bên phải KHI cần — mở nó không được đẩy biểu đồ ra khỏi mắt người vừa kéo
       ngưỡng trên đó.

       TÀI NGUYÊN ĐỨNG TRƯỚC MỌI THỨ (2026-09-17). Bản trước bày bốn biểu đồ ghim
       cứng ALB + EC2 và hai ô lọc mặc định RỖNG, nên màn mở ra là bốn khung trắng —
       trên hạ tầng ECS thì trắng vĩnh viễn, vì không một biểu đồ nào đọc `AWS/ECS`.
       Nay loại tài nguyên quyết định bộ biểu đồ, và chưa chọn thì màn nói thẳng
       phải chọn gì thay vì vẽ khung rỗng.

       SFC này chỉ ghép khối + bind. Mọi state/lời gọi RPC nằm ở `useInfraMetrics()`
       (khuôn page-controller của .claude/rules/nuxt-vue.md). -->
  <div class="im">
    <!-- Thanh công cụ là một CARD (`.itoolbar`, app-shell.css): ở theme sáng nền
         trang và nền panel gần như không phân biệt được, nên một hàng control trôi
         thẳng trên trang đọc ra thành các nút rời chứ không phải một thanh. -->
    <div class="itoolbar ifields im-tool">
      <InfraResourcePicker
        :model-value="target"
        :groups="pickerGroups"
        :loading="pickerLoading"
        :loaded="pickerLoaded"
        :problem="pickerError"
        :has-account="hasAccount"
        @update:model-value="onPickTarget"
        @reload="loadTargets(true)"
      />

      <div class="ifield">
        <div class="ilbl">{{ t('infra.monitoring.window.label') }}</div>
        <InfraTimeRange v-model="win" :default-seconds="3 * 3600" />
      </div>

      <!-- Ba nút là MỘT nhóm, không phải ba mục rời của thanh flex. Rời nhau thì
           thanh gãy ở giữa chúng: ở cỡ cửa sổ thường "Nạp" ở lại hàng trên còn
           "Nạp lại"/"Mở ở Nhật ký" rơi xuống hàng dưới, tách nút chính khỏi hai
           nút anh em của nó (ảnh người dùng 2026-09-16). -->
      <div class="itoolgrp">
        <button
          type="button"
          class="btn pri"
          :disabled="loading || !windowValid || !target"
          :aria-busy="loading"
          :title="target ? '' : t('infra.monitoring.target.required')"
          @click="load(false)"
        >
          <Icon name="play" class="im-ic" />
          {{ t('infra.monitoring.load') }}
        </button>
        <button
          type="button"
          class="btn"
          :disabled="loading || !loadedAt"
          :title="t('infra.monitoring.reloadHint')"
          @click="reload()"
        >
          <Icon name="refresh" class="im-ic" :class="loading ? 'im-spin' : ''" />
          {{ t('infra.monitoring.reload') }}
        </button>
        <button
          type="button"
          class="btn"
          :disabled="!loadedAt"
          :title="t('infra.monitoring.window.sendToLogsHint')"
          @click="sendToLogs()"
        >
          <Icon name="forward" class="im-ic" />
          {{ t('infra.monitoring.window.sendToLogs') }}
        </button>
      </div>
    </div>

    <!-- Câu lỗi của lượt dò danh sách đứng ở ĐÂY, không trong `.im-tool`: thanh đó
         là flex-wrap, nên một đoạn văn nằm trong nó sẽ quyết định hàng gãy ở đâu và
         làm vỡ cả bố cục (lỗi thật 2026-09-16). Một dòng, cắt bằng ellipsis, toàn
         văn trong `title`. -->
    <p v-if="pickerError" class="im-targeterr" :title="pickerError">{{ pickerError }}</p>

    <div class="im-status">
      <span class="ihint">
        <template v-if="target">
          {{ t(`infra.monitoring.kind.${target.kind}`) }} · {{ target.label }} ·
        </template>
        {{ t('infra.monitoring.window.showing', { span: windowLabel }) }}
        <template v-if="loadedAt">
          · {{ t('infra.monitoring.loadedAt', { t: atLabel }) }}
          ·
          {{
            calls > 0 ? t('infra.monitoring.calls', { n: calls }) : t('infra.monitoring.zeroCost')
          }}
        </template>
      </span>
      <span v-if="windowDirty && loadedAt" class="iwarn">{{ dirtyLabel }}</span>
      <span v-if="partialKeys.length > 0" class="iwarn">{{ t('infra.monitoring.partial') }}</span>
    </div>

    <p v-if="!sidecarAvailable" class="ierr">{{ t('infra.monitoring.sidecarUnavailable') }}</p>
    <p v-else-if="error" class="ierr">{{ error }}</p>

    <!-- CHƯA CHỌN TÀI NGUYÊN ⇒ MỘT câu, không phải một lưới khung rỗng. Bốn khung
         "thiếu dữ liệu" là lời nói dối: chúng khiến người dùng đi tìm lỗi ở AWS
         trong khi màn chỉ đang chờ một cú chọn. -->
    <InfraEmpty
      v-if="!target"
      :title="t('infra.monitoring.empty.title')"
      :hint="hasAccount ? t('infra.monitoring.empty.hint') : t('infra.monitoring.noProfile')"
    />

    <div v-else class="im-body">
      <InfraAlarmStrip
        :alarms="targetAlarms"
        :state="worstState"
        :loaded="alarmsLoaded"
        :truncated="alarmsTruncated"
        :other-count="otherAlarmCount"
        :scaling-count="scalingAlarmCount"
        @open-history="openHistory"
      />

      <InfraMonitoringTiles :tiles="tiles" />

      <div class="im-main">
        <div class="im-grid">
          <MetricChart
            v-for="c in charts"
            :key="c.key"
            :title="c.title"
            :kind="c.kind"
            :unit="c.unit"
            :series="c.series"
            :window="windowRef"
            :window-seconds="windowSeconds"
            :period-seconds="periodSeconds"
            :incidents="incidentsByChart[c.key] ?? []"
            :threshold="thresholds[c.key] ?? null"
            :loading="loading"
            :show-alarm="true"
            @alarm-create="openDraft(c.key)"
            @alarm-edit="openDraft(c.key)"
            @threshold-change="setThreshold"
          />
        </div>

        <div v-if="draft || historyName" class="im-side">
          <InfraAlarmPanel
            v-if="draft"
            :draft="draft"
            :saving="savingAlarm"
            @patch="patchDraft"
            @save="saveDraft()"
            @close="closeDraft()"
          />
          <InfraAlarmHistory
            v-if="historyName"
            :name="historyName"
            :entries="historyEntries"
            :loading="historyLoading"
            @close="closeHistory()"
          />
        </div>
      </div>

      <InfraLogErrors
        :target="target"
        :groups="logGroups"
        :basis="logBasis"
        :resolving="logResolving"
        :ready="logReady"
        :reading="logReading"
        :recent="logRecent"
        :recent-total="logRecentTotal"
        :read="logRead"
        :read-span="logReadSpan"
        :read-truncated="logReadTruncated"
        :read-dropped="logReadDropped"
        :read-error="logReadError"
        :running="logRunning"
        :points="logPoints"
        :ran="logRan"
        :bytes-scanned="logBytes"
        :error="logError"
        :window="windowRef"
        :window-seconds="windowSeconds"
        :period-seconds="periodSeconds"
        @resolve="resolveLogGroups()"
        @read="readLogErrors"
        @run="runLogErrors()"
      />

      <div class="im-ask">
        <span class="im-asklbl">{{ t('infra.monitoring.title') }}</span>
        <button
          v-for="s in askSuggestions"
          :key="s.key"
          type="button"
          class="im-chip"
          :disabled="!loadedAt"
          @click="ask(s.text)"
        >
          {{ s.text }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Màn Giám sát — lớp bind duy nhất của tab.
//
// Bốn khối con, bốn lý do tách:
//   · `InfraResourcePicker`  — chọn tài nguyên; loại của nó quyết định bộ biểu đồ.
//   · `InfraAlarmStrip`      — ba trạng thái cảnh báo là một LUẬT, không phải một danh sách.
//   · `InfraMonitoringTiles` — hàng ô số, thuần trình bày.
//   · `InfraAlarmPanel`      — form đặt cảnh báo, có state cục bộ của ô nhập.
//
// LUẬT KHÔNG TỰ CHẠY nằm ở `useInfraMetrics`: màn này KHÔNG có `onMounted` nào nạp
// số liệu, và không có hẹn giờ. Cú bấm "Nạp", hoặc một khoảng thời gian được gieo
// từ tab Nhật ký, là hai đường vào duy nhất.
import { formatAxisTime, useInfraMetrics, type MonitorTarget } from '~/composables/useInfraMetrics'
import { useInfraMonitorTargets } from '~/composables/useInfraMonitorTargets'
import { useInfraLogErrors, type RecentSpan } from '~/composables/useInfraLogErrors'
import InfraResourcePicker from '~/components/infra/metrics/InfraResourcePicker.vue'
import InfraLogErrors from '~/components/infra/metrics/InfraLogErrors.vue'
import InfraTimeRange from '~/components/infra/InfraTimeRange.vue'
import InfraEmpty from '~/components/infra/InfraEmpty.vue'

const {
  context,
  hasAccount,
  sidecarAvailable,
  target,
  win,
  windowValid,
  windowLabel,
  windowDirty,
  windowRef,
  windowSeconds,
  loading,
  error,
  load,
  reload,
  loadedAt,
  calls,
  partialKeys,
  periodSeconds,
  charts,
  incidentsByChart,
  thresholds,
  targetAlarms,
  otherAlarmCount,
  scalingAlarmCount,
  alarmsLoaded,
  alarmsTruncated,
  worstState,
  tiles,
  draft,
  patchDraft,
  savingAlarm,
  openDraft,
  closeDraft,
  setThreshold,
  saveDraft,
  historyName,
  historyEntries,
  historyLoading,
  openHistory,
  closeHistory,
  askSuggestions,
  ask,
  sendToLogs,
} = useInfraMetrics()

const { t } = useI18n()

// Danh mục tài nguyên. Truyền HÀM ĐỌC chứ không truyền giá trị: khoá cache là
// (profile, region), và hai thứ đó đổi khi người dùng chỉnh thanh ngữ cảnh đầu trang.
const {
  loading: pickerLoading,
  loaded: pickerLoaded,
  groups: pickerGroups,
  groupError,
  deniedActions,
  error: pickerFatal,
  load: loadTargets,
} = useInfraMonitorTargets(
  () => context.value.profile ?? '',
  () => context.value.region ?? '',
)

/**
 * Lỗi cả lượt gọi đứng trước lỗi từng nhóm — nó giải thích được cả năm nhóm rỗng.
 *
 * `ENGINE_CONTRACT_MISMATCH` là mã nội bộ, không phải câu của AWS: nó có nghĩa là
 * engine đang chạy CŨ hơn renderer (sidecar không hot-reload theo UI, phải build
 * lại `dist` rồi khởi động lại app). In nguyên mã đó ra thì người dùng đi tra
 * CloudWatch, nên nó đổi thành câu nói rõ việc phải làm.
 */
const pickerError = computed<string>(() => {
  const raw = pickerFatal.value || groupError.value
  if (raw === 'ENGINE_CONTRACT_MISMATCH') return t('infra.monitoring.target.engineMismatch')
  // Thiếu quyền là ca có LỜI KHUYÊN CỤ THỂ, nên nó không được để nguyên dạng lỗi
  // thô: bốn câu AccessDenied nối nhau ra gần một nghìn ký tự và chỉ khác nhau ở
  // tên action, trong khi thứ người dùng cần mang đi xin quyền chính là danh sách
  // action đó (ảnh người dùng 2026-09-17).
  if (deniedActions.value.length > 0) {
    return t('infra.monitoring.target.denied', { actions: deniedActions.value.join(', ') })
  }
  return raw
})

/**
 * Đổi tài nguyên = đổi bộ biểu đồ, nên số liệu của tài nguyên CŨ phải biến mất.
 * Giữ lại là để người dùng đọc biểu đồ của service A dưới cái tên service B —
 * kiểu nói dối im lặng tệ nhất một màn giám sát làm được.
 */
function onPickTarget(next: MonitorTarget | null): void {
  target.value = next
}

// ── Lỗi trong log ────────────────────────────────────────────────────────────
// Đứng RIÊNG khỏi `useInfraMetrics` vì nó chạy trên một đồng hồ tính tiền khác:
// Insights tính theo SỐ GB QUÉT, nên nó có nút riêng và hộp duyệt riêng (xem đầu
// `useInfraLogErrors.ts`). Gộp vào `load()` là dựng một hoá đơn quét chạy sau lưng.
const {
  groups: logGroups,
  basis: logBasis,
  resolving: logResolving,
  ready: logReady,
  reading: logReading,
  recent: logRecent,
  recentTotal: logRecentTotal,
  read: logRead,
  readSpan: logReadSpan,
  readTruncated: logReadTruncated,
  readDropped: logReadDropped,
  readError: logReadError,
  readRecent,
  running: logRunning,
  points: logPoints,
  ran: logRan,
  bytesScanned: logBytes,
  error: logError,
  reset: resetLogErrors,
  resolveGroups,
  run: runLogs,
} = useInfraLogErrors()

// Đổi tài nguyên ⇒ vứt cả nhóm log lẫn kết quả: chúng thuộc về tài nguyên CŨ, và
// để lại là vẽ số lỗi của service A dưới cái tên service B.
watch(() => target.value?.id ?? '', resetLogErrors)

function resolveLogGroups(): void {
  if (target.value) void resolveGroups(target.value, context.value)
}

/**
 * Đọc lỗi gần đây. Cửa sổ của nó ĐỘC LẬP với `windowRef` của biểu đồ — "5 phút qua"
 * là câu hỏi lúc vừa có chuyện, không cùng nhịp với trục 3 giờ của số liệu, và bắt
 * chúng dùng chung một khoảng là ép người dùng đổi cả màn chỉ để liếc 5 phút.
 */
function readLogErrors(span: RecentSpan): void {
  void readRecent(span, context.value)
}

function runLogErrors(): void {
  if (windowRef.value) void runLogs(windowRef.value, periodSeconds.value, context.value)
}

/** Mốc "nạp lúc" — cùng định dạng trục thời gian của biểu đồ, không phải ISO. */
const atLabel = computed(() =>
  loadedAt.value === null ? '' : formatAxisTime(loadedAt.value, 86_400),
)

/**
 * Câu cảnh báo "đã chọn khác đang xem". Khoảng đã nạp bị ĐÓNG BĂNG (khoá cache theo
 * nó), nên khi người dùng đổi preset mà chưa bấm Nạp, màn phải nói ra rằng con số
 * trên màn hình vẫn thuộc khoảng cũ — im lặng ở đây là để người dùng đọc nhầm nhãn.
 */
const dirtyLabel = computed(() =>
  t('infra.monitoring.window.dirty', {
    selected: windowLabel.value,
    shown: formatAxisTime(windowRef.value?.startMs ?? 0, 86_400),
  }),
)
</script>

<style scoped>
/* Một dòng, cắt bằng ellipsis: stderr của AWS dài và thanh công cụ ngay trên nó
   là flex-wrap. Toàn văn nằm trong `title`. */
.im-targeterr {
  margin: 2px 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--amber);
}

.im {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
  /* Cùng lề với Logs · Bảng điều khiển · Chi phí · Báo cáo (14px 16px). */
  padding: 14px 16px;
}

/* Bố cục + da của thanh, và khuôn `.ifield` bên trong thanh, nay ở app-shell.css. */

.im-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.im-spin {
  animation: im-rot 1s linear infinite;
}

@keyframes im-rot {
  to {
    transform: rotate(360deg);
  }
}

.im-status {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}

.im-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
}

.im-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.im-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  flex: 1 1 auto;
  min-width: 0;
}

.im-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 0 0 320px;
  min-width: 0;
}

.im-ask {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.im-asklbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

/* Tự khai toàn bộ. Trước đây hàng này mượn `.mc-chip` — một class `<style scoped>`
   của `MetricChart.vue`, nên nó KHÔNG BAO GIỜ với tới đây và ba chip câu hỏi
   render thành chữ trần, đọc như một câu văn dính liền (ảnh người dùng
   2026-09-16). Cùng hình với `.icst-chip` của màn Chi phí để hai màn là một họ. */
.im-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}

.im-chip:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}

.im-chip:disabled {
  opacity: 0.45;
  cursor: default;
}

/* Cửa sổ hẹp: lưới 2×2 nhường chỗ cho một cột, panel cảnh báo xuống dưới biểu đồ. */
@media (max-width: 1180px) {
  .im-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .im-main {
    flex-direction: column;
  }

  .im-side {
    flex: 1 1 auto;
    width: 100%;
  }
}
</style>
