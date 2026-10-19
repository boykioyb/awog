<template>
  <section class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" data-page="logtime">
    <!-- Tiêu đề trang tự đệm lấy, KHÔNG đệm ở section: bên dưới là các dải full-bleed
         (tiêu đề ngày + thanh xác nhận của LogtimeDay, vùng cuộn của Thiết lập) mà đường
         kẻ chân phải chạy hết bề ngang trang. -->
    <div class="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-4 pb-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <Icon name="clock" class="size-5 text-primary" />
        <div>
          <h1 class="text-lg font-semibold text-foreground">{{ t('logtime.title') }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ t('logtime.subtitle', { h: fmt(budget) }) }}
          </p>
        </div>
      </div>
      <span class="flex-1" />
      <!-- Segment chỉ còn hai màn xem việc (Ngày · Tuần). "Thiết lập" ra khỏi segment
           thành nút bánh răng riêng bên phải — nó là cấu hình, không phải một màn công
           ngang hàng với Ngày/Tuần. Ở màn Thiết lập không tab nào sáng. -->
      <Tabs
        :model-value="view"
        @update:model-value="(v: string | number) => setView(v === 'week' ? 'week' : 'day')"
      >
        <TabsList>
          <TabsTrigger value="day">{{ t('logtime.tab.day') }}</TabsTrigger>
          <TabsTrigger value="week">{{ t('logtime.tab.week') }}</TabsTrigger>
        </TabsList>
      </Tabs>
      <!-- Soạn bằng AI: gọi model soạn dòng công nháp từ việc đo được của NGÀY đang mở.
           Nhận xong vẫn là nháp, đẩy PMS vẫn là bước riêng. -->
      <Button type="button" :disabled="store.composeBusy" variant="outline" @click="openAi">
        <Icon name="sparkles" />
        {{ t('logtime.ai.open') }}
      </Button>
      <!-- Thiết lập dạng icon (bánh răng), tô accent-tint khi đang mở. -->
      <Button
        type="button"
        variant="outline"
        size="iconMd"
        :class="{ 'border-selected-border bg-selected text-primary': view === 'setup' }"
        :title="t('logtime.tab.setup')"
        :aria-label="t('logtime.tab.setup')"
        :aria-pressed="view === 'setup'"
        @click="setView('setup')"
      >
        <Icon name="settings" />
      </Button>
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
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const { view, budget, fmt, store, setView, openAi, init } = useLogtimeManager()

onMounted(() => {
  void init()
})
</script>
