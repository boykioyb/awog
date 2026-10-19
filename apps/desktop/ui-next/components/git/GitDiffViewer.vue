<template>
  <div
    v-if="!file"
    class="flex flex-1 flex-col items-center justify-center gap-3.5 p-10 text-center text-dim"
  >
    <span class="grid size-12 place-items-center rounded-xl border bg-card text-dim">
      <Icon name="git" class="size-5.5" />
    </span>
    <div class="text-lg text-muted-foreground">{{ t('git.diff.empty') }}</div>
  </div>
  <template v-else>
    <!-- `dh` / `dscroll`: workbench/stage/DocDiff.vue nhắm `[&>.dh]` / `[&>.dscroll]`
         trên fragment này — giữ hai class làm hook. Header cao cố định, hairline
         bằng inset shadow. -->
    <!-- hook-ok: `.dh` — DocDiff.vue `[&>.dh]:flex-none` -->
    <div class="dh" :class="HEAD">
      <!-- mono-ok: tên file -->
      <span class="flex min-w-0 items-center font-mono text-sm font-semibold">
        <span class="truncate" :title="file ?? ''">{{ baseName }}</span>
      </span>
      <span v-if="additions > 0" class="flex-none rounded-sm px-1 font-mono text-xs text-success">
        +{{ additions }}
      </span>
      <span
        v-if="deletions > 0"
        class="flex-none rounded-sm px-1 font-mono text-xs text-destructive"
      >
        −{{ deletions }}
      </span>
      <span class="flex-1" />
      <!-- Nút refresh tuỳ chọn — DocDiff emit 'refresh' khi bấm; những caller
           khác (GitManager/GitHistory) không truyền listener thì ẩn. Màu chữ đậm hơn
           nút toggle để đọc rõ là button. -->
      <Button
        v-if="hasRefresh"
        variant="outline"
        size="xs"
        :class="[TOGGLE, 'border-input text-foreground']"
        :title="t('git.diff.refresh')"
        :aria-label="t('git.diff.refresh')"
        @click="emit('refresh')"
      >
        <RefreshCw class="size-3" />
      </Button>
      <Button
        v-if="!isImage"
        variant="outline"
        size="xs"
        :class="TOGGLE"
        :title="t('git.diff.toggleMode')"
        @click="emit('toggle-diff-mode')"
      >
        {{ diffMode === 'split' ? t('git.diff.split') : t('git.diff.unified') }}
      </Button>
      <Button v-if="!readonly" variant="outline" size="sm" class="shrink-0" @click="onPrimary">
        <Icon :name="staged ? 'rewind' : 'check'" class="size-3.5" />
        {{ staged ? t('git.diff.unstageFile') : t('git.diff.stageFile') }}
      </Button>
    </div>

    <!-- Image preview: an image row has a binary git diff (no hunks); show the
         on-disk bytes as an <img> instead of empty diff text. -->
    <!-- hook-ok: `.dscroll` — DocDiff.vue `[&>.dscroll]:flex-1` -->
    <div v-if="isImage" class="dscroll flex flex-1 items-center justify-center overflow-auto p-5">
      <div v-if="imageLoading" class="text-lg text-muted-foreground">
        {{ t('git.diff.imageLoading') }}
      </div>
      <img
        v-else-if="imageSrc"
        :src="imageSrc"
        :alt="baseName"
        class="max-h-full max-w-full rounded-sm object-contain"
      />
      <div v-else class="text-lg text-muted-foreground">
        {{ t('git.diff.imageUnavailable') }}
      </div>
    </div>

    <!-- Diff tràn viền: không padding, không khung card. Dòng diff tự wrap nên không
         cuộn ngang. -->
    <!-- hook-ok: `.dscroll` — DocDiff.vue `[&>.dscroll]:flex-1` -->
    <div v-else class="dscroll flex-1 overflow-y-auto p-0">
      <!-- mono-ok: nội dung diff -->
      <div class="font-mono text-sm">
        <div v-if="diffMode === 'split'" class="flex divide-x overflow-x-hidden">
          <div class="min-w-0 flex-1">
            <GitDiffLine v-for="(l, i) in splitLeft" :key="`l${i}`" :line="l" />
          </div>
          <div class="min-w-0 flex-1">
            <GitDiffLine v-for="(l, i) in splitRight" :key="`r${i}`" :line="l" />
          </div>
        </div>
        <div v-else class="overflow-x-hidden">
          <GitDiffLine
            v-for="(l, i) in unified"
            :key="i"
            :line="l"
            :staged="staged"
            :readonly="readonly"
            @hunk-action="onHunkAction"
          />
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
// Right pane diff viewer — unified / split, ported from gitDiff/diffSplit in the prototype.
// Diff content is rendered as plain text colored only by line type (add/del/context);
// it is intentionally NOT syntax-tokenized — per-token colors fought the add/del
// background and looked noisy ("loạn màu"), especially on prose / non-JS files.
import { computed, useAttrs } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import Button from '~/components/ui/button/Button.vue'
import type { DiffLine, DiffMode, DiffRow } from './git-types'
import { baseNameOf } from './git-types'

// Header cao cố định 50px, hairline bằng inset shadow (không ăn 1px chiều cao).
const HEAD =
  'flex h-12.5 flex-none items-center gap-2.5 px-5.5 shadow-[inset_0_-1px_0_var(--color-border)]'
// Nút nhỏ của header diff (refresh / unified↔split): viền trung tính, chữ nhỏ.
const TOGGLE =
  'h-auto flex-none gap-1 rounded-sm px-2 py-0.5 font-normal text-muted-foreground hover:border-input hover:text-foreground'

// One plain token carrying the whole line (no syntax highlighting).
const plain = (s: string): DiffRow['tokens'] => [{ text: s, cls: '' as const }]

const props = defineProps<{
  file: string | null
  diff: DiffLine[]
  diffMode: DiffMode
  // Image row: render an inline <img> preview instead of the (binary/empty) diff.
  isImage?: boolean
  imageSrc?: string | null
  imageLoading?: boolean
  // The selected row's section: staged → show "Unstage file" + hide per-hunk
  // stage (hunk-level unstage isn't supported yet).
  staged?: boolean
  // Diff của một commit đã có (tab Git Log): ẩn Stage/Unstage file + nút theo hunk.
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-diff-mode'): void
  (e: 'stage-file', file: string): void
  (e: 'unstage-file', file: string): void
  (e: 'stage-hunk', hunk: number): void
  (e: 'unstage-hunk', hunk: number): void
  (e: 'refresh'): void
}>()
const attrs = useAttrs()
// `v-on:refresh` listener xuất hiện trong attrs dưới `onRefresh` — chỉ hiện nút
// refresh khi caller thực sự truyền (DocDiff), caller khác (Git pane) thì ẩn.
const hasRefresh = computed(() => typeof attrs.onRefresh === 'function')
// Map the line's generic hunk button to stage (unstaged side) or unstage (staged
// side). Branch so each emit hits its own typed overload.
function onHunkAction(hunk: number) {
  if (props.staged) emit('unstage-hunk', hunk)
  else emit('stage-hunk', hunk)
}

const { t } = useI18n()

// Primary header action — stage the whole file, or unstage it on the staged side.
// Branch explicitly so each emit hits its own typed overload.
function onPrimary() {
  const f = props.file
  if (!f) return
  if (props.staged) emit('unstage-file', f)
  else emit('stage-file', f)
}

const baseName = computed(() => (props.file ? baseNameOf(props.file) : ''))

const additions = computed(() => props.diff.filter((l) => l.t === '+').length)
const deletions = computed(() => props.diff.filter((l) => l.t === '-').length)

const unified = computed<DiffRow[]>(() => {
  let hunk = 0
  return props.diff.map((l) => {
    if (l.t === '@') {
      // 0-based hunk index = number of @ headers seen before this one.
      const row: DiffRow = {
        cls: 'hunk',
        n: '',
        tokens: [{ text: l.s, cls: '' as const }],
        hunk,
      }
      hunk += 1
      return row
    }
    return {
      cls: l.t === '+' ? 'add' : l.t === '-' ? 'del' : '',
      n: l.n ?? '',
      tokens: plain(l.s),
    }
  })
})

const splitLeft = computed<DiffRow[]>(() => {
  const out: DiffRow[] = []
  for (const l of props.diff) {
    if (l.t === '@') out.push({ cls: 'hunk', n: '', tokens: [{ text: l.s, cls: '' as const }] })
    else if (l.t === '-') out.push({ cls: 'del', n: l.n ?? '', tokens: plain(l.s) })
    else if (l.t === '+') out.push({ cls: '', n: '', tokens: [] })
    else out.push({ cls: '', n: l.n ?? '', tokens: plain(l.s) })
  }
  return out
})

const splitRight = computed<DiffRow[]>(() => {
  const out: DiffRow[] = []
  for (const l of props.diff) {
    if (l.t === '@') out.push({ cls: 'hunk', n: '', tokens: [] })
    else if (l.t === '-') out.push({ cls: '', n: '', tokens: [] })
    else if (l.t === '+') out.push({ cls: 'add', n: l.n ?? '', tokens: plain(l.s) })
    else out.push({ cls: '', n: l.n ?? '', tokens: plain(l.s) })
  }
  return out
})
</script>
