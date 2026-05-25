<template>
  <div class="h-screen w-full flex flex-col overflow-hidden" :style="rootStyle">
    <!-- Top toolbar -->
    <div
      class="min-h-10 flex flex-wrap items-center px-3 gap-2 py-1 flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <button
        class="flex items-center gap-1.5 px-2 py-1 text-xs rounded transition"
        :style="{
          color: backHover ? t.text : t.textMuted,
          background: backHover ? t.bgHover : 'transparent',
        }"
        @mouseenter="backHover = true"
        @mouseleave="backHover = false"
        @click="onBack"
      >
        <ArrowLeft :size="12" />
        Back to task
      </button>
      <div class="w-px h-4" :style="{ background: t.border }" />
      <GitBranch v-if="currentFileKind === 'diff'" :size="12" :style="{ color: t.textDim }" />
      <FileCode v-else :size="12" :style="{ color: t.textDim }" />
      <span class="text-xs font-mono" :style="{ color: t.text }">{{ fileName }}</span>
      <span class="text-[10px]" :style="{ color: t.textFaint }">· {{ task?.id }}</span>

      <div v-if="diffStats" class="flex items-center gap-2 ml-2 text-[10px] font-mono">
        <span :style="{ color: t.textDim }">
          {{ diffStats.files }} {{ diffStats.files === 1 ? 'file' : 'files' }}
        </span>
        <span :style="{ color: '#86efac' }">+{{ diffStats.additions }}</span>
        <span :style="{ color: '#fca5a5' }">−{{ diffStats.deletions }}</span>
      </div>

      <div class="ml-auto flex items-center gap-1">
        <div
          v-if="currentFileKind !== 'diff'"
          class="flex rounded overflow-hidden"
          :style="{ border: `1px solid ${t.border}` }"
        >
          <button
            v-for="v in viewOptions"
            :key="v.id"
            class="px-2 py-1 text-[11px] flex items-center gap-1 transition"
            :style="{
              background: activeView === v.id ? t.bgActive : 'transparent',
              color: activeView === v.id ? t.text : t.textDim,
            }"
            @click="activeView = v.id"
          >
            <component :is="v.icon" :size="11" />
            {{ v.label }}
          </button>
        </div>
        <button
          class="p-1.5 rounded transition"
          :style="{
            color: copyHover ? t.text : t.textDim,
            background: copyHover ? t.bgHover : 'transparent',
          }"
          title="Copy"
          @mouseenter="copyHover = true"
          @mouseleave="copyHover = false"
          @click="onCopy"
        >
          <Copy :size="12" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{
            color: dlHover ? t.text : t.textDim,
            background: dlHover ? t.bgHover : 'transparent',
          }"
          title="Download"
          @mouseenter="dlHover = true"
          @mouseleave="dlHover = false"
        >
          <Download :size="12" />
        </button>
      </div>
    </div>

    <!-- Main content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- File tree sidebar -->
      <div
        class="flex-shrink-0 flex flex-col w-full md:w-56"
        :class="{ 'hidden md:flex': mobilePane === 'editor' }"
        :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
      >
        <div
          class="px-3 py-2 text-[11px] uppercase tracking-wider font-medium"
          :style="{ color: t.textDim, borderBottom: `1px solid ${t.border}` }"
        >
          Files in {{ task?.id }}
        </div>
        <div class="flex-1 overflow-y-auto py-1">
          <button
            v-for="(f, i) in taskFiles"
            :key="i"
            class="w-full px-3 py-1.5 flex items-center gap-2 text-left transition"
            :style="{
              background:
                f.fileName === fileName ? t.bgActive : hoverIdx === i ? t.bgHover : 'transparent',
              borderLeft: `2px solid ${f.fileName === fileName ? t.accent : 'transparent'}`,
            }"
            @mouseenter="hoverIdx = i"
            @mouseleave="hoverIdx = -1"
            @click="onOpenFile(f.fileName)"
          >
            <GitBranch v-if="f.kind === 'diff'" :size="11" :style="{ color: t.textDim }" />
            <FileCode v-else :size="11" :style="{ color: t.textDim }" />
            <div class="flex-1 min-w-0">
              <div class="text-[11px] font-mono truncate" :style="{ color: t.text }">
                {{ f.fileName }}
              </div>
              <div class="text-[9px] truncate" :style="{ color: t.textFaint }">
                {{ f.phase }} · v{{ f.version }}
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Editor area -->
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
          <div
            v-if="currentFileKind === 'diff'"
            class="flex-1 overflow-auto"
            :style="{ background: t.bg }"
          >
            <DiffViewer :content="content" />
          </div>

          <template v-else>
            <div
              v-if="effectiveView === 'code' || effectiveView === 'split'"
              class="flex flex-col overflow-hidden"
              :class="effectiveView === 'split' ? 'w-full md:w-1/2' : 'flex-1'"
              :style="{ borderRight: effectiveView === 'split' ? `1px solid ${t.border}` : 'none' }"
            >
              <div class="flex-1 overflow-auto" :style="{ background: t.bg }">
                <div
                  class="flex font-mono text-[12.5px] leading-[1.6]"
                  :style="{ minHeight: '100%' }"
                >
                  <div
                    class="select-none text-right pr-3 pl-3 py-3 flex-shrink-0"
                    :style="{
                      color: t.textFaint,
                      background: t.bgPanel,
                      borderRight: `1px solid ${t.border}`,
                    }"
                  >
                    <div v-for="n in lineCount" :key="n" :style="{ minHeight: '1.6em' }">
                      {{ n }}
                    </div>
                  </div>
                  <textarea
                    v-model="content"
                    spellcheck="false"
                    class="flex-1 px-3 py-3 outline-none resize-none"
                    :style="{
                      background: 'transparent',
                      color: t.text,
                      fontFamily: 'inherit',
                      fontSize: 'inherit',
                      lineHeight: 'inherit',
                      border: 'none',
                      minHeight: `${lineCount * 1.6}em`,
                      caretColor: t.text,
                    }"
                  />
                </div>
              </div>
            </div>

            <div
              v-if="effectiveView === 'preview' || effectiveView === 'split'"
              class="flex flex-col overflow-hidden"
              :class="effectiveView === 'split' ? 'hidden md:flex w-1/2' : 'flex-1'"
              :style="{ background: t.bgSubtle }"
            >
              <div class="flex-1 overflow-auto">
                <div class="max-w-3xl mx-auto px-4 md:px-8 py-6">
                  <MarkdownRenderer :content="content" />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div
      class="h-6 flex items-center px-3 gap-4 text-[10px] font-mono flex-shrink-0"
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
import {
  ArrowLeft,
  ChevronLeft,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  GitBranch,
  PanelLeftOpen,
} from 'lucide-vue-next'
import { mockArtifactContent } from '~/utils/mock-output'

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

interface TaskFile {
  fileName: string
  content: string
  phase: string
  version: number
  kind: 'md' | 'diff' | 'yaml'
}

const taskFiles = computed<TaskFile[]>(() => {
  const files: TaskFile[] = []
  if (!task.value || !workflow.value) return files
  Object.values(task.value.phases).forEach((phase) => {
    phase.runs.forEach((run) => {
      if (run.status === 'superseded') return
      const node = workflow.value!.nodes.find((n) => n.id === phase.nodeId)
      if (!node) return
      node.outputs.forEach((out) => {
        const fileContent = mockArtifactContent(phase.skillName, out)
        if (!fileContent) return
        if (out.endsWith('.md')) {
          files.push({
            fileName: out,
            content: fileContent,
            phase: phase.skillName,
            version: run.version,
            kind: 'md',
          })
        } else if (out.endsWith('.diff') || out.endsWith('.patch')) {
          files.push({
            fileName: out,
            content: fileContent,
            phase: phase.skillName,
            version: run.version,
            kind: 'diff',
          })
        } else if (out.endsWith('.yaml') || out.endsWith('.yml')) {
          files.push({
            fileName: out,
            content: fileContent,
            phase: phase.skillName,
            version: run.version,
            kind: 'yaml',
          })
        }
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

const activeView = ref<'code' | 'split' | 'preview'>('split')

const viewOptions = [
  { id: 'code' as const, label: 'Code', icon: Code2 },
  { id: 'split' as const, label: 'Split', icon: PanelLeftOpen },
  { id: 'preview' as const, label: 'Preview', icon: Eye },
]

const currentFileKind = computed<'diff' | 'yaml' | 'md'>(() => {
  if (fileName.value.endsWith('.diff') || fileName.value.endsWith('.patch')) return 'diff'
  if (fileName.value.endsWith('.yaml') || fileName.value.endsWith('.yml')) return 'yaml'
  return 'md'
})

const effectiveView = computed(() => (currentFileKind.value === 'diff' ? 'code' : activeView.value))

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

const backHover = ref(false)
const copyHover = ref(false)
const dlHover = ref(false)
const hoverIdx = ref(-1)
const mobilePane = ref<'tree' | 'editor'>(fileName.value ? 'editor' : 'tree')

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
</script>
