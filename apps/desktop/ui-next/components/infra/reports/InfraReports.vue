<template>
  <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3.5">
    <header class="flex flex-col gap-1">
      <h2 class="m-0 text-lg font-semibold text-foreground">{{ t('infra.report.title') }}</h2>
      <p class="m-0 max-w-[68ch] text-sm leading-relaxed text-dim">
        {{ t('infra.report.subtitle') }}
      </p>
    </header>

    <p v-if="loading && !kinds.length" class="m-0 text-sm text-dim">
      {{ t('infra.report.loading') }}
    </p>

    <p v-else-if="!sidecar.available" class="m-0 text-sm text-dim">
      {{ t('infra.report.noSidecar') }}
    </p>

    <!-- Danh mục rỗng SAU khi nạp xong là chuyện khác với "chưa nạp xong": nói ra
         và cho thử lại, thay vì để người dùng nhìn một khoảng trắng rồi tự đoán. -->
    <div v-else-if="!kinds.length" class="flex flex-col items-start gap-2 text-sm text-dim">
      <p class="m-0">{{ t('infra.report.empty') }}</p>
      <Button type="button" variant="outline" size="sm" @click="reload">
        <Icon name="refresh" class="size-3" />
        {{ t('infra.report.retry') }}
      </Button>
    </div>

    <ul
      v-else
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5 p-0"
    >
      <li v-for="info in kinds" :key="info.kind" class="flex">
        <Card class="flex-1 gap-2 p-3">
          <h3 class="m-0 text-base font-medium text-foreground">{{ t(info.labelKey) }}</h3>

          <p class="m-0 flex-1 text-sm leading-relaxed text-muted-foreground">
            {{ t(info.aboutKey) }}
          </p>

          <!-- Nhịp của loại này KHÔNG biểu diễn được bằng trigger hiện có, hoặc cố ý
               chạy tay. Nói ra Ở ĐÂY thì nút Đặt lịch tắt được — bấm vào chỉ để nghe
               lại đúng câu đang đọc là nhiễu. Câu chữ do sidecar đặt (`scheduleGapKey`)
               nên thêm một nhịp mới không phải sửa màn này. -->
          <p v-if="!info.schedule" class="m-0 flex items-start gap-1.5 text-xs text-faint">
            <Icon name="info" class="mt-0.5 size-3 flex-none" />
            {{ t(info.scheduleGapKey ?? 'infra.report.gap.onDemand') }}
          </p>

          <div class="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              :title="t('infra.report.action.askHint')"
              variant="default"
              size="sm"
              @click="onAsk(info)"
            >
              <Icon name="sparkles" class="size-3" />
              {{ t('infra.report.action.ask') }}
            </Button>
            <Button
              type="button"
              :disabled="!info.schedule"
              :title="t('infra.report.action.scheduleHint')"
              variant="outline"
              size="sm"
              @click="scheduleReport(info.kind)"
            >
              <Icon name="clock" class="size-3" />
              {{ t('infra.report.action.schedule') }}
            </Button>
          </div>
        </Card>
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
import Button from '~/components/ui/button/Button.vue'

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
