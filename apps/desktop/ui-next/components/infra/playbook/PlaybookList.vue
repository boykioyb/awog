<template>
  <!-- Cột trái của `/playbooks` (việc 5.5). Hai nhóm rời nhau — Triển khai · Hướng
       dẫn — theo LOẠI playbook, vì playbook KHÔNG có trạng thái riêng: trạng thái
       là của từng lượt chạy (xem `usePlaybooksApi.PlaybookRun`). SFC chỉ bind; state
       ở `usePlaybooksManager()`. -->
  <div class="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto px-1.5 pt-2 pb-3">
    <div
      v-if="loading"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-4.5 py-7.5 text-center text-dim"
    >
      <Icon name="refresh" class="size-5 animate-spin" />
      <p class="text-sm text-muted-foreground" role="status" aria-busy="true">
        {{ t('playbooks.list.loading') }}
      </p>
    </div>

    <!-- Lỗi phải nói CÁCH SỬA, không chỉ nói đã hỏng (luật 3). -->
    <div
      v-else-if="error"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-4.5 py-7.5 text-center text-dim"
    >
      <Icon name="alert" class="size-5" />
      <p class="text-sm text-muted-foreground">{{ error }}</p>
      <Button type="button" variant="outline" size="sm" @click="emit('refresh')">
        {{ t('playbooks.list.retry') }}
      </Button>
    </div>

    <div
      v-else-if="!groups.length"
      class="flex flex-1 flex-col items-center justify-center gap-2.5 px-4.5 py-7.5 text-center text-dim"
    >
      <Icon name="book" class="size-5" />
      <p class="text-sm text-muted-foreground">{{ t('playbooks.list.empty.title') }}</p>
      <p class="text-xs leading-(--lh-sm) text-dim">{{ t('playbooks.list.empty.hint') }}</p>
      <Button type="button" variant="outline" size="sm" @click="emit('refresh')">
        <Icon name="refresh" />
        {{ t('playbooks.toolbar.refresh') }}
      </Button>
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.key" class="flex flex-col gap-0.5">
        <!-- Nhãn nhóm viết sentence-case, KHÔNG all-caps (luật UI của repo). -->
        <div class="px-2 pt-1 pb-0.5 text-xs font-medium text-dim">
          {{ t(`playbooks.group.${group.key}`) }}
        </div>
        <ul class="m-0 flex list-none flex-col gap-px p-0">
          <li v-for="item in group.items" :key="keyOf(item)">
            <!-- Đang chọn = accent-tint + viền accent, KHÔNG nền xám đặc. -->
            <!-- raw-ok: hàng list cả dòng là một vùng bấm, không phải nút -->
            <button
              type="button"
              class="flex w-full cursor-default items-center gap-2 rounded-md border px-2 py-1.5 text-left text-foreground"
              :class="
                keyOf(item) === selectedKey
                  ? 'border-selected-border bg-selected'
                  : 'border-transparent hover:bg-accent'
              "
              @click="emit('open', item)"
            >
              <!-- Chấm tô theo NGUỒN: dựng sẵn (chỉ đọc) · dùng chung · riêng dự án.
                   Đây là thứ duy nhất phân biệt được hai playbook cùng id ở hai tier. -->
              <span
                class="size-2 shrink-0 rounded-full"
                :class="SRC_DOT[item.source] ?? 'bg-dim'"
              />
              <span class="flex min-w-0 flex-col gap-px">
                <span class="truncate text-sm">{{ item.name }}</span>
                <span class="text-xs text-dim">
                  {{
                    t('playbooks.list.meta', {
                      source: t(`playbooks.source.${item.source}`),
                      steps: item.stepCount,
                    })
                  }}
                </span>
              </span>
              <!-- File HỎNG: nói ra, đừng để nó trông như một dòng bình thường —
                   `issues` khác rỗng cũng là thứ tắt luôn nút gửi duyệt. -->
              <span
                v-if="item.issues.length"
                class="ml-auto inline-flex shrink-0 text-warning"
                role="img"
                :aria-label="t('playbooks.list.broken')"
                :title="t('playbooks.list.broken')"
              >
                <Icon name="alert" class="size-3" />
              </span>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '~/composables/useI18n'
import type { PlaybookGroupKey } from '~/composables/usePlaybooksManager'
import type { PlaybookSummary } from '~/composables/usePlaybooksApi'
import Button from '~/components/ui/button/Button.vue'

defineProps<{
  groups: { key: PlaybookGroupKey; items: PlaybookSummary[] }[]
  selectedKey: string
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  open: [summary: PlaybookSummary]
  refresh: []
}>()

const { t } = useI18n()

/** Màu chấm theo nguồn của playbook; nguồn lạ rơi về `bg-dim` ở template. */
const SRC_DOT: Record<string, string> = {
  builtin: 'bg-lavender',
  global: 'bg-primary',
  project: 'bg-info',
}

/**
 * Danh tính một dòng. `source` là MỘT PHẦN của khoá chứ không phải nhãn: cùng một
 * id nằm ở tier dựng sẵn và tier project là hai playbook khác nhau, nên so bằng
 * `id` không thôi sẽ tô sáng nhầm dòng. Trùng công thức với `summaryKey` ở manager.
 */
function keyOf(item: PlaybookSummary): string {
  return `${item.source}:${item.projectId ?? ''}:${item.id}`
}
</script>
