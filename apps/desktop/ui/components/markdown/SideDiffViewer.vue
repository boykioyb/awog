<template>
  <div class="font-mono text-[1em] leading-[1.55]">
    <div
      v-for="(group, gi) in parsed.groups"
      :key="gi"
      :style="{ borderTop: gi > 0 ? `1px solid ${t.border}` : 'none' }"
    >
      <div
        class="px-3 py-1"
        :style="{ background: t.infoBg, color: t.info, borderBottom: `1px solid ${t.border}` }"
      >
        {{ group.header }}
      </div>
      <div class="grid" :style="{ gridTemplateColumns: '1fr 1fr' }">
        <template v-for="(row, ri) in group.rows" :key="`${gi}-${ri}`">
          <div
            class="flex"
            :style="{
              background: bgFor(row.left.kind),
              borderRight: `1px solid ${t.border}`,
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
              {{ row.left.lineNo ?? '' }}
            </div>
            <div
              class="px-2 flex-1 min-w-0"
              :style="{
                color: colorFor(row.left.kind),
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }"
            >
              <template v-if="row.left.kind !== 'empty'">
                {{ prefixFor(row.left.kind) + row.left.content || ' ' }}
              </template>
            </div>
          </div>
          <div class="flex" :style="{ background: bgFor(row.right.kind) }">
            <div
              class="select-none text-right pr-2 pl-2 flex-shrink-0"
              :style="{
                color: t.textFaint,
                width: '40px',
                borderRight: `1px solid ${t.border}`,
              }"
            >
              {{ row.right.lineNo ?? '' }}
            </div>
            <div
              class="px-2 flex-1 min-w-0"
              :style="{
                color: colorFor(row.right.kind),
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }"
            >
              <template v-if="row.right.kind !== 'empty'">
                {{ prefixFor(row.right.kind) + row.right.content || ' ' }}
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { buildSideDiff, type DiffLineKind } from '~/utils/diff-parse'

const props = defineProps<{ content: string }>()
const { t } = useTheme()

const parsed = computed(() => buildSideDiff(props.content))

const bgFor = (kind: DiffLineKind) => {
  if (kind === 'add') return 'rgba(34, 197, 94, 0.10)'
  if (kind === 'del') return 'rgba(239, 68, 68, 0.10)'
  if (kind === 'empty') return t.value.bgSubtle
  return 'transparent'
}

const colorFor = (kind: DiffLineKind) => {
  if (kind === 'add') return '#86efac'
  if (kind === 'del') return '#fca5a5'
  return t.value.textMuted
}

const prefixFor = (kind: DiffLineKind) => {
  if (kind === 'add') return '+ '
  if (kind === 'del') return '- '
  return '  '
}
</script>
