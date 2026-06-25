<template>
  <div
    v-if="!run.output"
    class="text-[1em] py-6 text-center inline-flex items-center justify-center gap-2 w-full"
    :style="{ color: t.textDim }"
  >
    <Activity :size="12" class="animate-pulse" />
    Generating output...
  </div>
  <div v-else>
    <div class="flex items-center gap-2 mb-2 text-[1em]" :style="{ color: t.textDim }">
      <FileText :size="11" />
      <span class="font-mono truncate">{{ node.outputs.join(', ') }}</span>
      <template v-if="run.approvedBy">
        <span :style="{ color: t.textFaint }">·</span>
        <span class="truncate">Approved by {{ run.approvedBy }} {{ run.approvedAt }}</span>
      </template>
      <button
        v-if="isEditable"
        class="ml-auto flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-[1em] rounded-lg transition"
        :style="{
          color: t.text,
          border: `1px solid ${t.border}`,
          background: openHover ? t.bgHover : 'transparent',
        }"
        @click="emit('open-file', fileName, displayContent)"
        @mouseenter="openHover = true"
        @mouseleave="openHover = false"
      >
        <Code2 :size="10" />
        Open in editor
      </button>
    </div>
    <div
      v-if="isMarkdown"
      class="rounded-xl p-4"
      :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
    >
      <MarkdownRenderer :content="displayContent" />
    </div>
    <pre
      v-else
      class="text-[1em] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded-xl"
      :style="{
        color: t.textMuted,
        background: t.bgInput,
        border: `1px solid ${t.border}`,
        margin: 0,
      }"
      >{{ displayContent }}</pre
    >
  </div>
</template>

<script setup lang="ts">
import { Activity, FileText, Code2 } from 'lucide-vue-next'
import type { Run, Phase, WorkflowNode } from '~/types'
import { mockArtifactContent } from '~/utils/mock-output'

const props = defineProps<{
  run: Run
  node: WorkflowNode
  phase: Phase
}>()

const emit = defineEmits<{
  'open-file': [fileName: string, content: string]
}>()

const { t } = useTheme()

const openHover = ref(false)

const fileName = computed(() => props.node.outputs[0] || '')
const isEditable = computed(() => {
  const n = fileName.value
  return (
    n.endsWith('.md') ||
    n.endsWith('.diff') ||
    n.endsWith('.patch') ||
    n.endsWith('.yaml') ||
    n.endsWith('.yml')
  )
})

// Live path: run.output is the artifact body the engine streamed + persisted.
// Fall back to mock content only when output is empty (browser-dev seed tasks).
const displayContent = computed(
  () => props.run.output || mockArtifactContent(props.phase.skillName, fileName.value),
)
const isMarkdown = computed(() => fileName.value.endsWith('.md'))
</script>
