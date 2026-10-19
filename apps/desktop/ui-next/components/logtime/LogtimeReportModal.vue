<template>
  <Dialog :open="reportOpen" @update:open="(v) => !v && (reportOpen = false)">
    <DialogContent
      class="flex max-h-[calc(100vh-48px)] w-full max-w-170 flex-col gap-0 overflow-hidden border-input bg-sidebar p-0 sm:max-w-170 sm:rounded-2xl"
      :aria-label="t('logtime.report.title')"
    >
      <DialogHeader class="flex-none border-b px-4 py-3 pr-12">
        <DialogTitle class="text-lg font-semibold">{{ t('logtime.report.title') }}</DialogTitle>
        <DialogDescription class="text-xs text-dim">{{ longDateOf(date) }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-sm text-dim">{{ t('logtime.report.form') }}</span>
          <ToggleGroup
            type="single"
            :spacing="1"
            class="rounded-lg bg-muted p-0.5"
            :model-value="reportForm"
            @update:model-value="pickForm"
          >
            <ToggleGroupItem
              value="brief"
              class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {{ t('logtime.report.form.brief') }}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="markdown"
              class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {{ t('logtime.report.form.markdown') }}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="json"
              class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {{ t('logtime.report.form.json') }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <!--
          Dạng JSON chỉ chứa những dòng SẼ gửi đi được, nên nó ngắn hơn ngày.
          Không nói ra thì người dùng chép 5 dòng của một ngày 7 dòng mà tưởng
          đã đủ — đây là lời cảnh báo chứ không phải trang trí.
        -->
        <div
          v-if="report.excluded.length > 0"
          class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-muted-foreground"
        >
          <Icon name="alert" class="size-3.5 shrink-0 text-warning" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <span>{{ t('logtime.report.excluded', { n: report.excluded.length }) }}</span>
            <!-- Một dòng bị loại = một hàng: tên dự án + note co lại, nhãn lý do đứng yên. -->
            <div
              v-for="(x, i) in report.excluded"
              :key="i"
              class="flex min-w-0 items-baseline gap-2"
            >
              <span class="min-w-0 flex-1 truncate text-dim">
                {{ x.line.project }} — {{ x.line.note }}
              </span>
              <span class="shrink-0 text-xs text-dim">{{ t(REASON_KEY[x.reason]) }}</span>
            </div>
          </div>
        </div>

        <!-- Báo cáo để chép ra ngoài (chat/PR/wiki) ⇒ mono hợp lệ. -->
        <pre
          class="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
          >{{ report.text }}</pre
        >
      </div>

      <div class="flex flex-none flex-wrap items-center gap-2 border-t px-4 py-3">
        <span class="text-xs text-dim">{{ t('logtime.report.hint') }}</span>
        <span class="flex-1" />
        <Button type="button" variant="outline" @click="reportOpen = false">
          {{ t('common.close') }}
        </Button>
        <Button type="button" variant="default" @click="copyReport">
          <Icon name="copy" />
          {{ t('logtime.report.copy') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Báo cáo ngày — ba dạng (gọn / bảng markdown / payload JSON), ADR 0091.
//
// Cố ý KHÔNG có nút gửi: hộp này chỉ ĐỌC và CHÉP. Ghi lên PMS vẫn là một đường
// duy nhất qua `LogtimePushModal` (hai bước, có ô tích) — thêm một nút gửi thứ hai
// ở đây là nhân đôi cổng xác nhận cho cùng một thao tác.
import type { AcceptableValue } from 'reka-ui'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import type { ReportExclusion } from '~/utils/logtime-report'
import Button from '~/components/ui/button/Button.vue'

// Bảng tra TƯỜNG MINH chứ không nối chuỗi `'logtime.report.reason.' + reason`:
// thêm một lý do mới vào `ReportExclusion` mà quên nhãn thì record này thiếu khoá
// và TS báo ngay, còn nối chuỗi sẽ lặng lẽ in ra khoá thô giữa giao diện.
const REASON_KEY: Record<ReportExclusion, string> = {
  unlinked: 'logtime.report.reason.unlinked',
  alreadyOnPms: 'logtime.report.reason.alreadyOnPms',
  noHours: 'logtime.report.reason.noHours',
}

const { t } = useI18n()
const { reportOpen, reportForm, report, date, longDateOf, setReportForm, copyReport } =
  useLogtimeManager()

// ToggleGroup single cho bấm lại mục đang bật để bỏ chọn (emit rỗng) — dạng báo cáo
// luôn phải có một giá trị nên bỏ qua lần bỏ chọn đó.
const pickForm = (v: AcceptableValue | AcceptableValue[]) => {
  if (v === 'brief' || v === 'markdown' || v === 'json') setReportForm(v)
}
</script>
