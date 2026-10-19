<template>
  <div class="flex flex-col gap-0.5">
    <!-- Hàng checklist — wash khi hover. Là nút để bấm được bằng bàn phím; bản chỉ
         đọc (bản ghi trong transcript) thì không có con trỏ bấm. -->
    <Button
      v-for="(td, i) in todos"
      :key="i"
      type="button"
      variant="ghost"
      class="h-auto w-full justify-start gap-2 rounded-md px-1.5 py-0.5 text-left text-base font-normal whitespace-normal disabled:opacity-100 [&_svg]:size-3"
      :class="td.done ? 'text-muted-foreground line-through' : 'text-foreground'"
      :disabled="!editable"
      :title="editable ? t('sessions.todo.cycle') : undefined"
      @click="emit('cycle', i)"
    >
      <!-- Ô tick: viền input; xong = viền primary + nền primary nhạt + dấu tick; đang
           làm = viền primary + chấm nhỏ. px-ok: nét ô 1.5px là hình vẽ. -->
      <span
        class="grid size-4 flex-none place-items-center rounded-sm border-[1.5px] text-primary"
        :class="{
          'border-primary': td.done || td.status === 'in_progress',
          'border-input': !td.done && td.status !== 'in_progress',
          'bg-primary/15': td.done,
        }"
      >
        <Icon v-if="td.done" name="check" />
        <span v-else-if="td.status === 'in_progress'" class="size-1.5 rounded-full bg-primary" />
      </span>
      {{ td.t }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Checklist rows shared by the docked banner (SessionTodoPanel), the Plan & Progress
// tab, and the inline transcript step (SessionStepItem) — one source of row markup.
//
// `editable` splits the two roles: the CURRENT checklist is shared state between the
// user and the model, so a click cycles a row pending → in_progress → completed →
// pending and the parent persists it. The inline transcript step is a historical record
// of what the model wrote at that moment, so it stays read-only (the default).
import type { Todo } from '~/composables/useSessionsData'

withDefaults(defineProps<{ todos: Todo[]; editable?: boolean }>(), { editable: false })

const emit = defineEmits<{ (e: 'cycle', index: number): void }>()

const { t } = useI18n()
</script>
