<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader :title="tr('workspace.diff.changes')" :icon="GitCompare" @close="close">
      <template #actions>
        <span
          v-if="files.length"
          class="font-mono leading-none text-[12px]"
          :style="{ color: t.textDim }"
        >
          ({{ files.length }})
        </span>
        <button
          type="button"
          class="p-1 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('workspace.refresh')"
          @click="load"
        >
          <RefreshCw :size="13" :class="{ 'animate-spin': loading }" />
        </button>
      </template>
    </WorkspaceDrawerHeader>

    <div v-if="noRepo" class="flex-1 flex items-center justify-center px-6 text-center">
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.diff.no_repo') }}</p>
    </div>

    <div v-else-if="!files.length" class="flex-1 flex items-center justify-center px-6 text-center">
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ tr('workspace.diff.none') }}</p>
    </div>

    <div v-else class="flex-1 flex flex-col overflow-hidden">
      <div class="flex-shrink-0 overflow-y-auto py-1" :style="{ maxHeight: '40%' }">
        <button
          v-for="f in files"
          :key="f.path"
          type="button"
          class="w-full text-left px-2 py-1 mx-1.5 rounded-lg flex items-center gap-2 transition"
          :style="{
            background: f.path === selectedPath ? t.bgActive : 'transparent',
            color: t.text,
            width: 'calc(100% - 0.75rem)',
          }"
          @click="selectFile(f.path)"
        >
          <span
            class="font-mono text-[12px] w-3.5 text-center flex-shrink-0 font-bold"
            :style="{ color: statusColor(f.changeType) }"
          >
            {{ statusLetter(f.changeType) }}
          </span>
          <span class="font-mono text-[1em] truncate" :style="{ color: t.textMuted }">
            {{ f.path }}
          </span>
          <span
            v-if="f.additions || f.deletions"
            class="ml-auto font-mono text-[12px] flex-shrink-0"
          >
            <span v-if="f.additions" :style="{ color: t.gitAdded }">+{{ f.additions }}</span>
            <span v-if="f.deletions" class="ml-1" :style="{ color: t.gitDeleted }">
              -{{ f.deletions }}
            </span>
          </span>
        </button>
      </div>

      <div class="flex-1 overflow-hidden" :style="{ borderTop: `1px solid ${t.border}` }">
        <GitDiffViewer :diff="currentDiff" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { GitCompare, RefreshCw } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GitFileDiff, Session, SessionStep } from '~/types'
import {
  useGitApi,
  type SidecarGitFileDiff,
  type SidecarGitFileStatus,
} from '~/composables/useGitApi'
import { SidecarError, SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const api = useGitApi()
const panel = useWorkspacePanelStore()

const close = () => panel.closeDrawer(props.session.id)

const allStatusFiles = ref<SidecarGitFileStatus[]>([])
const selectedPath = ref<string | null>(null)
const currentDiff = ref<GitFileDiff | null>(null)
const loading = ref(false)
const noRepo = ref(false)

// Workspace-relative path of a file the session itself wrote/edited. The agent
// passes absolute file_path in tool input (step.target); strip the workspace
// root. Returns null if the path falls outside the workspace.
const toRel = (target: string, root: string): string | null => {
  const p = target.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (p.startsWith(`${r}/`)) return p.slice(r.length + 1)
  if (p.startsWith('/')) return null
  return p // already relative
}

// Files this session touched (write/edit/save steps, including subagent steps).
const sessionPaths = computed<Set<string>>(() => {
  const out = new Set<string>()
  const visit = (steps: SessionStep[] | undefined) => {
    ;(steps ?? []).forEach((s) => {
      if ((s.tool === 'write' || s.tool === 'edit' || s.tool === 'save') && s.target) {
        const rel = toRel(s.target, props.workspaceRoot)
        if (rel) out.add(rel)
      }
      if (s.children) visit(s.children)
    })
  }
  props.session.messages.forEach((m) => visit(m.steps))
  return out
})

// git working-tree changes ∩ files this session touched.
const files = computed(() => allStatusFiles.value.filter((f) => sessionPaths.value.has(f.path)))

const STATUS_LETTERS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflicted: '!',
  type_changed: 'T',
  ignored: 'I',
}

const statusLetter = (changeType: string): string => STATUS_LETTERS[changeType] ?? 'M'

const statusColor = (changeType: string): string => {
  if (changeType === 'added' || changeType === 'untracked') return t.value.gitAdded
  if (changeType === 'deleted') return t.value.gitDeleted
  if (changeType === 'conflicted') return t.value.danger
  return t.value.statusWarn
}

const adaptDiff = (d: SidecarGitFileDiff): GitFileDiff => {
  const out: GitFileDiff = {
    path: d.path,
    isBinary: d.isBinary,
    hunks: d.hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      header: h.header,
      lines: h.lines.map((ln) => ({
        kind: ln.kind === 'noeol' ? ('context' as const) : ln.kind,
        text: ln.content,
      })),
    })),
  }
  if (d.oldPath !== undefined) out.oldPath = d.oldPath
  return out
}

const gitCodeOf = (err: unknown): string | null => {
  if (!(err instanceof SidecarError)) return null
  return (err.data as { gitCode?: string } | undefined)?.gitCode ?? null
}

const loadDiff = async (path: string) => {
  const file = allStatusFiles.value.find((f) => f.path === path)
  const kind = file?.stageState === 'staged' ? ('staged' as const) : ('workingTree' as const)
  try {
    const result = await api.diff({ kind, workspaceRoot: props.workspaceRoot, path })
    const first = result.files[0]
    currentDiff.value = first ? adaptDiff(first) : { path, isBinary: false, hunks: [] }
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    currentDiff.value = { path, isBinary: false, hunks: [] }
  }
}

const selectFile = (path: string) => {
  selectedPath.value = path
  loadDiff(path)
}

const load = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const result = await api.status(props.workspaceRoot)
    noRepo.value = false
    allStatusFiles.value = result.files
  } catch (err) {
    if (err instanceof SidecarUnavailableError) return
    if (gitCodeOf(err) === 'NO_REPO') {
      noRepo.value = true
      allStatusFiles.value = []
      return
    }
    throw err
  } finally {
    loading.value = false
  }
}

// Keep selection valid as the (session-scoped) file list changes.
watch(
  files,
  (list) => {
    const stillThere = selectedPath.value && list.some((f) => f.path === selectedPath.value)
    if (!stillThere) {
      selectedPath.value = list[0]?.path ?? null
      currentDiff.value = null
      if (selectedPath.value) loadDiff(selectedPath.value)
    }
  },
  { immediate: true },
)

let unlisten: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

const subscribe = async () => {
  const sidecar = useSidecar()
  if (!sidecar.available) return
  unlisten = await sidecar.onEvent((evt) => {
    const typed = evt as unknown as { type?: string; method?: string }
    if ((typed.type ?? typed.method) !== 'git:status:changed') return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      load().catch(() => undefined)
    }, 200)
  })
}

watch(() => props.workspaceRoot, load)

onMounted(() => {
  load()
  subscribe()
})

onBeforeUnmount(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (unlisten) unlisten()
})
</script>
