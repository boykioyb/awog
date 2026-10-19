<template>
  <div
    class="mb-3 overflow-hidden rounded-md border"
    :class="{ 'border-primary': choice !== undefined }"
  >
    <div class="flex items-center gap-2 border-b bg-muted px-2.5 py-1.5">
      <span class="text-sm text-muted-foreground tabular-nums">
        {{ t('git.conflict.blockTitle', { i: index + 1, n: total, line }) }}
      </span>
      <span class="flex-1" />
      <Button
        :variant="choice === 'ours' ? 'default' : 'outline'"
        size="xs"
        :class="TAKE"
        @click="emit('pick', 'ours')"
      >
        {{ t('git.conflict.takeOurs') }}
      </Button>
      <Button
        :variant="choice === 'theirs' ? 'default' : 'outline'"
        size="xs"
        :class="TAKE"
        @click="emit('pick', 'theirs')"
      >
        {{ t('git.conflict.takeTheirs') }}
      </Button>
    </div>
    <div class="grid grid-cols-2 divide-x">
      <div class="min-w-0" :class="{ 'bg-primary/15': choice === 'ours' }">
        <div :class="PANE_HD">{{ oursLabel || t('git.conflict.ours') }}</div>
        <!-- mono-ok: nội dung code xung đột -->
        <div v-if="oursRows.length" class="overflow-x-auto py-1 font-mono text-sm">
          <GitDiffLine v-for="(l, i) in oursRows" :key="`o${i}`" :line="l" />
        </div>
        <div v-else class="px-2.5 py-2 text-faint italic">{{ t('git.conflict.emptySide') }}</div>
      </div>
      <div class="min-w-0" :class="{ 'bg-primary/15': choice === 'theirs' }">
        <div :class="PANE_HD">{{ theirsLabel || t('git.conflict.theirs') }}</div>
        <!-- mono-ok: nội dung code xung đột -->
        <div v-if="theirsRows.length" class="overflow-x-auto py-1 font-mono text-sm">
          <GitDiffLine v-for="(l, i) in theirsRows" :key="`t${i}`" :line="l" />
        </div>
        <div v-else class="px-2.5 py-2 text-faint italic">{{ t('git.conflict.emptySide') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One conflict block — a title row with per-block Take ours / Take theirs, plus two
// read-only panes (OURS as deletions, THEIRS as additions) rendered through the
// shared GitDiffLine so add/del theming is reused. An empty side shows the
// emptySide placeholder (add/add or delete/modify blocks). Không hex: trạng thái đã
// chọn dùng màu primary, còn lại viền border mặc định.
import type { DiffRow } from './git-types'
import Button from '~/components/ui/button/Button.vue'
import { toDiffLines } from '~/composables/useConflictResolver'

const props = defineProps<{
  index: number
  total: number
  line: number
  ours: string[]
  theirs: string[]
  oursLabel: string
  theirsLabel: string
  choice: 'ours' | 'theirs' | undefined
}>()

const emit = defineEmits<{ (e: 'pick', choice: 'ours' | 'theirs'): void }>()

const { t } = useI18n()

// One plain token carrying the whole line — mirrors GitDiffViewer's `plain`.
const toRows = (lines: string[], kind: 'ours' | 'theirs'): DiffRow[] =>
  toDiffLines(lines, kind).map((l) => ({
    cls: l.t === '+' ? 'add' : 'del',
    n: l.n ?? '',
    tokens: [{ text: l.s, cls: '' as const }],
  }))

const TAKE = 'h-auto rounded-sm px-2.5 py-0.5 font-normal'
const PANE_HD = 'truncate border-b bg-muted px-2.5 py-1 text-sm text-muted-foreground'

const oursRows = computed(() => toRows(props.ours, 'ours'))
const theirsRows = computed(() => toRows(props.theirs, 'theirs'))
</script>
