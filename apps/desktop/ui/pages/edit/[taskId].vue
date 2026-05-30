<!--
  NOTE: Page này KHÔNG migrate sang `MasterDetailShell` (PR-2). Lý do: top toolbar đặc thù +
  3-mode editor (code/split/preview) + file tree (không phải list rows). Đã tách 4 subcomponent
  ở PR-5 §5.G: `EditorTopBar`, `EditorFileTree`, `EditorMonacoPane`, `EditorViewerPane`.
  Tham chiếu: docs/decisions/0009a-ui-consolidation-clarifications.md §4.
-->
<template>
  <div class="h-screen w-full flex flex-col overflow-hidden" :style="rootStyle">
    <EditorTopBar
      :file-name="fileName"
      :task-id="task?.id ?? ''"
      :file-kind="currentFileKind"
      :active-view="activeView"
      :diff-stats="diffStats"
      @back="onBack"
      @change-view="onChangeView"
      @copy="onCopy"
      @download="onDownload"
    />

    <div class="flex flex-1 overflow-hidden">
      <EditorFileTree
        :files="taskFiles"
        :task-id="task?.id ?? ''"
        :selected-file-name="fileName"
        :hidden-on-mobile="mobilePane === 'editor'"
        @select-file="onOpenFile"
      />

      <div
        class="flex-1 flex flex-col overflow-hidden"
        :class="{ 'hidden md:flex': mobilePane === 'tree' }"
      >
        <button
          class="md:hidden flex items-center gap-1 px-3 py-2 text-xs transition flex-shrink-0"
          :style="{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }"
          @click="mobilePane = 'tree'"
        >
          <ChevronLeft :size="14" />
          Files
        </button>
        <div class="flex flex-1 overflow-hidden">
          <EditorViewerPane
            v-if="currentFileKind === 'diff'"
            :content="content"
            mode="diff"
            :is-split="false"
          />
          <template v-else>
            <EditorMonacoPane
              v-if="effectiveView === 'code' || effectiveView === 'split'"
              v-model="content"
              :is-split="effectiveView === 'split'"
            />
            <EditorViewerPane
              v-if="effectiveView === 'preview' || effectiveView === 'split'"
              :content="content"
              mode="preview"
              :is-split="effectiveView === 'split'"
            />
          </template>
        </div>
      </div>
    </div>

    <div
      class="h-6 flex items-center px-3 gap-4 text-[0.71em] font-mono flex-shrink-0"
      :style="{ borderTop: `1px solid ${t.border}`, background: t.bgPanel, color: t.textDim }"
    >
      <span>{{ languageLabel }}</span>
      <span>UTF-8</span>
      <span>LF</span>
      <div class="ml-auto flex items-center gap-4">
        <span>{{ lineCount }} lines</span>
        <span>{{ wordCount }} words</span>
        <span>{{ charCount }} chars</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { mockArtifactContent } from '~/utils/mock-output'
import type { EditorFileKind, EditorTaskFile, EditorViewMode } from '~/types'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const { t } = useTheme()
const workspace = useWorkspaceStore()

const rootStyle = computed(() => ({
  background: t.value.bg,
  color: t.value.text,
  fontFamily: 'var(--font-sans)',
}))

const taskId = computed(() => String(route.params.taskId))
const fileName = computed(() => String(route.query.file || ''))

const task = computed(() => workspace.taskById(taskId.value))
const workflow = computed(() =>
  task.value ? workspace.workflowById(task.value.workflowId) : undefined,
)

function resolveKind(out: string): EditorFileKind | null {
  if (out.endsWith('.md')) return 'md'
  if (out.endsWith('.diff') || out.endsWith('.patch')) return 'diff'
  if (out.endsWith('.yaml') || out.endsWith('.yml')) return 'yaml'
  return null
}

const taskFiles = computed<EditorTaskFile[]>(() => {
  const files: EditorTaskFile[] = []
  if (!task.value || !workflow.value) return files
  Object.values(task.value.phases).forEach((phase) => {
    phase.runs.forEach((run) => {
      if (run.status === 'superseded') return
      const node = workflow.value!.nodes.find((n) => n.id === phase.nodeId)
      if (!node) return
      node.outputs.forEach((out) => {
        const fileContent = mockArtifactContent(phase.skillName, out)
        if (!fileContent) return
        const kind = resolveKind(out)
        if (!kind) return
        files.push({
          fileName: out,
          content: fileContent,
          phase: phase.skillName,
          version: run.version,
          kind,
        })
      })
    })
  })
  return files
})

const initialContent = computed(() => {
  const f = taskFiles.value.find((x) => x.fileName === fileName.value)
  return f?.content ?? ''
})

const content = ref<string>(initialContent.value)
watch(initialContent, (v) => {
  content.value = v
})

const activeView = ref<EditorViewMode>('split')

const currentFileKind = computed<EditorFileKind>(() => {
  if (fileName.value.endsWith('.diff') || fileName.value.endsWith('.patch')) return 'diff'
  if (fileName.value.endsWith('.yaml') || fileName.value.endsWith('.yml')) return 'yaml'
  return 'md'
})

const effectiveView = computed<EditorViewMode>(() =>
  currentFileKind.value === 'diff' ? 'code' : activeView.value,
)

const lineCount = computed(() => content.value.split('\n').length)
const charCount = computed(() => content.value.length)
const wordCount = computed(() => content.value.trim().split(/\s+/).filter(Boolean).length)

const diffStats = computed(() => {
  if (currentFileKind.value !== 'diff') return null
  const additions = (content.value.match(/^\+[^+]/gm) || []).length
  const deletions = (content.value.match(/^-[^-]/gm) || []).length
  const files = (content.value.match(/^diff --git/gm) || []).length
  return { additions, deletions, files }
})

const languageLabel = computed(() => {
  if (currentFileKind.value === 'diff') return 'Diff'
  if (currentFileKind.value === 'yaml') return 'YAML'
  return 'Markdown'
})

const mobilePane = ref<'tree' | 'editor'>(fileName.value ? 'editor' : 'tree')

function onChangeView(v: EditorViewMode) {
  activeView.value = v
}

function onBack() {
  router.push(`/tasks/${taskId.value}`)
}

function onOpenFile(name: string) {
  router.replace({
    path: route.path,
    query: { ...route.query, file: name },
  })
  mobilePane.value = 'editor'
}

function onCopy() {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(content.value).catch(() => {})
  }
}

function onDownload() {
  // Placeholder — actual download wiring deferred until engine integration.
}
</script>
