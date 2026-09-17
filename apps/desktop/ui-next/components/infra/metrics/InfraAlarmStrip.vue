<template>
  <div class="ias icard" :class="`st-${state}`">
    <div class="ias-sum" :class="`st-${state}`">
      <Icon :name="ICON[state]" class="ias-sum-ic" />
      <span class="ias-sum-t">{{ t(`infra.monitoring.state.${state}`) }}</span>
      <span v-if="state === 'alarm'" class="ias-sum-n">
        {{ t('infra.monitoring.alarm.firing', { n: firingCount }) }}
      </span>
      <span v-else-if="!loaded" class="ias-sum-n">{{ t('infra.monitoring.notLoaded') }}</span>
      <span v-if="truncated" class="ias-sum-n">{{ t('infra.monitoring.alarm.truncated') }}</span>
    </div>

    <ul v-if="alarms.length > 0" class="ias-list">
      <li v-for="a in ordered" :key="a.name">
        <button
          class="ias-chip"
          :class="`st-${a.state}`"
          type="button"
          :title="a.stateReason || a.name"
          @click="emit('open-history', a.name)"
        >
          <Icon :name="ICON[a.state]" class="ias-ic" />
          <span class="ias-name">{{ a.name }}</span>
          <span class="ias-state">{{ t(`infra.monitoring.state.${a.state}`) }}</span>
          <span v-if="sinceOf(a)" class="ias-since">{{ sinceOf(a) }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="loaded" class="ihint">{{ t('infra.monitoring.alarm.noneForTarget') }}</p>

    <!-- Hai con số ở CUỐI, mờ, không bấm được nhầm thành sự cố. Chúng trả lời câu
         "thế còn những cảnh báo khác thì sao" mà không đổ chúng lên màn. -->
    <span v-if="loaded && scalingCount > 0" class="ias-aside">
      {{ t('infra.monitoring.alarm.scalingCount', { n: scalingCount }) }}
    </span>
    <span v-if="loaded && otherCount > 0" class="ias-aside">
      {{ t('infra.monitoring.alarm.otherCount', { n: otherCount }) }}
    </span>
  </div>
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

<style scoped>
.ias {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  /* Da (viền, bo góc, nền, đổ bóng) do `.icard` cấp — xem app-shell.css. Bốn khối
     của màn này TỪNG tự khai lại cùng một bộ, với ba nền khác nhau (`--bgSubtle`,
     `--bgEl`), nên chúng đọc ra thành ba loại bề mặt trong cùng một màn. */
}

.ias-sum {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.ias-sum-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.ias-sum-t {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.ias-sum-n {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ias-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}

.ias-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.ias-chip:hover {
  background: var(--bgHover);
}

.ias-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.ias-name {
  color: var(--textMuted);
}

.ias-state {
  font-weight: 600;
}

.ias-since {
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}

/* Phần đã tách ra: mờ, cuối dòng, không mang màu trạng thái nào. */
.ias-aside {
  margin-left: auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ias-aside + .ias-aside {
  margin-left: 0;
}

/* Ba màu cho ba trạng thái — chữ và icon đi kèm nên màu chỉ là lớp thứ hai. */
.st-alarm {
  color: var(--danger);
}

.st-ok {
  color: var(--accent);
}

.st-insufficient {
  color: var(--textDim);
}

.ias.st-alarm {
  border-color: var(--dangerBorder);
}

.ias.st-ok {
  border-color: var(--accentBorder);
}
</style>
