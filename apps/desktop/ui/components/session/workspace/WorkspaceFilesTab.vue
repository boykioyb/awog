<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.tab.files')" :icon="FolderTree" @close="close">
      <template #actions>
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

    <!-- Tree -->
    <div class="flex-shrink-0 overflow-y-auto py-1" :style="{ maxHeight: '50%' }">
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

    <!-- File preview -->
    <div
      class="flex-1 overflow-hidden flex flex-col"
      :style="{ borderTop: `1px solid ${t.border}` }"
    >
      <div v-if="!selectedPath" class="flex-1 flex items-center justify-center px-6 text-center">
        <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.files.select') }}</p>
      </div>
      <template v-else>
        <div
          class="px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
          :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgSubtle }"
        >
          <FileText :size="11" :style="{ color: t.textDim }" />
          <span class="font-mono text-[1em] truncate" :style="{ color: t.text }">
            {{ selectedPath }}
          </span>
          <span
            v-if="fileContent?.language"
            class="ml-auto text-[12px] uppercase tracking-wider"
            :style="{ color: t.textDim }"
          >
            {{ fileContent.language }}
          </span>
        </div>
        <div
          v-if="fileContent?.isBinary"
          class="flex-1 flex items-center justify-center px-6 text-center text-[1em]"
          :style="{ color: t.textDim }"
        >
          {{ tr('workspace.files.binary') }}
        </div>
        <div
          v-else
          ref="previewRef"
          class="flex-1 overflow-auto font-mono text-[1em] leading-[1.6] py-1"
        >
          <div
            v-for="(ln, i) in lines"
            :key="i"
            :data-line="i + 1"
            class="flex"
            :style="i + 1 === targetLine ? { background: t.bgActive } : undefined"
          >
            <span
              class="select-none text-right pr-3 pl-3 flex-shrink-0"
              :style="{ color: t.textFaint, minWidth: '3.5em' }"
            >
              {{ i + 1 }}
            </span>
            <span class="whitespace-pre flex-1 pr-3" :style="{ color: t.text }">
              {{ ln === '' ? ' ' : ln }}
            </span>
          </div>
          <div v-if="fileContent?.truncated" class="px-3 py-1" :style="{ color: t.textFaint }">
            {{ tr('workspace.files.truncated') }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileText, FolderTree, RefreshCw } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { FsEntry, FsFileContent, Session } from '~/types'
import { useFsApi } from '~/composables/useFsApi'
import { SidecarUnavailableError } from '~/composables/useSidecar'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'
import WorkspaceFileTreeNode from './WorkspaceFileTreeNode.vue'

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

// Line-by-line render so we can scroll to + highlight a target line when the
// user clicks a `path#Lnn` reference in the chat.
const previewRef = ref<HTMLElement | null>(null)
const targetLine = ref<number | null>(null)
const lines = computed(() => (fileContent.value?.content ?? '').split('\n'))

const scrollToLine = (line: number) => {
  const el = previewRef.value?.querySelector<HTMLElement>(`[data-line="${line}"]`)
  el?.scrollIntoView({ block: 'center' })
}

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

const select = async (entry: FsEntry) => {
  selectedPath.value = entry.path
  fileContent.value = null
  targetLine.value = null
  try {
    fileContent.value = await api.readFile(props.workspaceRoot, entry.path)
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    fileContent.value = { path: entry.path, content: '', truncated: false, isBinary: false }
  }
}

// Open a workspace-relative path directly (bypasses the tree) and jump to a
// line — driven by chat link clicks via the workspacePanel store.
const openAtPath = async (path: string, line: number | null) => {
  selectedPath.value = path
  fileContent.value = null
  targetLine.value = null
  try {
    fileContent.value = await api.readFile(props.workspaceRoot, path)
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    fileContent.value = { path, content: '', truncated: false, isBinary: false }
    return
  }
  if (line && !fileContent.value.isBinary) {
    targetLine.value = line
    await nextTick()
    scrollToLine(line)
  }
}

watch(
  () => panel.pendingFileOpen(props.session.id),
  (req) => {
    // openAtPath swallows its own errors; .catch keeps the promise non-floating.
    if (req) openAtPath(req.path, req.line).catch(() => {})
  },
  { immediate: true },
)

const refresh = async () => {
  if (loading.value) return
  loading.value = true
  // Reset to a clean root — collapsing keeps the tree honest after external
  // changes (no project-wide watcher yet; manual refresh is the MVP contract).
  childrenByPath.value = {}
  expanded.value = {}
  selectedPath.value = null
  fileContent.value = null
  targetLine.value = null
  try {
    await loadDir('')
  } finally {
    loading.value = false
  }
}

watch(() => props.workspaceRoot, refresh)
onMounted(refresh)
</script>
