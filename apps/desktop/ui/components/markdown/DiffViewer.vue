<template>
  <div class="font-mono text-[1em] leading-[1.55]">
    <div v-for="(row, i) in rows" :key="i" class="flex" :style="{ background: row.bg }">
      <div
        class="select-none text-right pr-3 pl-3 flex-shrink-0"
        :style="{ color: t.textFaint, width: '56px', borderRight: `1px solid ${t.border}` }"
      >
        {{ row.isMeta ? '' : i + 1 }}
      </div>
      <div
        class="pl-3 pr-3 flex-1 min-w-0"
        :style="{
          color: row.color,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }"
      >
        {{ row.line || ' ' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ content: string }>()
const { t } = useTheme()

interface Row {
  line: string
  bg: string
  color: string
  isMeta: boolean
}

const rows = computed<Row[]>(() => {
  const lines = props.content.split('\n')
  return lines.map((line) => {
    let bg = 'transparent'
    let color = t.value.text
    let isMeta = false

    if (line.startsWith('diff --git')) {
      bg = t.value.bgInput
      color = t.value.text
      isMeta = true
    } else if (
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      color = t.value.textDim
      isMeta = true
    } else if (line.startsWith('@@')) {
      bg = t.value.infoBg
      color = t.value.info
      isMeta = true
    } else if (line.startsWith('+')) {
      // Row tint signals the change; text stays the readable foreground
      // (black on light / white on dark) instead of low-contrast green-on-green.
      bg = 'rgba(34, 197, 94, 0.08)'
      color = t.value.text
    } else if (line.startsWith('-')) {
      bg = 'rgba(239, 68, 68, 0.08)'
      color = t.value.text
    } else {
      color = t.value.textMuted
    }

    return { line, bg, color, isMeta }
  })
})
</script>
