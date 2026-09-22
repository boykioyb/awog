<template>
  <!-- Cột tháng: mọi ngày của tháng đang mở, mỗi ngày một thanh chia theo dự án.
       Thay cho dải 14 chip cuộn ngang — dải cũ chỉ có số tổng nên không thấy được
       ngày nào hổng ở dự án nào, mà đó lại là câu hỏi chính khi soạn công. -->
  <aside class="ltmon">
    <div class="ltmonh">
      <span class="ltmonl">{{ monthLabel }}</span>
      <button
        type="button"
        class="ltmonnav"
        :title="t('logtime.month.prev')"
        @click="gotoMonth(-1)"
      >
        <Icon name="chev-left" />
      </button>
      <!-- Dừng ở tháng hiện tại: đi tiếp là tới tháng chưa xảy ra, mà cột này cho
           chọn ngày rồi form cho thêm dòng — tức là khai được giờ cho ngày tương lai. -->
      <button
        type="button"
        class="ltmonnav"
        :title="t('logtime.month.next')"
        :disabled="isCurrentMonth"
        @click="gotoMonth(1)"
      >
        <Icon name="chev-right" />
      </button>
    </div>

    <div class="ltmontot">
      <b class="tnum">{{ fmt(monthTotal) }}</b>
      <span class="tnum">/ {{ fmt(monthBudget) }}{{ t('logtime.hoursShort') }}</span>
    </div>

    <div ref="daysRef" class="ltmondays">
      <button
        v-for="d in monthDays"
        :key="d.date"
        type="button"
        class="ltmday"
        :class="{ on: d.date === date }"
        @click="selectDate(d.date)"
      >
        <span class="ltmdayh">
          <span class="ltmdayd">{{ shortDateOf(d.date) }}</span>
          <span class="ltmdayhh tnum" :class="hhClass(d)">
            {{ fmt(d.total) }}{{ t('logtime.hoursShort') }}
          </span>
        </span>
        <span class="ltmbar">
          <i
            v-for="seg in d.segments"
            :key="seg.key"
            :style="{ flexGrow: seg.hours, background: seg.color }"
          />
          <i v-if="d.rest > 0" class="rest" :style="{ flexGrow: d.rest }" />
        </span>
        <span class="ltmdaysub">
          {{ d.sub }}
          <template v-if="d.tail">
            ·
            <span :class="{ draft: d.tailDraft }">{{ d.tail }}</span>
          </template>
        </span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Cột tháng của màn Ngày. State lấy từ singleton `useLogtimeManager` thay vì prop —
// cùng lý do với `LogtimeDay`.
import { nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager, type MonthDay } from '~/composables/useLogtimeManager'

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
  if (d.total >= budget.value && budget.value > 0) return 'full'
  return d.total > 0 ? 'miss' : ''
}

// Chọn ngày khác (đổi tháng, bấm một dòng) thì kéo dòng đó vào tầm mắt. Chỉ dùng ở
// đây: cột xếp giảm dần nên hôm nay nằm gần đỉnh, nhưng chọn một ngày cũ vẫn có thể
// rơi ngoài khung nhìn.
const daysRef = useTemplateRef<HTMLElement>('daysRef')
watch(
  date,
  async () => {
    await nextTick()
    daysRef.value?.querySelector('.ltmday.on')?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true },
)
</script>

<style scoped>
/* 228px không phải số tuỳ ý: dòng đầu phải chứa được cả "Thứ Sáu, 18/09" lẫn con số
   giờ mà không cắt — cắt đúng con số nói ngày đó đủ hay thiếu thì cột này hết việc
   để làm. */
.ltmon {
  flex: 0 0 228px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bgPanel);
  /* border-right chứ không phải inset box-shadow: cột này cao bằng cả vùng nội dung
     (không phải thanh cao cố định), nên quy ước hairline `inset` không áp dụng. */
  border-right: 1px solid var(--border);
  overflow: hidden;
}
/* Hai hàng chứ không một như bản phác: bản phác là ảnh tĩnh nên không có nút chuyển
   tháng, còn app thì cần. Ở 228px, "Tháng 9 · 2026" + hai chevron + "126.5/144h"
   không vừa một hàng (đo được 214px nội dung trong 206px chỗ trống), nên nhãn tháng
   và hai nút ở hàng trên, tổng ở hàng dưới. */
.ltmonh {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 10px 11px;
  border-bottom: 1px solid var(--border);
}
.ltmonl {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltmonnav {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: none;
  color: var(--textFaint);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ltmonnav:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltmonnav:disabled {
  opacity: 0.35;
  cursor: default;
}
.ltmonnav:disabled:hover {
  background: none;
  color: var(--textFaint);
}
.ltmontot {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 5px;
  flex: 0 0 auto;
  padding: 8px 11px 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltmontot b {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
.ltmondays {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 7px 11px;
}
.ltmday {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  margin-bottom: 3px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  background: none;
  color: var(--textMuted);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.ltmday:hover {
  background: var(--bgHover);
}
/* Chọn = accent-tint + thanh accent 2px, KHÔNG nền xám (quy ước selection). */
.ltmday.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
  box-shadow: inset 2px 0 0 var(--accent);
}
.ltmdayh {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ltmdayd {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltmdayhh {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ltmdayhh.full {
  color: var(--accent);
}
.ltmdayhh.miss {
  color: var(--amber);
}
/* Dải ngày: mỗi dự án một viên thuốc, bề ngang theo tỉ lệ giờ, viên xám cuối là phần
   còn thiếu cho đủ mức. Cố ý KHÔNG đặt nền và KHÔNG `overflow:hidden` ở khung: ngày
   vượt mức thì `rest` bằng 0 nên dải màu tự choán hết bề ngang, không bị cắt cụt. */
.ltmbar {
  display: flex;
  gap: 2px;
  height: 4px;
  margin-top: 6px;
}
.ltmbar i {
  display: block;
  height: 4px;
  border-radius: var(--r-pill);
}
.ltmbar i.rest {
  background: var(--bgActive);
}
.ltmdaysub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  margin-top: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltmdaysub .draft {
  color: var(--amber);
}
/* Panel hẹp: bỏ nhãn phụ chứ không cắt nó — ngày nào còn nháp vẫn thấy được qua dải
   màu và con số giờ ở dòng đầu. */
@media (max-width: 1000px) {
  .ltmon {
    flex: 0 0 168px;
  }
  .ltmdaysub {
    display: none;
  }
}
</style>
