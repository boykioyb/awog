<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.files')" :icon="FolderTree" @close="close">
      <template #actions>
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{
            color: showTree ? t.accent : t.textDim,
            background: showTree ? t.bgActive : 'transparent',
          }"
          :title="tr('workspace.files.toggleTree')"
          @click="showTree = !showTree"
        >
          <ListTree :size="13" />
        </button>
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('workspace.refresh')"
          @click="refresh"
        >
          <RefreshCw :size="13" :class="{ 'animate-spin': loading }" />
        </button>
      </template>
    </WorkspaceDrawerHeader>

    <!-- Content: preview fills the panel; the tree is a toggle-able overlay. -->
    <div class="flex-1 relative overflow-hidden">
      <!-- Preview layer (shared Monaco editor, read-only) -->
      <div class="absolute inset-0 flex flex-col">
        <button
          v-if="!selectedPath"
          type="button"
          class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center transition"
          :style="{ color: t.textDim }"
          @click="showTree = true"
        >
          <FolderTree :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
          <span class="text-[1em]">{{ tr('workspace.files.browse') }}</span>
        </button>
        <template v-else>
          <div
            class="px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
            :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
          >
            <FileText :size="11" :style="{ color: t.textDim }" />
            <span class="font-mono text-[1em] truncate" :style="{ color: t.text }">
              {{ selectedPath }}
            </span>
            <button
              type="button"
              class="p-1 rounded transition flex-shrink-0"
              :style="{ color: copied ? t.success : t.textDim }"
              :title="copied ? tr('workspace.files.pathCopied') : tr('workspace.files.copyPath')"
              @click="copyPath"
            >
              <Check v-if="copied" :size="13" />
              <Copy v-else :size="13" />
            </button>
            <span v-if="fileContent?.truncated" class="text-[12px]" :style="{ color: t.warning }">
              {{ tr('workspace.files.truncated') }}
            </span>
            <span
              v-if="fileContent?.language"
              class="ml-auto text-[12px] uppercase tracking-wider"
              :style="{ color: t.textDim }"
            >
              {{ fileContent.language }}
            </span>
            <button
              v-if="session.projectId"
              type="button"
              class="p-1 rounded transition"
              :class="{ 'ml-auto': !fileContent?.language }"
              :style="{ color: t.textDim }"
              :title="tr('workspace.files.openInEditor')"
              @click="openInEditor"
            >
              <Code2 :size="13" />
            </button>
          </div>
          <div
            v-if="fileContent?.isBinary"
            class="flex-1 flex items-center justify-center px-6 text-center text-[1em]"
            :style="{ color: t.textDim }"
          >
            {{ tr('workspace.files.binary') }}
          </div>
          <MonacoEditor
            v-else
            ref="editorRef"
            class="flex-1 min-h-0"
            :path="selectedPath"
            :read-only="true"
            @ready="onEditorReady"
          />
        </template>
      </div>

      <!-- Tree overlay (hidden by default; toggle via the header icon) -->
      <div
        v-if="showTree"
        class="absolute inset-0 z-10 flex flex-col"
        :style="{ background: t.bg }"
      >
        <div
          class="px-3 py-1.5 flex items-center justify-between flex-shrink-0"
          :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
        >
          <span class="text-[1em] uppercase tracking-wide" :style="{ color: t.textDim }">
            {{ tr('workspace.tab.files') }}
          </span>
          <button
            type="button"
            class="p-1 rounded transition"
            :style="{ color: t.textDim }"
            :title="tr('workspace.close')"
            @click="showTree = false"
          >
            <X :size="13" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto py-1">
          <WorkspaceFileTreeNode
            v-for="entry in childrenByPath[''] ?? []"
            :key="entry.path"
            :entry="entry"
            :depth="0"
            :expanded="expanded"
            :children-by-path="childrenByPath"
            :selected-path="selectedPath"
            :on-toggle="toggle"
            :on-select="select"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, Code2, Copy, FileText, FolderTree, ListTree, RefreshCw, X } from 'lucide-vue-next'
import { onMounted, ref, watch } from 'vue'
import type { FsEntry, FsFileContent, Session } from '~/types'
import { useFsApi } from '~/composables/useFsApi'
import { SidecarUnavailableError } from '~/composables/useSidecar'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import MonacoEditor from '~/components/editor/MonacoEditor.vue'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'
import WorkspaceFileTreeNode from './WorkspaceFileTreeNode.vue'

// Minimal slice of <MonacoEditor>'s defineExpose used here.
interface EditorExposed {
  openFile: (path: string, content: string, language?: string) => void
  revealRange: (path: string, startLine: number, endLine: number) => void
  focus: () => void
}

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const api = useFsApi()
const panel = useWorkspacePanelStore()

const close = () => panel.closeDrawer(props.session.id)

// '' key = workspace root. Lazy: a directory's children load on first expand.
const childrenByPath = ref<Record<string, FsEntry[]>>({})
const expanded = ref<Record<string, boolean>>({})
const selectedPath = ref<string | null>(null)
const fileContent = ref<FsFileContent | null>(null)
const loading = ref(false)
// Tree is an overlay, hidden by default — toggled from the header icon. Picking
// a file collapses it so the preview shows immediately at full size.
const showTree = ref(false)

// Read-only Monaco surface, shared with the Project Code Workspace. We open one
// file at a time imperatively; pending state covers the gap before Monaco mounts.
const editorRef = ref<EditorExposed | null>(null)
const pendingRange = ref<{ start: number; end: number } | null>(null)

const pushToEditor = () => {
  const ed = editorRef.value
  const fc = fileContent.value
  const path = selectedPath.value
  if (!ed || !fc || !path || fc.isBinary) return
  ed.openFile(path, fc.content, fc.language)
  if (pendingRange.value) {
    ed.revealRange(path, pendingRange.value.start, pendingRange.value.end)
    pendingRange.value = null
  }
}

const onEditorReady = () => pushToEditor()

const loadDir = async (path: string) => {
  try {
    const result = await api.listDir(props.workspaceRoot, path || undefined)
    childrenByPath.value = { ...childrenByPath.value, [path]: result.entries }
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    childrenByPath.value = { ...childrenByPath.value, [path]: [] }
  }
}

const toggle = async (path: string) => {
  if (expanded.value[path]) {
    expanded.value = { ...expanded.value, [path]: false }
    return
  }
  if (!childrenByPath.value[path]) await loadDir(path)
  expanded.value = { ...expanded.value, [path]: true }
}

const loadInto = async (path: string, line: number | null, endLine: number | null) => {
  selectedPath.value = path
  fileContent.value = null
  pendingRange.value = line != null ? { start: line, end: endLine ?? line } : null
  try {
    fileContent.value = await api.readFile(props.workspaceRoot, path)
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    fileContent.value = { path, content: '', truncated: false, isBinary: false }
    return
  }
  pushToEditor()
}

const select = (entry: FsEntry) => {
  showTree.value = false // collapse overlay → preview shows full-size immediately
  loadInto(entry.path, null, null).catch(() => {})
}

const openInEditor = () => {
  if (props.session.projectId && selectedPath.value) {
    navigateTo(
      `/projects/${props.session.projectId}/code?file=${encodeURIComponent(selectedPath.value)}`,
    )
  }
}

// Copy the workspace-relative path with a brief confirmation (matches the chat
// copy-button pattern).
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copyPath = async () => {
  if (!selectedPath.value) return
  try {
    await navigator.clipboard.writeText(selectedPath.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // clipboard may be denied in restricted contexts — ignore
  }
}

// Chat link `path#Lnn` → open + jump, driven by the workspacePanel store.
watch(
  () => panel.pendingFileOpen(props.session.id),
  (req) => {
    if (req) loadInto(req.path, req.line, req.endLine).catch(() => {})
  },
  { immediate: true },
)

// Load (or reload) the root tree without touching the current selection.
const loadRoot = async () => {
  if (loading.value) return
  loading.value = true
  try {
    await loadDir('')
  } finally {
    loading.value = false
  }
}

// Full reset — used by the refresh button and on workspaceRoot change. NOT on
// initial mount: a chat-link `requestOpenFile` fires the immediate
// `pendingFileOpen` watch during setup, and resetting here would wipe the file
// the user just clicked (the old "click twice" bug).
const refresh = async () => {
  childrenByPath.value = {}
  expanded.value = {}
  selectedPath.value = null
  fileContent.value = null
  pendingRange.value = null
  await loadRoot()
}

watch(() => props.workspaceRoot, refresh)
onMounted(loadRoot)
</script>
