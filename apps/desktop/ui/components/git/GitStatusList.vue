<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="flex items-center justify-between px-3 py-2"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[1em] uppercase tracking-wider" :style="{ color: t.textDim }">
        {{ tr('git.status.working_tree') }}
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="store.unstagedFiles.length > 0 || store.untrackedFiles.length > 0"
          class="text-[1em] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
          @click="stageAll"
        >
          {{ tr('git.status.stage_all') }}
        </button>
        <button
          v-if="store.stagedFiles.length > 0"
          class="text-[1em] px-2 py-1 rounded transition"
          :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
          @click="unstageAll"
        >
          {{ tr('git.status.unstage_all') }}
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto py-1">
      <EmptyView
        v-if="store.statusFiles.length === 0"
        :icon="CheckCircle2"
        :title="tr('git.status.tree_clean')"
      />

      <GitStatusSection
        v-if="store.conflictedFiles.length > 0"
        :label="tr('git.status.conflicted')"
        :files="store.conflictedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="false"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
        @context-menu="onFileContextMenu"
      />

      <GitStatusSection
        v-if="store.stagedFiles.length > 0"
        :label="tr('git.status.staged')"
        :files="store.stagedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        :is-staged-section="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
        @context-menu="onFileContextMenu"
      />

      <GitStatusSection
        v-if="store.unstagedFiles.length > 0"
        :label="tr('git.status.changes')"
        :files="store.unstagedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
        @context-menu="onFileContextMenu"
      />

      <GitStatusSection
        v-if="store.untrackedFiles.length > 0"
        :label="tr('git.status.untracked')"
        :files="store.untrackedFiles"
        :selected-path="store.selectedFilePath"
        :show-stage="true"
        @select="(p) => store.selectFile(p)"
        @stage="(p) => store.stageFile(p)"
        @unstage="(p) => store.unstageFile(p)"
        @discard="(p) => askDiscard(p)"
        @context-menu="onFileContextMenu"
      />
    </div>

    <ConfirmDeleteModal
      v-if="pendingDiscard"
      :title="tr('git.discard.title')"
      :description="tr('git.discard.description', { path: pendingDiscard })"
      @confirm="confirmDiscard"
      @cancel="pendingDiscard = null"
    />

    <ContextMenu
      v-if="contextMenu"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :items="contextMenuItems"
      @close="contextMenu = null"
    />
  </div>
</template>

<script setup lang="ts">
import { CheckCircle2, Copy, FileText, FolderOpen, Plus, Trash2, Undo2 } from 'lucide-vue-next'
import type { GitFileStatus } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()

const pendingDiscard = ref<string | null>(null)

const askDiscard = (p: string) => {
  pendingDiscard.value = p
}

const confirmDiscard = () => {
  if (pendingDiscard.value) {
    store.discardFile(pendingDiscard.value)
  }
  pendingDiscard.value = null
}

const stageAll = () => {
  ;[...store.unstagedFiles, ...store.untrackedFiles].forEach((f: GitFileStatus) =>
    store.stageFile(f.path),
  )
}

const unstageAll = () => {
  store.stagedFiles.forEach((f: GitFileStatus) => store.unstageFile(f.path))
}

// ─── Context menu ──────────────────────────────────────────────────────────
const contextMenu = ref<{ x: number; y: number; file: GitFileStatus } | null>(null)

const onFileContextMenu = (e: MouseEvent, file: GitFileStatus) => {
  contextMenu.value = { x: e.clientX, y: e.clientY, file }
}

const copyToClipboard = (text: string) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(text).catch(() => undefined)
}

const resolveWorkspaceRoot = (): string => {
  const { projects } = useWorkspaceStore()
  const project = projects.find((p) => p.id === store.selectedProjectId)
  return project?.path ?? ''
}

const resolveAbsolutePath = (relPath: string): string => {
  const root = resolveWorkspaceRoot()
  if (!root) return relPath
  return root.endsWith('/') ? `${root}${relPath}` : `${root}/${relPath}`
}

const revealInFinder = async (relPath: string) => {
  const root = resolveWorkspaceRoot()
  if (!root) return
  try {
    await useSidecar().revealPath(root, relPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Reveal failed'
    store.toasts = [...store.toasts, { id: `t-${Date.now()}`, text: msg, kind: 'error' }]
  }
}

const openFile = async (relPath: string) => {
  const root = resolveWorkspaceRoot()
  if (!root) return
  try {
    await useSidecar().openPath(root, relPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Open failed'
    store.toasts = [...store.toasts, { id: `t-${Date.now()}`, text: msg, kind: 'error' }]
  }
}

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const { file } = ctx
  const absPath = resolveAbsolutePath(file.path)
  const hasAnyUnstaged = store.unstagedFiles.length > 0 || store.untrackedFiles.length > 0
  const hasAnyStaged = store.stagedFiles.length > 0

  const items: ContextMenuItem[] = []

  // Stage / Unstage (primary action)
  if (file.hasConflict) {
    items.push({
      label: tr('git.menu.mark_resolved'),
      icon: Plus,
      action: () => store.stageFile(file.path),
    })
  } else if (file.isStaged) {
    items.push({
      label: tr('git.menu.unstage'),
      icon: Undo2,
      shortcut: '⌘U',
      action: () => store.unstageFile(file.path),
    })
  } else {
    items.push({
      label: tr('git.menu.stage'),
      icon: Plus,
      shortcut: '⌘S',
      action: () => store.stageFile(file.path),
    })
  }

  // Discard (only when uncommitted change exists)
  if (!file.isStaged) {
    items.push({
      label: tr('git.menu.discard'),
      icon: Trash2,
      danger: true,
      shortcut: '⇧⌘D',
      action: () => askDiscard(file.path),
    })
  }

  items.push({ separator: true })

  // Bulk
  if (file.isStaged && hasAnyStaged) {
    items.push({ label: tr('git.menu.unstage_all'), icon: Undo2, action: unstageAll })
  } else if (!file.isStaged && hasAnyUnstaged) {
    items.push({ label: tr('git.menu.stage_all'), icon: Plus, action: stageAll })
  }

  items.push({ separator: true })

  // Clipboard
  items.push({
    label: tr('git.menu.copy_rel_path'),
    icon: Copy,
    action: () => copyToClipboard(file.path),
  })
  items.push({
    label: tr('git.menu.copy_abs_path'),
    icon: Copy,
    shortcut: '⌘C',
    action: () => copyToClipboard(absPath),
  })

  // OS integration — wired to Tauri `reveal_path` / `open_path` commands.
  const hasWorkspace = resolveWorkspaceRoot() !== ''
  items.push({
    label: tr('git.menu.show_in_finder'),
    icon: FolderOpen,
    disabled: !hasWorkspace,
    action: () => revealInFinder(file.path),
  })
  items.push({
    label: tr('git.menu.open'),
    icon: FileText,
    disabled: !hasWorkspace,
    action: () => openFile(file.path),
  })

  return items
})
</script>
