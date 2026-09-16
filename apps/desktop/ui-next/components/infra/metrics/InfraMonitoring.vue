<template>
  <!-- Tab Giám sát của `/infra` (Mốc 6, 6.3 · 6.4).
       BỐ CỤC: một thanh chọn khoảng thời gian + tài nguyên, rồi tới dải cảnh báo, bốn
       ô số, và lưới 2×2 biểu đồ. Panel cảnh báo / lịch sử trượt vào bên phải KHI cần
       — mở nó không được đẩy biểu đồ ra khỏi mắt người vừa kéo ngưỡng trên đó.

       SFC này chỉ ghép khối + bind. Mọi state/lời gọi RPC nằm ở `useInfraMetrics()`
       (khuôn page-controller của .claude/rules/nuxt-vue.md). -->
  <div class="im">
    <div class="im-tool">
      <div class="ifield">
        <div class="ilbl">{{ t('infra.monitoring.window.label') }}</div>
        <div class="seg">
          <span
            v-for="p in windowPresets"
            :key="p"
            :class="{ on: windowPreset === p }"
            role="button"
            :aria-pressed="windowPreset === p"
            @click="windowPreset = p"
          >
            {{ t(`infra.monitoring.window.preset.${p}`) }}
          </span>
          <span
            :class="{ on: windowPreset === 'custom' }"
            role="button"
            :aria-pressed="windowPreset === 'custom'"
            @click="windowPreset = 'custom'"
          >
            {{ t('infra.monitoring.window.custom') }}
          </span>
        </div>
      </div>

      <template v-if="windowPreset === 'custom'">
        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.window.from') }}</div>
          <input v-model="customStart" class="im-inp" type="datetime-local" />
        </div>
        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.window.to') }}</div>
          <input v-model="customEnd" class="im-inp" type="datetime-local" />
        </div>
      </template>

      <div class="ifield">
        <div class="ilbl">{{ t('infra.monitoring.target.lb') }}</div>
        <input
          v-model="targets.lb"
          class="im-inp"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('infra.monitoring.target.lbPh')"
          :title="t('infra.monitoring.target.lbWhy')"
          @keydown.enter="load(false)"
        />
      </div>

      <div class="ifield">
        <div class="ilbl">{{ t('infra.monitoring.target.instance') }}</div>
        <input
          v-model="targets.instance"
          class="im-inp"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('infra.monitoring.target.instancePh')"
          :title="t('infra.monitoring.target.instanceWhy')"
          @keydown.enter="load(false)"
        />
      </div>

      <button
        type="button"
        class="btn pri"
        :disabled="loading || !windowValid"
        :aria-busy="loading"
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
    <!-- Dòng này TỪNG TỒN TẠI trong i18n mà không màn nào render (`target.hint`),
         nên hai ô tài nguyên đứng trần: không nhãn phụ, không placeholder, không
         ai nói phải điền gì vào (người dùng hỏi thẳng 2026-09-16). -->
    <p class="im-targethint">{{ t('infra.monitoring.target.hint') }}</p>

    <div class="im-status">
      <span class="ihint">
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

    <div class="im-body">
      <InfraAlarmStrip
        :alarms="alarms"
        :state="worstState"
        :loaded="alarmsLoaded"
        :truncated="alarmsTruncated"
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
            :incidents="incidents"
            :threshold="thresholds[c.key] ?? null"
            :loading="loading"
            :show-alarm="true"
            :pinnable="true"
            @alarm-create="openDraft(c.key)"
            @alarm-edit="openDraft(c.key)"
            @threshold-change="setThreshold"
            @pin="onPin(c.key)"
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

      <div class="im-ask">
        <span class="ilbl">{{ t('infra.monitoring.title') }}</span>
        <button
          v-for="s in askSuggestions"
          :key="s.key"
          type="button"
          class="mc-chip im-chip"
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
// Màn Giám sát — lớp bind duy nhất của tab (Mốc 6, 6.3 · 6.4).
//
// Ba khối con, ba lý do tách:
//   · `InfraAlarmStrip`  — ba trạng thái cảnh báo là một LUẬT, không phải một danh sách.
//   · `InfraMonitoringTiles` — bốn ô số kèm mốc so sánh, thuần trình bày.
//   · `InfraAlarmPanel`  — form đặt cảnh báo, có state cục bộ của ô nhập.
//
// LUẬT KHÔNG TỰ CHẠY nằm ở `useInfraMetrics`: màn này KHÔNG có `onMounted` nào nạp
// số liệu, và không có hẹn giờ. Cú bấm "Nạp", hoặc một khoảng thời gian được gieo
// từ tab Nhật ký, là hai đường vào duy nhất.
import { formatAxisTime, MONITOR_CHARTS, useInfraMetrics } from '~/composables/useInfraMetrics'
import { useInfraDashboardPin } from '~/composables/useInfraDashboardPin'
import type { DashboardChart } from '~/composables/useInfraDashboards'

const {
  sidecarAvailable,
  targets,
  windowPreset,
  windowPresets,
  customStart,
  customEnd,
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
  incidents,
  thresholds,
  alarms,
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

const { requestPin } = useInfraDashboardPin()

/**
 * Dựng biểu đồ để ghim từ spec của chính màn này.
 *
 * PHẢI TRA LẠI `MONITOR_CHARTS`, không dùng được `c` (một `ChartView`): bản vẽ chỉ mang
 * `key`/`label`/`color`/`shade` — đủ để VẼ, không đủ để DỰNG QUERY. Namespace, metric,
 * stat và tài nguyên nằm ở spec, và bảng điều khiển cần cả bốn thứ đó vì nó nạp số liệu
 * ở một màn khác, không có `MONITOR_CHARTS` bên cạnh.
 *
 * CHỌN TỪNG TRƯỜNG, KHÔNG SPREAD. `DashboardChart` là payload đi lên sidecar, và một cú
 * spread là cách để `points`/`missing` của bản vẽ lọt vào file trên đĩa — chúng không có
 * trong lược đồ zod nên lượt lưu hỏng, nhưng chỉ hỏng ở đúng người bấm nút.
 *
 * `targetValue` chỉ có mặt khi ô tài nguyên KHÔNG rỗng: `z.string().min(1)` của lược đồ
 * từ chối chuỗi rỗng, mà `dimensionsFor` cũng bỏ qua giá trị rỗng — nên gửi đi một chuỗi
 * rỗng vừa là lỗi lược đồ vừa là một gợi ý không có nghĩa.
 */
function onPin(chartKey: string): void {
  const spec = MONITOR_CHARTS.find((s) => s.key === chartKey)
  if (!spec) return
  const chart: DashboardChart = {
    key: spec.key,
    title: t(`infra.monitoring.chart.${spec.key}`),
    kind: spec.kind,
    unit: spec.unit,
    series: spec.series.map((s) => {
      const targetValue = targets.value[s.target].trim()
      return {
        key: s.key,
        namespace: s.namespace,
        metricName: s.metricName,
        stat: s.stat,
        label: s.label,
        color: s.color,
        shade: s.shade,
        dimensions: [],
        target: s.target,
        ...(targetValue ? { targetValue } : {}),
      }
    }),
  }
  requestPin(chart)
}
</script>

<style scoped>
/* Dòng giải thích hai ô tài nguyên. Nằm DƯỚI hàng công cụ chứ không cạnh từng ô:
   nó nói về cả hai, và nhét vào giữa hàng thì hàng đó xuống dòng ở cửa sổ hẹp. */
.im-targethint {
  margin: 2px 0 10px;
  max-width: 84ch;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textFaint);
}

.im {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
  /* Cùng lề với Logs · Bảng điều khiển · Chi phí · Báo cáo (14px 16px). Trước
     2026-09-15 màn này là màn DUY NHẤT của nhóm có padding 0, nên nội dung dính sát
     mép khung trong khi mọi tab anh em đều thụt vào 16px. */
  padding: 14px 16px;
}

.im-tool {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.ifield {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
}

.im-inp {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.im-inp:focus {
  outline: none;
  border-color: var(--accentBorder);
}

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

.im-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
