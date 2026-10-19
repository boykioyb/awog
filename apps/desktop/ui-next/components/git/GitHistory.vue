<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex min-h-0 flex-col border-b" :style="{ flex: `0 0 ${topHeight}px` }">
      <div class="flex items-center px-3 pt-2.5 pb-1.5 text-xs font-semibold text-muted-foreground">
        {{ t('git.history.title') }}
        <span class="ml-auto text-faint">
          {{ t('git.history.commits', { n: commits.length }) }}
        </span>
      </div>
      <div class="flex min-h-0 flex-1 overflow-y-auto">
        <div class="relative w-11 flex-none">
          <svg class="absolute top-0 left-0" :width="44" :height="commits.length * RH">
            <!-- Ghi chú: token `--edge` không được khai ở đâu nên đường lane chính hiện
                 không vẽ ra (stroke không hợp lệ) — giữ nguyên hành vi, xem báo cáo. -->
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
              class="stroke-lavender"
              stroke-width="1.6"
            />
            <path
              :d="`M${lx(1)} ${cy(2)} C ${lx(1)} ${cy(2) + 14}, ${lx(0)} ${cy(3) - 14}, ${lx(0)} ${cy(3)}`"
              fill="none"
              class="stroke-lavender"
              stroke-width="1.6"
            />
            <circle
              v-for="(cm, i) in commits"
              :key="cm.h"
              :cx="lx(cm.lane || 0)"
              :cy="cy(i)"
              :r="isSel(cm) ? 5 : 3.6"
              class="stroke-card"
              :class="cm.lane ? 'fill-lavender' : 'fill-primary'"
              stroke-width="1.6"
            />
          </svg>
        </div>
        <div class="min-w-0 flex-1">
          <div
            v-for="cm in commits"
            :key="cm.h"
            class="flex h-9.5 cursor-pointer items-center gap-2.5 pr-3.5"
            :class="
              isSel(cm)
                ? 'bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
                : 'hover:bg-accent'
            "
            @click="emit('select-commit', cm.h)"
            @contextmenu.prevent="emit('context-commit', $event, cm)"
          >
            <!-- mono-ok: tên ref git (nhánh / tag) -->
            <span
              v-for="(r, ri) in cm.refs || []"
              :key="ri"
              class="inline-flex max-w-55 flex-none items-center gap-0.5 overflow-hidden rounded-sm border px-1.5 font-mono text-xs whitespace-nowrap"
              :class="REF[r.t] ?? REF.branch"
            >
              <Icon v-if="r.t === 'head'" name="branch" class="size-2.5" />
              <Icon v-else-if="r.t === 'tag'" name="git" class="size-2.5" />
              {{ r.n }}
            </span>
            <span class="min-w-12.5 flex-1 truncate text-base font-medium">{{ cm.m }}</span>
            <span
              class="flex w-34.5 flex-none items-center gap-1.5 overflow-hidden text-sm text-muted-foreground"
            >
              <span
                class="inline-flex size-4.5 flex-none items-center justify-center rounded-full bg-selected text-xs font-semibold text-primary"
              >
                {{ avatarOf(cm.a) }}
              </span>
              <span class="truncate">{{ cm.a }}</span>
            </span>
            <!-- mono-ok: SHA commit -->
            <span class="w-16 flex-none font-mono text-xs text-primary tabular-nums">
              {{ cm.h }}
            </span>
            <span
              class="w-26 flex-none text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {{ cm.w }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Grip kéo đổi chiều cao (graph trên ↔ chi tiết dưới), không phải control. -->
    <div
      role="separator"
      aria-orientation="horizontal"
      class="relative h-1.5 flex-none cursor-row-resize self-stretch after:absolute after:inset-x-0 after:top-0.5 after:h-px after:bg-border hover:after:h-0.5 hover:after:bg-primary"
      :class="{ 'after:h-0.5 after:bg-primary': rowDragging }"
      @pointerdown="onRowDown"
    />

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GitCommitDetail
        v-if="selectedCommit"
        :commit="selectedCommit"
        :parent="parentHash"
        :tab="ctab"
        :files="detailFiles"
        :diff-by-path="detailDiffByPath"
        @set-tab="(tb) => emit('set-tab', tb)"
        @select-commit="(h) => emit('select-commit', h)"
        @context-file="(e, f) => emit('context-file', e, f)"
      />
      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center gap-3.5 p-10 text-center text-dim"
      >
        <span class="grid size-12 place-items-center rounded-xl border bg-card text-dim">
          <Icon name="git" class="size-5.5" />
        </span>
        <div class="text-lg text-muted-foreground">{{ t('git.history.empty') }}</div>
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
  (e: 'context-file', event: MouseEvent, file: string): void
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

// Kiểu ref trên hàng commit: HEAD fill primary, tag nghiêng vàng, còn lại trung tính.
const REF: Record<string, string> = {
  head: 'border-primary bg-primary font-semibold text-primary-foreground',
  branch: 'border-border bg-card text-muted-foreground',
  remote: 'border-border bg-card text-dim',
  tag: 'border-warning/40 bg-warning/15 text-warning',
}

const isSel = (cm: Commit): boolean => props.sel === `c:${cm.h}`

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
