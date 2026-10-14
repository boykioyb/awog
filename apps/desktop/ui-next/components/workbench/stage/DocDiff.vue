<template>
  <!-- Doc 'diff' — diff working-tree/staged của một file, render bằng
       GitDiffViewer (unified/split, hunk stage/unstage) như pane diff của trang
       Git. Doc id `diff:<projectId>/<rel>` (+ `:staged` khi xem index-vs-HEAD).
       Refetch khi doc đổi + khi danh sách git đổi (engine reconnect sẽ đổ list
       → watch bắn refresh), không poll. -->
  <!-- [&>*]:min-h-0 + [&>.dh]:flex-none + [&>.dscroll]:flex-1 — GitDiffViewer
       render fragment (.dh + .dscroll), children nhận data-v của cha nên variant
       chạm cả hai; .dh phải flex:none nếu không bị kéo giãn thành khoảng trắng. -->
  <div class="flex h-full min-h-0 flex-col [&>*]:min-h-0 [&>.dh]:flex-none [&>.dscroll]:flex-1">
    <!-- .empty/.et là class toàn cục của app (prototype.css) — flex center + text. -->
    <div v-if="!relPath" class="empty">
      <div class="et">{{ t('git.diff.empty') }}</div>
    </div>
    <GitDiffViewer
      v-else
      :file="relPath"
      :diff="diff"
      :diff-mode="diffMode"
      :staged="staged"
      :is-image="isImage"
      :image-src="imageSrc"
      :image-loading="imageLoading"
      @toggle-diff-mode="diffMode = diffMode === 'unified' ? 'split' : 'unified'"
      @stage-file="stageFile"
      @unstage-file="unstageFile"
      @stage-hunk="(h) => hunk(h, true)"
      @unstage-hunk="(h) => hunk(h, false)"
      @refresh="refresh"
    />
  </div>
</template>

<script setup lang="ts">
// Diff doc — mở từ SCM view (row click) hoặc StatusBar → id `diff:<pid>/<rel>`
// hoặc `diff:<pid>/<rel>:staged`. Reuse git store: loadDiff / stageFile /
// unstageFile / stageHunk / unstageHunk đều scope sẵn theo project tab.
import { computed, ref, watch } from 'vue'
import GitDiffViewer from '~/components/git/GitDiffViewer.vue'
import type { DiffLine, DiffMode } from '~/components/git/git-types'
import type { WorkbenchDoc } from '~/types/workbench'
import { useGitStore } from '~/stores/git'

const props = defineProps<{ doc: WorkbenchDoc }>()
const { t } = useI18n()
const git = useGitStore()

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i

// Parse `diff:<pid>/<rel>:staged` — suffix tách trước, segment đầu là project id
// (không chứa '/'), phần còn lại là rel path.
const parsed = computed(() => {
  let s = props.doc.id.startsWith('diff:') ? props.doc.id.slice(5) : props.doc.id
  let staged = false
  if (s.endsWith(':staged')) {
    staged = true
    s = s.slice(0, -7)
  }
  const slash = s.indexOf('/')
  return { rel: slash > 0 ? s.slice(slash + 1) : s, staged }
})
const relPath = computed(() => parsed.value.rel)
const staged = computed(() => parsed.value.staged)
const isImage = computed(() => IMG_EXT.test(relPath.value))

const diff = ref<DiffLine[]>([])
const diffMode = ref<DiffMode>('unified')
const imageSrc = ref<string | null>(null)
const imageLoading = ref(false)

async function refresh() {
  if (!relPath.value) return
  diff.value = await git.loadDiff(relPath.value, staged.value)
  if (isImage.value && !staged.value) {
    imageLoading.value = true
    imageSrc.value = await git.loadImageDataUrl(relPath.value)
    imageLoading.value = false
  }
}

async function stageFile(p: string) {
  await git.stageFile(p)
  await refresh()
}
async function unstageFile(p: string) {
  await git.unstageFile(p)
  await refresh()
}
async function hunk(idx: number, stage: boolean) {
  if (!relPath.value) return
  if (stage) await git.stageHunk(relPath.value, idx)
  else await git.unstageHunk(relPath.value, idx)
  await refresh()
}

watch(relPath, () => void refresh(), { immediate: true })
// Tự refetch khi danh sách file đổi — engine reconnect sẽ nạp lại staged/
// unstaged và bắn watch này, kéo theo refresh. Không poll.
watch(
  () => [git.staged.length, git.unstaged.length, git.conflicted.length],
  () => void refresh(),
)
</script>
