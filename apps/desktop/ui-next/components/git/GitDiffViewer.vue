<template>
  <div v-if="!file" class="empty">
    <span class="ei"><Icon name="git" style="width: 21px; height: 21px" /></span>
    <div class="et">{{ t('git.diff.empty') }}</div>
  </div>
  <template v-else>
    <div class="dh">
      <span class="dt mono" style="font-size: 0.9231rem">{{ baseName }}</span>
      <span v-if="additions > 0" class="chip" style="color: var(--add)">+{{ additions }}</span>
      <span v-if="deletions > 0" class="chip" style="color: var(--del)">−{{ deletions }}</span>
      <span style="flex: 1" />
      <span class="gtoggle" :title="t('git.diff.toggleMode')" @click="emit('toggle-diff-mode')">
        {{ diffMode === 'split' ? t('git.diff.split') : t('git.diff.unified') }}
      </span>
      <button class="btn sm" @click="emit('stage-file', file)">
        <Icon name="check" style="width: 14px; height: 14px" />
        {{ t('git.diff.stageFile') }}
      </button>
    </div>
    <div class="dscroll">
      <div class="codeview">
        <div class="cvhead">
          <Icon name="git" style="width: 12px; height: 12px" />
          <span>{{ file }}</span>
          <span class="cvlang">{{ diffMode === 'split' ? 'split' : 'diff' }}</span>
        </div>
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
            @stage-hunk="(h) => emit('stage-hunk', h)"
          />
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
// Right pane diff viewer — unified / split, ported from gitDiff/diffSplit in the prototype.
import type { DiffLine, DiffMode, DiffRow } from './git-types'
import { baseNameOf, tokenizeCode } from './git-types'

const props = defineProps<{
  file: string | null
  diff: DiffLine[]
  diffMode: DiffMode
}>()

const emit = defineEmits<{
  (e: 'toggle-diff-mode'): void
  (e: 'stage-file', file: string): void
  (e: 'stage-hunk', hunk: number): void
}>()

const { t } = useI18n()

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
      tokens: tokenizeCode(l.s),
    }
  })
})

const splitLeft = computed<DiffRow[]>(() => {
  const out: DiffRow[] = []
  for (const l of props.diff) {
    if (l.t === '@') out.push({ cls: 'hunk', n: '', tokens: [{ text: l.s, cls: '' as const }] })
    else if (l.t === '-') out.push({ cls: 'del', n: l.n ?? '', tokens: tokenizeCode(l.s) })
    else if (l.t === '+') out.push({ cls: '', n: '', tokens: [] })
    else out.push({ cls: '', n: l.n ?? '', tokens: tokenizeCode(l.s) })
  }
  return out
})

const splitRight = computed<DiffRow[]>(() => {
  const out: DiffRow[] = []
  for (const l of props.diff) {
    if (l.t === '@') out.push({ cls: 'hunk', n: '', tokens: [] })
    else if (l.t === '-') out.push({ cls: '', n: '', tokens: [] })
    else if (l.t === '+') out.push({ cls: 'add', n: l.n ?? '', tokens: tokenizeCode(l.s) })
    else out.push({ cls: '', n: l.n ?? '', tokens: tokenizeCode(l.s) })
  }
  return out
})
</script>
