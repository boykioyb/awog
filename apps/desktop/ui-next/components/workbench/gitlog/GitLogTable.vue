<template>
  <!-- Bảng log kiểu JetBrains: graph · tiêu đề (+ chip HEAD/branch/tag) · tác giả · thời
       gian. ↑/↓ đổi commit đang chọn; cuộn tới cuối tự tải trang kế. Hàng là list item
       (không phải control) nên dùng element thô được — workbench-ui.md. -->
  <div
    ref="scrollEl"
    class="min-h-0 flex-1 overflow-y-auto outline-none"
    tabindex="0"
    @keydown.down.prevent="emit('step', 1)"
    @keydown.up.prevent="emit('step', -1)"
    @scroll.passive="onScroll"
  >
    <div v-if="!rows.length && !loading" class="px-3 py-3 text-sm text-[var(--textFaint)]">
      {{ t('wb.gitlog.empty') }}
    </div>
    <div
      v-for="r in rows"
      :key="r.commit.sha ?? r.commit.h"
      :data-sha="r.commit.sha ?? r.commit.h"
      class="glrow"
      :class="{ on: (r.commit.sha ?? r.commit.h) === selected, 'pl-3': !r.graph || !graphWidth }"
      :title="r.commit.m"
      @click="emit('select', r.commit.sha ?? r.commit.h)"
    >
      <GitLogGraphCell v-if="r.graph && graphWidth" :row="r.graph" :width="graphWidth" />
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          v-for="rf in r.commit.refs ?? []"
          :key="`${rf.t}:${rf.n}`"
          class="glref"
          :data-t="rf.t"
          :title="rf.n"
        >
          {{ rf.t === 'head' ? 'HEAD' : rf.n }}
        </span>
        <span class="truncate text-[var(--text)]">{{ r.commit.m }}</span>
      </span>
      <span class="w-[132px] flex-none truncate text-[var(--textDim)]">{{ r.commit.a }}</span>
      <span class="w-[84px] flex-none truncate text-right tabular-nums text-[var(--textFaint)]">
        {{ r.commit.w }}
      </span>
    </div>
    <div v-if="loading" class="px-3 py-2 text-xs text-[var(--textFaint)]">
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
</script>

<style scoped>
/* Hàng 26px = ROW_H của GitLogGraphCell: graph của các hàng liền nhau nối thành một. */
.glrow {
  display: flex;
  height: 26px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: nowrap;
}
.glrow:hover {
  background: var(--bgHover);
}
/* Chọn = accent-tint + thanh accent 2px (luật selection của app). */
.glrow.on {
  background: var(--accentDim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.glref {
  flex: 0 0 auto;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.glref[data-t='head'] {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.glref[data-t='branch'] {
  color: var(--success);
}
.glref[data-t='tag'] {
  color: var(--warning);
}
</style>
