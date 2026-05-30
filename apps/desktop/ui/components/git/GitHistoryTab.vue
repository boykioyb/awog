<template>
  <div class="flex flex-col flex-1 overflow-hidden">
    <!-- Top pane: commit table with DAG graph -->
    <div
      class="flex-shrink-0 overflow-hidden"
      :style="{ height: `${topHeight}px`, background: t.bgPanel }"
    >
      <GitHistoryTable
        :commits="store.commits"
        :selected-hash="store.selectedCommitHash"
        :has-more="store.historyHasMore"
        :loading="store.isLoadingHistoryMore"
        @select="(h: string) => store.selectCommit(h)"
        @load-more="onLoadMore"
      />
    </div>

    <!-- Horizontal resize handle -->
    <div
      class="flex-shrink-0 cursor-row-resize group"
      :class="{ 'is-dragging': dragging }"
      :style="{ height: '6px', background: dragging ? t.accent : t.border }"
      @mousedown="onDragStart"
      @dblclick="resetHeight"
    />

    <!-- Bottom pane: commit detail with tabs -->
    <div class="flex-1 overflow-hidden">
      <GitCommitDetailTabs :detail="detail" @select-parent="(h: string) => store.selectCommit(h)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GitCommit, GitFileDiff } from '~/types'

type Props = {
  detail: { commit: GitCommit; files: GitFileDiff[] } | null
}

defineProps<Props>()

const { t } = useTheme()
const store = useGitStore()

const STORAGE_KEY = 'awog.git.history-split-height'
const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 200
// Cap derived at drag-time from container height to keep the bottom pane usable.

const readStored = (): number | null => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= MIN_HEIGHT ? n : null
}

const topHeight = ref<number>(readStored() ?? DEFAULT_HEIGHT)
const dragging = ref(false)

let dragStartY = 0
let dragStartHeight = 0
let containerHeight = 0

const onDragMove = (e: MouseEvent) => {
  const maxHeight = Math.max(MIN_HEIGHT, containerHeight - MIN_HEIGHT)
  const next = Math.max(MIN_HEIGHT, Math.min(maxHeight, dragStartHeight + (e.clientY - dragStartY)))
  topHeight.value = next
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  try {
    window.localStorage.setItem(STORAGE_KEY, String(topHeight.value))
  } catch {
    // ignore
  }
}

const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  const handleEl = e.currentTarget as HTMLElement
  const container = handleEl.parentElement
  containerHeight = container?.getBoundingClientRect().height ?? 800
  dragStartY = e.clientY
  dragStartHeight = topHeight.value
  dragging.value = true
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetHeight = () => {
  topHeight.value = DEFAULT_HEIGHT
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

const onLoadMore = async () => {
  await store.loadMoreHistory()
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>
