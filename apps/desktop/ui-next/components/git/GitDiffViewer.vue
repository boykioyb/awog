<template>
  <div v-if="!file" class="empty">
    <span class="ei"><Icon name="git" style="width: 21px; height: 21px" /></span>
    <div class="et">{{ t('git.diff.empty') }}</div>
  </div>
  <template v-else>
    <div class="dh">
      <span class="dt mono" style="font-size: 0.9231rem">
        <span class="dtname" :title="file ?? ''">{{ baseName }}</span>
      </span>
      <span v-if="additions > 0" class="chip" style="color: var(--add)">+{{ additions }}</span>
      <span v-if="deletions > 0" class="chip" style="color: var(--del)">−{{ deletions }}</span>
      <span style="flex: 1" />
      <span
        v-if="!isImage"
        class="gtoggle"
        :title="t('git.diff.toggleMode')"
        @click="emit('toggle-diff-mode')"
      >
        {{ diffMode === 'split' ? t('git.diff.split') : t('git.diff.unified') }}
      </span>
      <button class="btn sm" @click="onPrimary">
        <Icon :name="staged ? 'rewind' : 'check'" style="width: 14px; height: 14px" />
        {{ staged ? t('git.diff.unstageFile') : t('git.diff.stageFile') }}
      </button>
    </div>

    <!-- Image preview: an image row has a binary git diff (no hunks); show the
         on-disk bytes as an <img> instead of empty diff text. -->
    <div v-if="isImage" class="dscroll dimgscroll">
      <div v-if="imageLoading" class="empty">
        <div class="et">{{ t('git.diff.imageLoading') }}</div>
      </div>
      <img v-else-if="imageSrc" :src="imageSrc" :alt="baseName" class="dimg" />
      <div v-else class="empty">
        <div class="et">{{ t('git.diff.imageUnavailable') }}</div>
      </div>
    </div>

    <div v-else class="dscroll">
      <div class="codeview">
        <div v-if="diffMode === 'split'" class="cvsplit">
          <div class="cvspane">
            <GitDiffLine v-for="(l, i) in splitLeft" :key="`l${i}`" :line="l" />
          </div>
          <div class="cvspane">
            <GitDiffLine v-for="(l, i) in splitRight" :key="`r${i}`" :line="l" />
          </div>
        </div>
        <div v-else class="cvdiff">
          <GitDiffLine
            v-for="(l, i) in unified"
            :key="i"
            :line="l"
            :staged="staged"
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
import type { DiffLine, DiffMode, DiffRow } from './git-types'
import { baseNameOf } from './git-types'

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
}>()

const emit = defineEmits<{
  (e: 'toggle-diff-mode'): void
  (e: 'stage-file', file: string): void
  (e: 'unstage-file', file: string): void
  (e: 'stage-hunk', hunk: number): void
  (e: 'unstage-hunk', hunk: number): void
}>()

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

<style scoped>
/* A long filename must truncate with an ellipsis, not paint over the header
   actions (diff-mode toggle + Stage/Unstage). .dt is display:flex (from the
   global .dh .dt), so the ellipsis lives on the inner text element. */
.dtname {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* Header actions keep their size; the filename yields the space instead of them
   getting squeezed or overlapped. */
.gtoggle,
.btn {
  flex: 0 0 auto;
}

/* Full-bleed diff: drop the scroll-area padding and the .codeview card chrome
   (border / radius / margin / surface) so the diff fills the pane edge-to-edge.
   Scoped → other .codeview / .dscroll usages (commit detail, editor) keep theirs. */
.dscroll {
  padding: 0;
}
.codeview {
  border: none;
  border-radius: 0;
  margin: 0;
  background: transparent;
}

/* Image preview — center the bitmap in the scroll area, with breathing room and a
   checkerboard-free neutral surface so transparent PNGs read against the theme. */
.dimgscroll {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow: auto;
}
.dimg {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}
</style>
