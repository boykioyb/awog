<template>
  <Dialog :open="taskOpen" @update:open="(v) => !v && close()">
    <DialogContent
      class="flex max-h-[calc(100vh-48px)] w-full max-w-140 flex-col gap-0 overflow-hidden border-input bg-sidebar p-0 sm:max-w-140 sm:rounded-2xl"
      :aria-label="t('logtime.task.title')"
    >
      <DialogHeader class="flex-none border-b px-4 py-3 pr-12">
        <DialogTitle class="text-lg font-semibold">{{ t('logtime.task.title') }}</DialogTitle>
        <DialogDescription class="text-xs text-dim">{{ t('logtime.task.sub') }}</DialogDescription>
      </DialogHeader>
      <!-- Ô tìm: gõ là HỎI LẠI PMS theo `q` (debounce). Luôn hiện khi có danh sách hoặc
           đang có từ khoá — kể cả khi tìm ra 0 kết quả, để còn sửa/xoá từ khoá. Esc trong
           ô tìm chỉ xoá từ khoá (`.stop` để không đóng luôn hộp thoại). -->
      <div
        v-if="taskQuery || taskOptions.length > 0"
        class="mx-4 mt-3 flex items-center gap-2 rounded-lg border bg-muted px-2.5 py-1.5 focus-within:border-selected-border"
      >
        <Icon name="search" class="size-3.5 shrink-0 text-faint" />
        <Input
          ref="searchRef"
          v-model="taskQuery"
          unstyled
          class="min-w-0 flex-1 text-sm"
          :placeholder="t('logtime.task.search')"
          @keydown.esc.stop="taskQuery = ''"
        />
        <Icon
          v-if="taskLoading"
          name="refresh"
          class="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        />
        <span v-else-if="taskQuery" class="shrink-0 text-xs tabular-nums text-faint">
          {{ taskOptions.length }}
        </span>
      </div>
      <div class="flex flex-col gap-1.5 overflow-y-auto px-4 py-3">
        <div v-if="taskLoading && taskOptions.length === 0" class="text-sm text-dim">
          {{ t('logtime.task.loading') }}
        </div>
        <div v-else-if="taskOptions.length === 0 && taskQuery" class="text-sm text-dim">
          {{ t('logtime.task.noMatch', { q: taskQuery }) }}
        </div>
        <div v-else-if="taskOptions.length === 0" class="text-sm text-dim">
          {{ t('logtime.task.none') }}
        </div>
        <Button
          v-for="opt in taskOptions"
          v-else
          :key="opt.value"
          type="button"
          variant="outline"
          class="h-auto w-full min-w-0 justify-start rounded-lg bg-muted px-3 py-2 font-normal hover:border-selected-border"
          @click="pickTask(opt)"
        >
          <span class="truncate text-sm">{{ opt.label }}</span>
        </Button>
      </div>
      <div class="flex-none border-t px-4 py-2.5 text-xs text-dim">
        {{ t('logtime.task.hint') }}
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Chọn task để gắn vào dòng công. Danh sách lấy từ `worklog_list_tasks(projectId)`
// của chính nguồn đang nối — không có danh sách cứng nào ở phía AWOG.
import { nextTick, watch, useTemplateRef } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useLogtimeManager } from '~/composables/useLogtimeManager'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const { taskOpen, taskLoading, taskOptions, taskQuery, searchTasks, pickTask } = useLogtimeManager()

// Tự focus ô tìm khi modal mở để gõ ngay, không phải bấm chuột trước.
// Input shadcn expose `focus()` nên gọi thẳng trên instance.
const searchRef = useTemplateRef<{ focus: () => void }>('searchRef')
watch(taskOpen, (open) => {
  if (open) void nextTick(() => searchRef.value?.focus())
})

// Gõ là HỎI LẠI PMS theo `q` — debounce 300ms để không bắn một request mỗi phím.
// `openTaskPicker` đã nạp loạt đầu (và reset `taskQuery=''`), nên bỏ qua lần watch đổi
// về '' ngay khi mở; chỉ tìm khi người dùng thực sự gõ.
let debounce: ReturnType<typeof setTimeout> | null = null
watch(taskQuery, (q) => {
  if (!taskOpen.value) return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void searchTasks(q), 300)
})

function close(): void {
  taskOpen.value = false
}
</script>
