<template>
  <div class="ghmain">
    <div class="ghtop" :style="{ flex: `0 0 ${topHeight}px` }">
      <div class="gfh ghhdr">
        HISTORY
        <span style="margin-left: auto; color: var(--textFaint)">{{ commits.length }} commits</span>
      </div>
      <div class="ghist">
        <div class="ghgcol">
          <svg class="ghgsvg" :width="44" :height="commits.length * RH">
            <line
              :x1="lx(0)"
              :y1="cy(0)"
              :x2="lx(0)"
              :y2="cy(commits.length - 1)"
              stroke="var(--edge)"
              stroke-width="1.6"
            />
            <path
              :d="`M${lx(0)} ${cy(1)} C ${lx(0)} ${cy(1) + 14}, ${lx(1)} ${cy(2) - 14}, ${lx(1)} ${cy(2)}`"
              fill="none"
              stroke="var(--violet)"
              stroke-width="1.6"
            />
            <path
              :d="`M${lx(1)} ${cy(2)} C ${lx(1)} ${cy(2) + 14}, ${lx(0)} ${cy(3) - 14}, ${lx(0)} ${cy(3)}`"
              fill="none"
              stroke="var(--violet)"
              stroke-width="1.6"
            />
            <circle
              v-for="(cm, i) in commits"
              :key="cm.h"
              :cx="lx(cm.lane || 0)"
              :cy="cy(i)"
              :r="sel === `c:${cm.h}` ? 5 : 3.6"
              :fill="cm.lane ? 'var(--violet)' : 'var(--accent)'"
              stroke="var(--bg)"
              stroke-width="1.6"
            />
          </svg>
        </div>
        <div class="ghrows">
          <div
            v-for="cm in commits"
            :key="cm.h"
            class="ghrow2"
            :class="{ on: sel === `c:${cm.h}` }"
            @click="emit('select-commit', cm.h)"
            @contextmenu.prevent="emit('context-commit', $event, cm)"
          >
            <span v-for="(r, ri) in cm.refs || []" :key="ri" class="ghref" :class="r.t">
              <Icon v-if="r.t === 'head'" name="branch" style="width: 10px; height: 10px" />
              <Icon v-else-if="r.t === 'tag'" name="git" style="width: 10px; height: 10px" />
              {{ r.n }}
            </span>
            <span class="ghsubj">{{ cm.m }}</span>
            <span class="ghauthor">
              <span class="pav2">{{ avatarOf(cm.a) }}</span>
              <span class="ghan">{{ cm.a }}</span>
            </span>
            <span class="ghhash">{{ cm.h }}</span>
            <span class="ghdate">{{ cm.w }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grszh" :class="{ drag: rowDragging }" @pointerdown="onRowDown" />

    <div class="ghbot">
      <GitCommitDetail
        v-if="selectedCommit"
        :commit="selectedCommit"
        :parent="parentHash"
        :tab="ctab"
        :files="detailFiles"
        :diff-by-path="detailDiffByPath"
        @set-tab="(tb) => emit('set-tab', tb)"
        @select-commit="(h) => emit('select-commit', h)"
      />
      <div v-else class="empty">
        <span class="ei"><Icon name="git" style="width: 21px; height: 21px" /></span>
        <div class="et">{{ t('git.history.empty') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Git history view — DAG graph + commit rows + commit detail panel.
// Ported from ghistGraph/ghistRow + commitDetail wiring in renderGCols.
import type { Commit, CommitTab, DiffLine, GitFile } from './git-types'
import { avatarOf } from './git-types'

const props = defineProps<{
  commits: Commit[]
  sel: string | null
  ctab: CommitTab
  detailFiles?: GitFile[]
  detailDiffByPath?: Record<string, DiffLine[]>
}>()

const emit = defineEmits<{
  (e: 'select-commit', hash: string): void
  (e: 'set-tab', tab: CommitTab): void
  (e: 'context-commit', event: MouseEvent, commit: Commit): void
}>()
const { t } = useI18n()

// Resizable split between the commit graph (top) and the commit detail (bottom).
const topHeight = ref(360)
const rowDragging = ref(false)
function onRowDown(ev: PointerEvent) {
  ev.preventDefault()
  const handle = ev.currentTarget as HTMLElement
  handle.setPointerCapture(ev.pointerId)
  rowDragging.value = true
  const startY = ev.clientY
  const startH = topHeight.value
  const onMove = (e: PointerEvent) => {
    topHeight.value = Math.max(160, Math.min(760, startH + (e.clientY - startY)))
  }
  const onUp = () => {
    rowDragging.value = false
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
}

const RH = 38
const lx = (lane: number) => lane * 16 + 13
const cy = (i: number) => i * RH + RH / 2

const selectedCommit = computed<Commit | null>(() => {
  if (!props.sel || !props.sel.startsWith('c:')) return null
  const hash = props.sel.slice(2)
  return props.commits.find((x) => x.h === hash) ?? null
})

const parentHash = computed<string | null>(() => {
  const cm = selectedCommit.value
  if (!cm) return null
  const idx = props.commits.indexOf(cm)
  return props.commits[idx + 1]?.h ?? null
})
</script>
