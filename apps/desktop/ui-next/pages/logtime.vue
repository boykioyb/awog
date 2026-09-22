<template>
  <section class="page on ltpage" data-page="logtime">
    <div class="lthd">
      <div class="lthdl">
        <Icon name="clock" class="lthdic" />
        <div>
          <div class="lthdt">{{ t('logtime.title') }}</div>
          <div class="fd">{{ t('logtime.subtitle', { h: fmt(budget) }) }}</div>
        </div>
      </div>
      <span class="ltsp" />
      <!-- Segment chỉ còn hai màn xem việc (Ngày · Tuần). "Thiết lập" ra khỏi segment
           thành nút bánh răng riêng bên phải — nó là cấu hình, không phải một màn công
           ngang hàng với Ngày/Tuần. -->
      <div class="lttabs" role="tablist">
        <button
          class="lttab"
          :class="{ on: view === 'day' }"
          role="tab"
          :aria-selected="view === 'day'"
          @click="setView('day')"
        >
          {{ t('logtime.tab.day') }}
        </button>
        <button
          class="lttab"
          :class="{ on: view === 'week' }"
          role="tab"
          :aria-selected="view === 'week'"
          @click="setView('week')"
        >
          {{ t('logtime.tab.week') }}
        </button>
      </div>
      <!-- Soạn bằng AI: gọi model soạn dòng công nháp từ việc đo được của NGÀY đang mở.
           Nhận xong vẫn là nháp, đẩy PMS vẫn là bước riêng. -->
      <button class="btn ltbtn" type="button" :disabled="store.composeBusy" @click="openAi">
        <Icon name="sparkles" />
        {{ t('logtime.ai.open') }}
      </button>
      <!-- Thiết lập dạng icon (bánh răng), tô accent khi đang mở. -->
      <button
        class="ltgear"
        :class="{ on: view === 'setup' }"
        type="button"
        :title="t('logtime.tab.setup')"
        :aria-label="t('logtime.tab.setup')"
        :aria-pressed="view === 'setup'"
        @click="setView('setup')"
      >
        <Icon name="settings" />
      </button>
    </div>

    <LogtimeDay v-if="view === 'day'" />
    <LogtimeWeek v-else-if="view === 'week'" />
    <LogtimeSetup v-else />

    <LogtimePushModal />
    <LogtimeTaskPicker />
    <LogtimeReportModal />
    <LogtimeAiModal />
  </section>
</template>

<script setup lang="ts">
// Trang Logtime (ADR 0091) — soạn giờ công rồi đẩy lên PMS qua MCP.
// Thin template: mọi state/handler nằm trong `useLogtimeManager` (singleton).
import { onMounted } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'

const { t } = useI18n()
const { view, budget, fmt, store, setView, openAi, init } = useLogtimeManager()

onMounted(() => {
  void init()
})
</script>

<style scoped>
.ltpage {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
/* Tiêu đề trang tự đệm lấy, KHÔNG đệm ở `.ltpage`: bên dưới nó là hai dải full-bleed
   (tiêu đề ngày + thanh xác nhận của LogtimeDay, và ở tab Thiết lập là vùng cuộn), mà
   đường kẻ chân của chúng phải chạy hết bề ngang trang. */
.lthd {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  flex: 0 0 auto;
  padding: 16px var(--padX) 14px;
}
.lthdl {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.lthdic {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--accent);
}
.lthdt {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  color: var(--text);
}
.ltsp {
  flex: 1;
}
/* Tab: gạch accent dưới chân, KHÔNG tô nền xám cho tab đang mở (quy ước selection
   = accent-tint trong .claude/rules/nuxt-vue.md). */
.lttabs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}
.lttab {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--textDim);
  font-family: inherit;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  padding: 6px 12px;
  cursor: pointer;
}
.lttab:hover {
  color: var(--text);
}
.lttab.on {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
/* Nút trên thanh tiêu đề dùng `.btn` của prototype.css; `.ltbtn` chỉ chỉnh cỡ chữ cho
   khớp phần còn lại của trang. */
.ltbtn {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* Bánh răng Thiết lập: nút icon vuông, `padding: 0` khai tường minh (bài học `.ltop`).
   Đang mở → accent-tint như quy ước selection. */
.ltgear {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: none;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.ltgear:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ltgear.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.ltgear > .icn {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
</style>
