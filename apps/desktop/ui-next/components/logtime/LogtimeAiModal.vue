<template>
  <Dialog :open="aiOpen" @update:open="(v) => !v && (aiOpen = false)">
    <DialogContent
      class="flex max-h-[calc(100vh-48px)] w-full max-w-170 flex-col gap-0 overflow-hidden border-input bg-sidebar p-0 sm:max-w-170 sm:rounded-2xl"
      :aria-label="t('logtime.ai.title')"
    >
      <DialogHeader class="flex-none border-b px-4 py-3 pr-12">
        <DialogTitle class="text-lg font-semibold">
          {{ t('logtime.ai.titleWithDate', { d: longDateOf(date) }) }}
        </DialogTitle>
        <DialogDescription class="text-xs text-dim">{{ t('logtime.ai.sub') }}</DialogDescription>
      </DialogHeader>

      <div class="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        <!-- Đang gọi model. -->
        <div v-if="store.composeBusy" class="flex items-center gap-2 py-4.5 text-sm text-dim">
          <Icon name="refresh" class="size-3.5 animate-spin motion-reduce:animate-none" />
          <span>{{ t('logtime.ai.busy') }}</span>
        </div>

        <!-- Lỗi: engine chưa chạy vs lỗi model, hai câu khác nhau. -->
        <p
          v-else-if="store.composeError"
          class="flex items-center gap-1.5 py-3.5 text-sm text-destructive"
        >
          <Icon name="alert" class="size-3.5 shrink-0" />
          <span>
            {{
              store.composeError === 'engine-unavailable'
                ? t('logtime.ai.noEngine')
                : t('logtime.ai.failed')
            }}
          </span>
        </p>

        <template v-else>
          <!-- Ngữ cảnh AWOG chèn vào lượt — hiện đúng như bản phác để người dùng thấy
               model soạn dựa trên gì, không phải hộp đen. -->
          <div class="flex items-center gap-1.5 text-xs text-dim">
            <Icon name="inspect" class="size-3" />
            <span>{{ t('logtime.ai.contextTitle') }}</span>
          </div>
          <!-- Khối ngữ cảnh dạng thẻ, đọc như code ⇒ mono hợp lệ. -->
          <pre
            class="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
            >{{ store.composeContext }}</pre
          >

          <div
            v-if="store.composeLines.length === 0"
            class="flex items-center gap-2 py-4.5 text-sm text-dim"
          >
            {{ t('logtime.ai.none') }}
          </div>

          <template v-else>
            <div class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Icon name="check" class="size-3.5 text-primary" />
              <span>
                {{
                  t('logtime.ai.draftCount', {
                    n: store.composeLines.length,
                    h: fmt(proposedTotal),
                  })
                }}
              </span>
            </div>
            <ul class="flex flex-col gap-1.5">
              <li
                v-for="(line, i) in store.composeLines"
                :key="i"
                class="flex items-baseline gap-2 rounded-lg border bg-muted px-2.5 py-2 text-sm"
              >
                <span class="min-w-10 shrink-0 font-semibold tabular-nums text-primary">
                  {{ fmt(line.hours) }}h
                </span>
                <b class="shrink-0 font-semibold">{{ labelOf(line.projectKey) }}</b>
                <span class="min-w-0 flex-1 break-words text-muted-foreground">
                  {{ line.note }}
                </span>
                <Badge
                  v-if="line.issue !== undefined"
                  variant="outline"
                  class="rounded-sm text-muted-foreground"
                >
                  <Icon name="link" />
                  <span>#{{ line.issue }}</span>
                </Badge>
              </li>
            </ul>
          </template>
        </template>
      </div>

      <div class="flex flex-none flex-wrap items-center gap-2 border-t px-4 py-3">
        <span class="text-xs text-dim">{{ t('logtime.ai.hint') }}</span>
        <span class="flex-1" />
        <Button type="button" variant="outline" @click="aiOpen = false">
          {{ t('logtime.ai.editManually') }}
        </Button>
        <Button
          type="button"
          :disabled="store.composeBusy || store.composeLines.length === 0"
          variant="default"
          @click="acceptCompose"
        >
          {{ t('logtime.ai.accept', { n: store.composeLines.length }) }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Soạn logtime bằng AI (ADR 0091, Nhóm C). Model soạn dòng công nháp từ việc AWOG đo
// được; NHẬN xong vẫn là NHÁP đi qua cổng `addEntry`, đẩy PMS vẫn là bước riêng có xác
// nhận (`LogtimePushModal`). Model không bao giờ tự đẩy.
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const { aiOpen, store, date, longDateOf, labelOf, fmt, acceptCompose } = useLogtimeManager()

const proposedTotal = computed(() => store.composeLines.reduce((s, l) => s + l.hours, 0))
</script>
