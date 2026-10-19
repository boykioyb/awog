<template>
  <!-- Da card dùng chung của khu hạ tầng; viền đổi màu theo trạng thái tổng. -->
  <Card
    class="flex-row flex-wrap items-center gap-2.5 px-2.5 py-1.5"
    :class="[STATE_TEXT[state], STATE_BORDER[state]]"
  >
    <div class="inline-flex shrink-0 items-center gap-1.5" :class="STATE_TEXT[state]">
      <Icon :name="ICON[state]" class="size-3.5" />
      <span class="text-sm font-semibold">{{ t(`infra.monitoring.state.${state}`) }}</span>
      <span v-if="state === 'alarm'" class="text-xs text-dim">
        {{ t('infra.monitoring.alarm.firing', { n: firingCount }) }}
      </span>
      <span v-else-if="!loaded" class="text-xs text-dim">
        {{ t('infra.monitoring.notLoaded') }}
      </span>
      <span v-if="truncated" class="text-xs text-dim">
        {{ t('infra.monitoring.alarm.truncated') }}
      </span>
    </div>

    <ul v-if="alarms.length > 0" class="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
      <li v-for="a in ordered" :key="a.name">
        <Button
          variant="outline"
          size="xs"
          class="h-auto gap-1 rounded-sm px-2 py-0.5 font-normal shadow-none [&_svg]:size-3"
          :class="STATE_TEXT[a.state]"
          :title="a.stateReason || a.name"
          @click="emit('open-history', a.name)"
        >
          <Icon :name="ICON[a.state]" />
          <span class="text-muted-foreground">{{ a.name }}</span>
          <span class="font-semibold">{{ t(`infra.monitoring.state.${a.state}`) }}</span>
          <span v-if="sinceOf(a)" class="text-faint tabular-nums">{{ sinceOf(a) }}</span>
        </Button>
      </li>
    </ul>
    <p v-else-if="loaded" class="mt-1.5 text-xs text-faint">
      {{ t('infra.monitoring.alarm.noneForTarget') }}
    </p>

    <!-- Hai con số ở CUỐI, mờ, không bấm được nhầm thành sự cố. Chúng trả lời câu
         "thế còn những cảnh báo khác thì sao" mà không đổ chúng lên màn. Phần đã tách
         ra: mờ, cuối dòng, không mang màu trạng thái nào. -->
    <span
      v-if="loaded && (scalingCount > 0 || otherCount > 0)"
      class="ml-auto flex gap-2.5 text-xs text-faint"
    >
      <span v-if="scalingCount > 0">
        {{ t('infra.monitoring.alarm.scalingCount', { n: scalingCount }) }}
      </span>
      <span v-if="otherCount > 0">
        {{ t('infra.monitoring.alarm.otherCount', { n: otherCount }) }}
      </span>
    </span>
  </Card>
</template>

<script setup lang="ts">
// Dải cảnh báo của màn Giám sát.
//
// CHỈ CẢNH BÁO CỦA TÀI NGUYÊN ĐANG XEM (2026-09-17). Bản trước nhận nguyên danh
// sách 100 cảnh báo của cả region. Trong ảnh người dùng 2026-09-17, bốn dòng ĐỎ
// "ĐANG BÁO" đều là `TargetTracking-…-AlarmLow` — cần gạt scale-in của Application
// Auto Scaling, ở trạng thái ALARM nghĩa là tải đang thấp, tức BÌNH THƯỜNG — và
// dưới chúng là ~26 chip xanh đẩy toàn bộ biểu đồ ra khỏi màn hình. Việc lọc và
// chia nhóm nằm ở `useInfraMetrics`; ở đây chỉ còn hai CON SỐ cho phần đã tách ra,
// vì giấu hẳn chúng là nói dối theo chiều ngược lại.
//
// BA TRẠNG THÁI, VÀ TRẠNG THÁI THỨ BA LÀ MỘT TRẠNG THÁI THẬT. `INSUFFICIENT_DATA`
// không phải "chưa kịp nạp": alarm không có đủ điểm để kết luận. Gộp nó vào "bình
// thường" là dựng một đèn xanh không ai kiểm — người dùng đọc "ổn" trong khi AWS
// đang nói "tôi không biết". Vì vậy nó có icon, chữ và màu RIÊNG (không mượn màu
// đỏ của đang-báo, cũng không mượn màu accent của bình-thường).
//
// LUÔN ICON **VÀ** CHỮ, KHÔNG BAO GIỜ CHỈ MÀU: ba màu này là ba mức trạng thái,
// người mù màu đỏ-lục đọc chúng thành hai. Chữ là thứ duy nhất không phụ thuộc mắt.
//
// Chưa nạp được danh sách (lỗi RPC, chưa bấm Nạp) ⇒ hiện "thiếu dữ liệu", KHÔNG
// hiện "bình thường": ta chưa biết gì thì nói là chưa biết.
import type { AlarmState, WireAlarm } from '~/composables/useInfraMetrics'
import { formatAxisTime } from '~/composables/useInfraMetrics'

const props = defineProps<{
  alarms: WireAlarm[]
  state: AlarmState
  loaded: boolean
  truncated: boolean
  /** Cảnh báo của tài khoản KHÔNG thuộc tài nguyên đang xem — chỉ một con số. */
  otherCount: number
  /** Cần gạt autoscaling đang bật. Một con số, và KHÔNG tô đỏ. */
  scalingCount: number
}>()

const emit = defineEmits<{ 'open-history': [name: string] }>()

const { t } = useI18n()

const ICON: Record<AlarmState, string> = { alarm: 'alert', ok: 'check', insufficient: 'minus' }

/** Ba màu cho ba trạng thái — chữ và icon đi kèm nên màu chỉ là lớp thứ hai. */
const STATE_TEXT: Record<AlarmState, string> = {
  alarm: 'text-destructive',
  ok: 'text-primary',
  insufficient: 'text-dim',
}

/** Viền của cả dải theo trạng thái tổng; chưa-biết giữ viền mặc định. */
const STATE_BORDER: Record<AlarmState, string> = {
  alarm: 'border-destructive/40',
  ok: 'border-primary/40',
  insufficient: '',
}

/** Đang báo lên đầu, rồi tới chưa-biết, rồi mới tới bình thường. Trong cùng nhóm
 *  thì theo tên — thứ tự ổn định giữa hai lần nạp là thứ tự đọc được. */
const RANK: Record<AlarmState, number> = { alarm: 0, insufficient: 1, ok: 2 }

const ordered = computed(() =>
  [...props.alarms].sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name)),
)

const firingCount = computed(() => props.alarms.filter((a) => a.state === 'alarm').length)

/** "Ở trạng thái này từ …" — chỉ hiện khi AWS có mốc; bịa ra một mốc là bịa ra lịch sử. */
function sinceOf(a: WireAlarm): string {
  return a.stateUpdatedAt === null ? '' : formatAxisTime(a.stateUpdatedAt, 86400)
}
</script>
