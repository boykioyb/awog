<template>
  <!-- Doc 'cdiff' — diff của MỘT file trong một commit, mở từ tab Git Log. Chỉ đọc
       (không stage/unstage), unified/split như pane diff của trang Git.
       [&>.dh]:flex-none + [&>.dscroll]:flex-1 — xem chú thích cùng chỗ ở DocDiff. -->
  <div class="flex h-full min-h-0 flex-col *:min-h-0 [&>.dh]:flex-none [&>.dscroll]:flex-1">
    <div
      v-if="loading"
      class="flex flex-1 flex-col items-center justify-center gap-3.5 text-center text-dim"
    >
      <div class="text-lg text-muted-foreground">{{ t('wb.gitlog.loading') }}</div>
    </div>
    <GitDiffViewer
      v-else
      :file="parsed.rel"
      :diff="diff"
      :diff-mode="diffMode"
      readonly
      @toggle-diff-mode="diffMode = diffMode === 'unified' ? 'split' : 'unified'"
    />
  </div>
</template>

<script setup lang="ts">
import GitDiffViewer from '~/components/git/GitDiffViewer.vue'
import type { DiffLine, DiffMode } from '~/components/git/git-types'
import type { WorkbenchDoc } from '~/types/workbench'

const props = defineProps<{ doc: WorkbenchDoc }>()
const { t } = useI18n()
const { diffOf } = useCommitDiffCache()

// `cdiff:<pid>/<sha>/<rel>` — project id không chứa '/', sha là segment kế.
const parsed = computed(() => {
  const s = props.doc.id.replace(/^cdiff:/, '')
  const [, sha = '', ...rest] = s.split('/')
  return { sha, rel: rest.join('/') }
})

const diff = ref<DiffLine[]>([])
const diffMode = ref<DiffMode>('unified')
const loading = ref(false)

watch(
  parsed,
  async ({ sha, rel }) => {
    if (!sha) return
    loading.value = true
    const byPath = await diffOf(sha)
    loading.value = false
    diff.value = byPath[rel] ?? []
  },
  { immediate: true },
)
</script>
