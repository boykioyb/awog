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
        class="text-[10px]"
        :style="{ color: t.textDim }"
      >
        (renamed from {{ diff.oldPath }})
      </span>
      <span
        v-if="diff.isBinary"
        class="ml-auto text-[10px] px-1.5 py-0.5 rounded"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
      >
        binary
      </span>
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
    <div v-else class="flex-1 overflow-auto font-mono text-[12px] leading-[1.55]">
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
            {{ oldLineNum(hunk, hi, li) }}
          </div>
          <div
            class="select-none text-right pr-2 pl-2 flex-shrink-0"
            :style="{
              color: t.textFaint,
              width: '40px',
              borderRight: `1px solid ${t.border}`,
            }"
          >
            {{ newLineNum(hunk, hi, li) }}
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
  </div>
</template>

<script setup lang="ts">
import { FileText, FileImage } from 'lucide-vue-next'
import type { GitDiffHunk, GitDiffLineKind, GitFileDiff } from '~/types'

defineProps<{ diff: GitFileDiff | null }>()

const { t } = useTheme()

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

// Tính line number theo offset trong hunk (đơn giản, đủ cho prototype).
const oldLineNum = (hunk: GitDiffHunk, _hi: number, li: number): string => {
  let count = hunk.oldStart
  for (let i = 0; i < li; i += 1) {
    const prev = hunk.lines[i]
    if (prev && prev.kind !== 'add') count += 1
  }
  const line = hunk.lines[li]
  if (!line || line.kind === 'add') return ''
  return String(count)
}

const newLineNum = (hunk: GitDiffHunk, _hi: number, li: number): string => {
  let count = hunk.newStart
  for (let i = 0; i < li; i += 1) {
    const prev = hunk.lines[i]
    if (prev && prev.kind !== 'del') count += 1
  }
  const line = hunk.lines[li]
  if (!line || line.kind === 'del') return ''
  return String(count)
}
</script>
