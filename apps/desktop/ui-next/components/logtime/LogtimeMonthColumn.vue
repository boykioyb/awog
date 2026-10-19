<template>
  <!-- Cột tháng: mọi ngày của tháng đang mở, mỗi ngày một thanh chia theo dự án.
       Thay cho dải 14 chip cuộn ngang — dải cũ chỉ có số tổng nên không thấy được
       ngày nào hổng ở dự án nào, mà đó lại là câu hỏi chính khi soạn công.
       Bề rộng 228px (w-57) không phải số tuỳ ý: dòng đầu phải chứa được cả "Thứ Sáu,
       18/09" lẫn con số giờ mà không cắt. Panel hẹp (≤1000px) thì thu về 168px và bỏ
       nhãn phụ chứ không cắt nó. border-r chứ không inset shadow: cột cao bằng cả vùng
       nội dung, không phải thanh cao cố định. -->
  <aside
    class="flex w-57 min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar max-[1000px]:w-42"
  >
    <!-- Hai hàng: nhãn tháng + hai nút chuyển tháng ở hàng trên, tổng ở hàng dưới — ở
         228px cả ba không vừa một hàng (đo được 214px nội dung trong 206px chỗ trống). -->
    <div class="flex shrink-0 items-center gap-1 border-b px-3 py-2.5">
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ monthLabel }}</span>
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        class="size-5.5 text-faint disabled:opacity-35"
        :title="t('logtime.month.prev')"
        @click="gotoMonth(-1)"
      >
        <Icon name="chev-left" />
      </Button>
      <!-- Dừng ở tháng hiện tại: đi tiếp là tới tháng chưa xảy ra, mà cột này cho
           chọn ngày rồi form cho thêm dòng — tức là khai được giờ cho ngày tương lai. -->
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        class="size-5.5 text-faint disabled:opacity-35"
        :title="t('logtime.month.next')"
        :disabled="isCurrentMonth"
        @click="gotoMonth(1)"
      >
        <Icon name="chev-right" />
      </Button>
    </div>

    <div class="flex shrink-0 items-baseline justify-end gap-1.5 px-3 pt-2 text-xs text-dim">
      <b class="text-lg font-semibold tabular-nums text-foreground">{{ fmt(monthTotal) }}</b>
      <span class="tabular-nums">/ {{ fmt(monthBudget) }}{{ t('logtime.hoursShort') }}</span>
    </div>

    <div ref="daysRef" class="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <!-- Chọn = accent-tint + thanh accent 2px, KHÔNG nền xám (quy ước selection).
           `data-active` là hook cho scrollIntoView ở script. -->
      <Button
        v-for="d in monthDays"
        :key="d.date"
        type="button"
        variant="ghost"
        class="mb-0.5 h-auto w-full flex-col items-stretch gap-0 border px-2.5 py-2 text-left font-normal whitespace-normal"
        :class="
          d.date === date
            ? 'border-selected-border bg-selected text-foreground shadow-[inset_2px_0_0_var(--color-primary)] hover:bg-selected'
            : 'border-transparent text-muted-foreground'
        "
        :data-active="d.date === date || undefined"
        @click="selectDate(d.date)"
      >
        <span class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-base font-medium">
            {{ shortDateOf(d.date) }}
          </span>
          <span class="shrink-0 text-xs tabular-nums" :class="hhClass(d)">
            {{ fmt(d.total) }}{{ t('logtime.hoursShort') }}
          </span>
        </span>
        <!-- Dải ngày: mỗi dự án một viên thuốc, bề ngang theo tỉ lệ giờ, viên xám cuối là
             phần còn thiếu cho đủ mức. Cố ý KHÔNG đặt nền và KHÔNG overflow-hidden ở
             khung: ngày vượt mức thì `rest` bằng 0 nên dải màu tự choán hết bề ngang.
             Màu viên là màu DỰ ÁN người dùng tự đặt (dữ liệu) nên đi qua :style. -->
        <span class="mt-1.5 flex h-1 gap-0.5">
          <i
            v-for="seg in d.segments"
            :key="seg.key"
            class="block h-1 rounded-full"
            :style="{ flexGrow: seg.hours, background: seg.color }"
          />
          <i
            v-if="d.rest > 0"
            class="block h-1 rounded-full bg-muted"
            :style="{ flexGrow: d.rest }"
          />
        </span>
        <span class="mt-1 truncate text-xs text-faint max-[1000px]:hidden">
          {{ d.sub }}
          <template v-if="d.tail">
            ·
            <span :class="{ 'text-warning': d.tailDraft }">{{ d.tail }}</span>
          </template>
        </span>
      </Button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Cột tháng của màn Ngày. State lấy từ singleton `useLogtimeManager` thay vì prop —
// cùng lý do với `LogtimeDay`.
import { nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager, type MonthDay } from '~/composables/useLogtimeManager'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const {
  date,
  fmt,
  monthDays,
  monthTotal,
  monthBudget,
  monthLabel,
  isCurrentMonth,
  budget,
  gotoMonth,
  shortDateOf,
  selectDate,
} = useLogtimeManager()

// Ngày đủ mức ⇒ accent, còn thiếu ⇒ amber, chưa khai ⇒ mờ. Cùng cách đọc với con số
// tổng của cả tháng, chỉ khác thang.
function hhClass(d: MonthDay): string {
  if (d.total >= budget.value && budget.value > 0) return 'text-primary'
  return d.total > 0 ? 'text-warning' : 'text-dim'
}

// Chọn ngày khác (đổi tháng, bấm một dòng) thì kéo dòng đó vào tầm mắt. Chỉ dùng ở
// đây: cột xếp giảm dần nên hôm nay nằm gần đỉnh, nhưng chọn một ngày cũ vẫn có thể
// rơi ngoài khung nhìn.
const daysRef = useTemplateRef<HTMLElement>('daysRef')
watch(
  date,
  async () => {
    await nextTick()
    daysRef.value?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>
