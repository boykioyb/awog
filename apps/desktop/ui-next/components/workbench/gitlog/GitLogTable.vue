<template>
  <!-- Bảng log kiểu JetBrains: graph · tiêu đề (+ chip HEAD/branch/tag) · tác giả · thời
       gian. ↑/↓ đổi commit đang chọn; cuộn tới cuối tự tải trang kế. Hàng là list item
       (không phải control) nên dùng element thô được — workbench-ui.md. Hàng 26px (h-6.5)
       = ROW_H của GitLogGraphCell: graph của các hàng liền nhau nối thành một. Hàng chọn
       = accent-tint + thanh accent 2px (luật selection của app). -->
  <div
    ref="scrollEl"
    class="min-h-0 flex-1 overflow-y-auto outline-hidden"
    tabindex="0"
    @keydown.down.prevent="emit('step', 1)"
    @keydown.up.prevent="emit('step', -1)"
    @scroll.passive="onScroll"
  >
    <div v-if="!rows.length && !loading" class="px-3 py-3 text-sm text-faint">
      {{ t('wb.gitlog.empty') }}
    </div>
    <div
      v-for="r in rows"
      :key="r.commit.sha ?? r.commit.h"
      :data-sha="r.commit.sha ?? r.commit.h"
      class="flex h-6.5 cursor-pointer items-center gap-2 whitespace-nowrap pr-3 text-sm"
      :class="[
        (r.commit.sha ?? r.commit.h) === selected
          ? 'bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
          : 'hover:bg-accent',
        { 'pl-3': !r.graph || !graphWidth },
      ]"
      :title="r.commit.m"
      @click="emit('select', r.commit.sha ?? r.commit.h)"
    >
      <GitLogGraphCell v-if="r.graph && graphWidth" :row="r.graph" :width="graphWidth" />
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          v-for="rf in r.commit.refs ?? []"
          :key="`${rf.t}:${rf.n}`"
          class="max-w-40 flex-none truncate rounded-sm border px-1 text-xs"
          :class="REF_CLS[rf.t] ?? 'text-dim'"
          :data-t="rf.t"
          :title="rf.n"
        >
          {{ rf.t === 'head' ? 'HEAD' : rf.n }}
        </span>
        <span class="truncate text-foreground">{{ r.commit.m }}</span>
      </span>
      <span class="w-33 flex-none truncate text-dim">{{ r.commit.a }}</span>
      <span class="w-21 flex-none truncate text-right tabular-nums text-faint">
        {{ r.commit.w }}
      </span>
    </div>
    <div v-if="loading" class="px-3 py-2 text-xs text-faint">
      {{ t('wb.gitlog.loading') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitLogRow } from '~/composables/useGitLog'
import GitLogGraphCell from './GitLogGraphCell.vue'

const props = defineProps<{
  rows: GitLogRow[]
  graphWidth: number
  selected: string | null
  hasMore: boolean
  loading: boolean
}>()
const emit = defineEmits<{ select: [sha: string]; 'load-more': []; step: [delta: 1 | -1] }>()
const { t } = useI18n()

const scrollEl = useTemplateRef<HTMLElement>('scrollEl')

function onScroll(): void {
  const el = scrollEl.value
  if (!el || !props.hasMore || props.loading) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) emit('load-more')
}

// Commit được chọn từ ngoài (SCM, phím ↑/↓, nhảy tới parent) luôn nằm trong khung nhìn.
watch(
  () => props.selected,
  async (sha) => {
    if (!sha) return
    await nextTick()
    scrollEl.value
      ?.querySelector<HTMLElement>(`[data-sha="${CSS.escape(sha)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  },
)

// Màu chip ref theo loại (HEAD / branch / tag).
const REF_CLS: Record<string, string> = {
  head: 'border-selected-border text-primary',
  branch: 'text-success',
  tag: 'text-warning',
}
</script>
