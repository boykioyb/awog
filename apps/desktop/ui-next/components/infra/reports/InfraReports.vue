<template>
  <div class="rpt">
    <header class="rpt-hd">
      <h2 class="rpt-ttl">{{ t('infra.report.title') }}</h2>
      <p class="rpt-sub">{{ t('infra.report.subtitle') }}</p>
    </header>

    <p v-if="loading && !kinds.length" class="rpt-state">{{ t('infra.report.loading') }}</p>

    <p v-else-if="!sidecar.available" class="rpt-state">{{ t('infra.report.noSidecar') }}</p>

    <!-- Danh mục rỗng SAU khi nạp xong là chuyện khác với "chưa nạp xong": nói ra
         và cho thử lại, thay vì để người dùng nhìn một khoảng trắng rồi tự đoán. -->
    <div v-else-if="!kinds.length" class="rpt-state">
      <p class="rpt-state-txt">{{ t('infra.report.empty') }}</p>
      <button class="btn sm" type="button" @click="reload">
        <Icon name="refresh" class="rpt-ic" />
        {{ t('infra.report.retry') }}
      </button>
    </div>

    <ul v-else class="rpt-list">
      <li v-for="info in kinds" :key="info.kind" class="rpt-card">
        <div class="rpt-card-hd">
          <h3 class="rpt-kind">{{ t(info.labelKey) }}</h3>
        </div>

        <p class="rpt-about">{{ t(info.aboutKey) }}</p>

        <!-- Nhịp của loại này KHÔNG biểu diễn được bằng trigger hiện có, hoặc cố ý
             chạy tay. Nói ra Ở ĐÂY thì nút Đặt lịch tắt được — bấm vào chỉ để nghe
             lại đúng câu đang đọc là nhiễu. Câu chữ do sidecar đặt (`scheduleGapKey`)
             nên thêm một nhịp mới không phải sửa màn này. -->
        <p v-if="!info.schedule" class="rpt-gap">
          <Icon name="info" class="rpt-ic" />
          {{ t(info.scheduleGapKey ?? 'infra.report.gap.onDemand') }}
        </p>

        <div class="rpt-acts">
          <button
            class="btn sm pri"
            type="button"
            :title="t('infra.report.action.askHint')"
            @click="onAsk(info)"
          >
            <Icon name="sparkles" class="rpt-ic" />
            {{ t('infra.report.action.ask') }}
          </button>
          <button
            class="btn sm"
            type="button"
            :disabled="!info.schedule"
            :title="t('infra.report.action.scheduleHint')"
            @click="scheduleReport(info.kind)"
          >
            <Icon name="clock" class="rpt-ic" />
            {{ t('infra.report.action.schedule') }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
// Màn Báo cáo (Mốc 6, 6.6). Danh mục BỐN loại báo cáo, không phải một cái nút "tạo
// báo cáo": mỗi loại có một câu lệnh khác nhau và một nhịp khác nhau, và cả hai đều
// đi kèm `infra.report-kinds` — màn này KHÔNG tự khai loại thứ năm.
//
// AWOG KHÔNG TỰ VIẾT BÁO CÁO. Nút chính mở một phiên với ĐÚNG câu lệnh của loại đó;
// agent đọc dữ liệu thật rồi viết. Vì vậy màn này không có ô xem trước và không có
// nút xuất — thứ để xuất chưa tồn tại cho tới khi agent viết xong.
//
// Đặt lịch dùng `schedules.upsert` với job `session-prompt` sẵn có, id cố định theo
// loại (`awog-report-<kind>`) nên đặt lần hai SỬA lịch cũ thay vì đẻ ra lịch trùng.
import { onMounted, ref } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useShareExport } from '~/composables/useShareExport'
import { useSidecar } from '~/composables/useSidecar'
import type { ReportKindInfo } from '~/composables/useShareExport'

const { t } = useI18n()
const sidecar = useSidecar()
const { askAgent } = useInfraAskAgent()
const { kinds, loadReportKinds, scheduleReport } = useShareExport()

const loading = ref(true)

async function reload(): Promise<void> {
  loading.value = true
  await loadReportKinds()
  loading.value = false
}

/**
 * Nhãn nguồn cho hộp chọn "phiên hiện tại hay phiên mới": nói rõ đang gửi YÊU CẦU
 * viết báo cáo nào, không phải đang gửi một bản báo cáo (chưa có bản nào).
 */
function onAsk(info: ReportKindInfo): void {
  void askAgent(info.prompt, t('infra.report.askSource', { kind: t(info.labelKey) }))
}

onMounted(reload)
</script>

<style scoped>
.rpt {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.rpt-hd {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rpt-ttl {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}

.rpt-sub {
  margin: 0;
  max-width: 68ch;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}

.rpt-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--textDim);
}

.rpt-state-txt {
  margin: 0;
}

.rpt-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rpt-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
}

.rpt-card-hd {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rpt-kind {
  margin: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.rpt-about {
  margin: 0;
  flex: 1;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}

.rpt-gap {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.rpt-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.rpt-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex-shrink: 0;
}
</style>
