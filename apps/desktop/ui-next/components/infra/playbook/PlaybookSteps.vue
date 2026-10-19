<template>
  <!-- Danh sách bước của playbook (việc 5.5). Ba trong năm lệnh là ĐỌC, nên mở một
       playbook đang dở vẫn biết đúng mình đang ở đâu — vì vậy mỗi bước nói rõ verb
       của nó chứ không chỉ nói tên.

       Chế độ Đơn giản giấu dòng lệnh sau mục gập; chế độ Kỹ thuật mở sẵn (luật 1). -->
  <section class="flex flex-col gap-2">
    <h3 class="text-sm font-semibold text-muted-foreground">{{ t('playbooks.steps.title') }}</h3>

    <p v-if="!columns.length" class="text-sm text-dim">{{ t('playbooks.steps.empty') }}</p>

    <ol v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
      <li
        v-for="col in columns"
        :key="col.step.id"
        class="flex flex-col gap-1 rounded-md border bg-card px-2.5 py-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="min-w-4.5 shrink-0 text-xs text-faint tabular-nums">
            {{ col.index + 1 }}
          </span>
          <Badge variant="outline" class="rounded-sm font-medium" :class="VERB_CLASS[col.klass]">
            {{ t(`playbooks.verb.${col.step.verb}`) }}
          </Badge>
          <span class="min-w-0 truncate text-sm text-foreground">{{ col.step.title }}</span>
          <span
            v-if="col.state"
            class="ml-auto text-xs"
            :class="STATE_CLASS[col.state] ?? 'text-dim'"
          >
            {{ t(`playbooks.run.state.${col.state}`) }}
          </span>
        </div>

        <p
          v-if="col.step.note"
          class="text-xs leading-(--lh-sm) text-dim"
          :title="t('playbooks.steps.note')"
        >
          {{ col.step.note }}
        </p>

        <!-- Cảnh báo gắn NGAY trên bước, không gom xuống cuối: người đọc phải thấy
             "thay bản đang chạy" ở đúng dòng nó xảy ra. -->
        <p
          v-for="key in col.warnKeys"
          :key="key"
          class="flex items-center gap-1 text-xs leading-(--lh-sm) text-warning"
        >
          <Icon name="alert" class="size-3" />
          {{ t(key) }}
        </p>

        <!-- Cột kỹ thuật nằm trong mục gập (spec §"Với người không rành kỹ thuật").
             `:key="mode"` + `default-open` giữ đúng nghĩa của `<details :open>` cũ: đổi
             chế độ thì đặt lại trạng thái mở theo chế độ, còn trong một chế độ người
             dùng tự gập/mở được. -->
        <Collapsible
          :key="mode"
          :default-open="mode === 'expert'"
          class="text-xs leading-(--lh-sm) text-dim"
        >
          <CollapsibleTrigger
            class="inline-flex cursor-default items-center gap-1 [&[data-state=open]_svg]:rotate-90"
          >
            <Icon name="chev-right" class="size-3 transition-transform" />
            {{ t('playbooks.steps.technical') }}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="flex min-w-0 items-baseline gap-1.5 pt-1">
              <span class="shrink-0 text-faint">{{ t('playbooks.steps.command') }}</span>
              <!-- mono-ok: dòng lệnh CLI, người dùng copy nguyên văn vào terminal -->
              <code
                class="min-w-0 font-mono text-xs leading-(--lh-sm) wrap-anywhere text-foreground"
              >
                {{ commandOf(col.step) }}
              </code>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookDiagramColumn, PlaybookMode } from '~/composables/usePlaybooksManager'
import type { PlaybookStep } from '~/composables/usePlaybooksApi'

defineProps<{
  columns: PlaybookDiagramColumn[]
  mode: PlaybookMode
}>()

const { t } = useI18n()

/** Màu chip verb theo loại lệnh: đọc · ghi · phá huỷ. */
const VERB_CLASS: Record<string, string> = {
  read: 'border-info text-info',
  write: 'border-success text-success',
  destructive: 'border-destructive text-destructive',
}

/**
 * Màu trạng thái bước. Bước bị cổng quyền chặn giữa đường KHÔNG phải bước hỏng (hợp
 * đồng §2): lượt chạy về lại `approved` và chạy tiếp được kèm vé — tô màu cảnh báo,
 * tô đỏ ở đây là báo sai rằng việc hỏng.
 */
const STATE_CLASS: Record<string, string> = {
  ok: 'text-success',
  failed: 'text-destructive',
  blocked: 'text-warning',
  running: 'text-primary',
}

/**
 * Lệnh của bước, dựng từ `tool` + `args` — KHÔNG phải chuỗi shell đã ghép sẵn (hợp
 * đồng §4: `args` là mảng). Đây là bản ĐỂ ĐỌC; cờ ngữ cảnh do sidecar chèn lúc chạy
 * nên không có ở đây.
 */
function commandOf(step: PlaybookStep): string {
  return [step.tool, ...step.args].join(' ')
}
</script>
