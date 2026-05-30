<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <div
      v-if="diff"
      class="px-3 py-2 flex items-center gap-2 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <FileText :size="12" :style="{ color: t.textDim }" />
      <span class="text-xs font-mono truncate" :style="{ color: t.text }">
        {{ diff.path }}
      </span>
      <span
        v-if="diff.oldPath && diff.oldPath !== diff.path"
        class="text-[0.71em]"
        :style="{ color: t.textDim }"
      >
        (renamed from {{ diff.oldPath }})
      </span>
      <div class="ml-auto flex items-center gap-1">
        <span
          v-if="diff.isBinary"
          class="text-[0.71em] px-1.5 py-0.5 rounded"
          :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        >
          binary
        </span>
        <div
          v-else
          class="flex items-center rounded overflow-hidden"
          :style="{ border: `1px solid ${t.border}` }"
        >
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-0.5 text-[0.71em] transition"
            :style="toggleStyle('unified')"
            title="Unified view"
            @click="viewMode = 'unified'"
          >
            <AlignJustify :size="10" />
            Unified
          </button>
          <button
            type="button"
            class="flex items-center gap-1 px-2 py-0.5 text-[0.71em] transition"
            :style="toggleStyle('split')"
            title="Side-by-side view"
            @click="viewMode = 'split'"
          >
            <Columns2 :size="10" />
            Split
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="!diff"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      Select a file to view diff
    </div>
    <div
      v-else-if="diff.isBinary"
      class="flex-1 flex flex-col items-center justify-center text-xs gap-2"
      :style="{ color: t.textDim }"
    >
      <FileImage :size="32" :stroke-width="1.5" />
      <span>Binary file — no inline diff</span>
    </div>
    <div
      v-else-if="diff.hunks.length === 0"
      class="flex-1 flex items-center justify-center text-xs"
      :style="{ color: t.textDim }"
    >
      No changes
    </div>

    <!-- Unified view -->
    <div
      v-else-if="viewMode === 'unified'"
      class="flex-1 overflow-auto font-mono text-[0.86em] leading-[1.55]"
    >
      <div v-for="(hunk, hi) in diff.hunks" :key="hi">
        <div
          class="px-3 py-1 sticky top-0 z-10 flex items-center gap-2"
          :style="{
            background: t.infoBg,
            color: t.info,
            borderTop: hi > 0 ? `1px solid ${t.border}` : 'none',
            borderBottom: `1px solid ${t.border}`,
          }"
        >
          <span class="flex-1 truncate">{{ hunk.header }}</span>
          <button
            v-if="canStageHunk"
            type="button"
            class="text-[0.71em] px-2 py-0.5 rounded transition flex items-center gap-1"
            :style="{
              background: t.bgInput,
              color: t.accent,
              border: `1px solid ${t.accent}`,
            }"
            title="Stage chỉ hunk này"
            @click="emit('stageHunk', hi)"
          >
            Stage hunk
          </button>
        </div>
        <div
          v-for="(line, li) in hunk.lines"
          :key="`${hi}-${li}`"
          class="flex"
          :style="{ background: bgFor(line.kind) }"
        >
          <div
            class="select-none text-right pr-2 pl-2 flex-shrink-0"
            :style="{
              color: t.textFaint,
              width: '40px',
              borderRight: `1px solid ${t.border}`,
            }"
          >
            {{ oldLineNum(hunk, li) }}
          </div>
          <div
            class="select-none text-right pr-2 pl-2 flex-shrink-0"
            :style="{
              color: t.textFaint,
              width: '40px',
              borderRight: `1px solid ${t.border}`,
            }"
          >
            {{ newLineNum(hunk, li) }}
          </div>
          <div
            class="pl-3 pr-3 flex-1 min-w-0"
            :style="{
              color: colorFor(line.kind),
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }"
          >
            <span class="select-none" :style="{ color: t.textFaint }">
              {{ prefixFor(line.kind) }}
            </span>
            {{ line.text || ' ' }}
          </div>
        </div>
      </div>
    </div>

    <!-- Split (side-by-side) view -->
    <div v-else class="flex-1 overflow-auto font-mono text-[0.86em] leading-[1.55]">
      <div v-for="(hunk, hi) in diff.hunks" :key="hi">
        <div
          class="px-3 py-1 sticky top-0 z-10"
          :style="{
            background: t.infoBg,
            color: t.info,
            borderTop: hi > 0 ? `1px solid ${t.border}` : 'none',
            borderBottom: `1px solid ${t.border}`,
          }"
        >
          {{ hunk.header }}
        </div>
        <div
          v-for="(row, ri) in splitRows(hunk)"
          :key="`${hi}-${ri}`"
          class="flex"
          :style="{ borderBottom: `1px solid ${t.border}` }"
        >
          <!-- left (old) -->
          <div
            class="flex flex-1 min-w-0"
            :style="{ background: bgFor(row.left?.kind ?? 'context'), opacity: row.left ? 1 : 0.5 }"
          >
            <div
              class="select-none text-right pr-2 pl-2 flex-shrink-0"
              :style="{
                color: t.textFaint,
                width: '40px',
                borderRight: `1px solid ${t.border}`,
              }"
            >
              {{ row.oldNum || '' }}
            </div>
            <div
              class="pl-3 pr-3 flex-1 min-w-0"
              :style="{
                color: row.left ? colorFor(row.left.kind) : t.textFaint,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }"
            >
              <template v-if="row.left">
                <span class="select-none" :style="{ color: t.textFaint }">
                  {{ prefixFor(row.left.kind === 'add' ? 'context' : row.left.kind) }}
                </span>
                {{ row.left.text || ' ' }}
              </template>
            </div>
          </div>
          <div :style="{ width: '1px', background: t.border }" />
          <!-- right (new) -->
          <div
            class="flex flex-1 min-w-0"
            :style="{
              background: bgFor(row.right?.kind ?? 'context'),
              opacity: row.right ? 1 : 0.5,
            }"
          >
            <div
              class="select-none text-right pr-2 pl-2 flex-shrink-0"
              :style="{
                color: t.textFaint,
                width: '40px',
                borderRight: `1px solid ${t.border}`,
              }"
            >
              {{ row.newNum || '' }}
            </div>
            <div
              class="pl-3 pr-3 flex-1 min-w-0"
              :style="{
                color: row.right ? colorFor(row.right.kind) : t.textFaint,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }"
            >
              <template v-if="row.right">
                <span class="select-none" :style="{ color: t.textFaint }">
                  {{ prefixFor(row.right.kind === 'del' ? 'context' : row.right.kind) }}
                </span>
                {{ row.right.text || ' ' }}
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { AlignJustify, Columns2, FileImage, FileText } from 'lucide-vue-next'
import type { GitDiffHunk, GitDiffLine, GitDiffLineKind, GitFileDiff } from '~/types'

const props = defineProps<{
  diff: GitFileDiff | null
  // When true the file shown is unstaged (or partially staged) — render
  // per-hunk Stage buttons. Caller decides; component just emits.
  canStageHunk?: boolean
}>()
const emit = defineEmits<{ stageHunk: [hunkIndex: number] }>()
// Keep `props` referenced for vue-tsc — Vue compiler reads template-only usage.
void props

const { t } = useTheme()
const viewMode = ref<'unified' | 'split'>('unified')

const bgFor = (k: GitDiffLineKind) => {
  if (k === 'add') return 'rgba(34, 197, 94, 0.10)'
  if (k === 'del') return 'rgba(239, 68, 68, 0.10)'
  return 'transparent'
}

const colorFor = (k: GitDiffLineKind) => {
  if (k === 'add') return t.value.gitAdded
  if (k === 'del') return t.value.gitDeleted
  return t.value.textMuted
}

const prefixFor = (k: GitDiffLineKind) => {
  if (k === 'add') return '+ '
  if (k === 'del') return '- '
  return '  '
}

const toggleStyle = (mode: 'unified' | 'split') => ({
  background: viewMode.value === mode ? t.value.accent : t.value.bgPanel,
  color: viewMode.value === mode ? t.value.accentText : t.value.textMuted,
  cursor: 'pointer',
})

const oldLineNum = (hunk: GitDiffHunk, li: number): string => {
  let count = hunk.oldStart
  for (let i = 0; i < li; i += 1) {
    const prev = hunk.lines[i]
    if (prev && prev.kind !== 'add') count += 1
  }
  const line = hunk.lines[li]
  if (!line || line.kind === 'add') return ''
  return String(count)
}

const newLineNum = (hunk: GitDiffHunk, li: number): string => {
  let count = hunk.newStart
  for (let i = 0; i < li; i += 1) {
    const prev = hunk.lines[i]
    if (prev && prev.kind !== 'del') count += 1
  }
  const line = hunk.lines[li]
  if (!line || line.kind === 'del') return ''
  return String(count)
}

type SplitRow = {
  left: GitDiffLine | null
  right: GitDiffLine | null
  oldNum: string
  newNum: string
}

// Ghép del/add liên tiếp thành cùng row. Context line đặt cả 2 phía.
const splitRows = (hunk: GitDiffHunk): SplitRow[] => {
  const rows: SplitRow[] = []
  let oldCount = hunk.oldStart
  let newCount = hunk.newStart
  let i = 0
  while (i < hunk.lines.length) {
    const line = hunk.lines[i]
    if (!line) {
      i += 1
      continue
    }
    if (line.kind === 'context') {
      rows.push({
        left: line,
        right: line,
        oldNum: String(oldCount),
        newNum: String(newCount),
      })
      oldCount += 1
      newCount += 1
      i += 1
      continue
    }
    // Gom block del + add liên tiếp
    const dels: GitDiffLine[] = []
    const adds: GitDiffLine[] = []
    while (i < hunk.lines.length && hunk.lines[i]?.kind === 'del') {
      dels.push(hunk.lines[i] as GitDiffLine)
      i += 1
    }
    while (i < hunk.lines.length && hunk.lines[i]?.kind === 'add') {
      adds.push(hunk.lines[i] as GitDiffLine)
      i += 1
    }
    const pairCount = Math.max(dels.length, adds.length)
    for (let j = 0; j < pairCount; j += 1) {
      const left = dels[j] ?? null
      const right = adds[j] ?? null
      rows.push({
        left,
        right,
        oldNum: left ? String(oldCount) : '',
        newNum: right ? String(newCount) : '',
      })
      if (left) oldCount += 1
      if (right) newCount += 1
    }
  }
  return rows
}
</script>
