<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Toolbar (real-data mode only): create/collapse/reload for the whole tree.
         Right-click a row still exposes the full per-target menu. -->
    <div v-if="ready" class="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
      <span
        class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        :title="root ?? ''"
      >
        {{ rootLabel }}
      </span>
      <div class="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('files.ctx.newFile')"
          :aria-label="t('files.ctx.newFile')"
          @click="createAtRoot('file')"
        >
          <FilePlus class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('files.ctx.newFolder')"
          :aria-label="t('files.ctx.newFolder')"
          @click="createAtRoot('dir')"
        >
          <FolderPlus class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          :title="t('sessions.workspace.files.collapseAll')"
          :aria-label="t('sessions.workspace.files.collapseAll')"
          @click="collapseAll"
        >
          <FoldVertical class="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          :disabled="treeLoading"
          :title="t('sessions.workspace.files.reload')"
          :aria-label="t('sessions.workspace.files.reload')"
          @click="reloadTree"
        >
          <RotateCw class="size-3.5" :class="{ 'animate-spin': treeLoading }" />
        </Button>
      </div>
    </div>

    <!-- Not ready → say why. A session with no project has no root to walk, so the
         tree stays empty: never stand in a sample tree, which would look like the
         user's own files. -->
    <div v-if="!ready" class="min-h-0 flex-1 overflow-y-auto">
      <div class="empty" style="padding: 30px">
        <div class="et">
          {{ available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable') }}
        </div>
      </div>
    </div>

    <!-- File tree. Clicking a file opens the SHARED PreviewModal (same as attachment
         preview) via usePreview — there is exactly ONE file-preview surface. -->
    <div v-else class="min-h-0 flex-1 overflow-y-auto pb-2 font-mono text-xs">
      <SessionFileTree :nodes="rootNodes" :ctrl="ctrl" />
      <div v-if="!rootNodes.length && !treeLoading" class="empty" style="padding: 24px">
        <div class="et">{{ t('sessions.workspace.files.empty') }}</div>
      </div>
    </div>

    <!-- Shared file context menu (right-click a tree row). -->
    <AppContextMenu
      :open="fileMenu.menu.value !== null"
      :position="fileMenu.menu.value ?? { x: 0, y: 0 }"
      :items="fileMenu.items.value"
      @close="fileMenu.close"
      @select="fileMenu.onSelect"
    />
  </div>
</template>

<script setup lang="ts">
// Files tab (§5/§10) — real lazy file tree via fs.listDir. Opening a file routes to
// the shared PreviewModal (usePreview) — the SAME modal used for attachment preview,
// so there's a single file-preview surface (the modal reads content via fs.readFile
// when given workspaceRoot + path). No engine / no project → an empty state, never a sample tree.
import { FilePlus, FoldVertical, FolderPlus, RotateCw } from 'lucide-vue-next'
import type { Session, TreeNode } from '~/composables/useSessionsData'
import type { FileTreeController } from '~/components/session/SessionFileTree.vue'
import { useSidecar } from '~/composables/useSidecar'
import { usePreview, previewKindFromPath, type PreviewRef } from '~/composables/usePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useFileContextMenu } from '~/composables/useFileContextMenu'
import { useFsApi } from '~/composables/useFsApi'
import { useTextPrompt } from '~/composables/useTextPrompt'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const sc = useSidecar()
const preview = usePreview()
const fs = useFsApi()
const { prompt } = useTextPrompt()
const { root, ready, available } = useWorkspaceData(() => props.session.project)

// Basename of the workspace root — labels the toolbar so it's clear which folder
// the tree is showing (the panel tab only says "Files").
const rootLabel = computed(() => {
  const r = root.value
  if (!r) return ''
  return (
    r
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() || r
  )
})

// ── Sidecar fs shapes ────────────────────────────────────────────────────────
type FsEntry = { name: string; path: string; kind: 'file' | 'dir'; size?: number }

// Lazy tree state: children + expanded set keyed by workspace-relative dir path
// ('' = root). Reactive so the recursive tree re-renders on load/expand.
const childrenByPath = reactive<Record<string, FsEntry[]>>({})
const expanded = reactive<Set<string>>(new Set())
const treeLoading = ref(false)
// Highlight the opened file in the tree (no inline viewer — preview is the modal).
const selectedPath = ref<string | null>(null)

// Convert loaded FsEntry[] for a dir into the TreeNode shape SessionFileTree
// renders (dirs as { d }, files as { f }).
function nodesFor(dir: string): TreeNode[] {
  const entries = childrenByPath[dir] ?? []
  return entries.map<TreeNode>((e) => (e.kind === 'dir' ? { d: e.name } : { f: e.name }))
}
const rootNodes = computed<TreeNode[]>(() => nodesFor(''))

async function loadDir(dir: string): Promise<void> {
  if (!root.value || childrenByPath[dir]) return
  treeLoading.value = true
  try {
    const res = await sc.request<{ entries: FsEntry[] }>('fs.listDir', {
      workspaceRoot: root.value,
      ...(dir ? { path: dir } : {}),
    })
    childrenByPath[dir] = res.entries
  } catch {
    childrenByPath[dir] = []
  } finally {
    treeLoading.value = false
  }
}

// Force-reload one dir's children after a mutating menu op (drop the cache so
// loadDir re-fetches).
async function reloadDir(dir: string): Promise<void> {
  delete childrenByPath[dir]
  await loadDir(dir)
}

// Toolbar: re-read the whole tree from disk while preserving which dirs are open
// (root + every currently-expanded dir; collapsed dirs re-fetch lazily on expand).
async function reloadTree(): Promise<void> {
  if (!root.value) return
  const dirs = ['', ...expanded]
  for (const k of Object.keys(childrenByPath)) delete childrenByPath[k]
  await Promise.all(dirs.map((d) => loadDir(d)))
}

// Toolbar: collapse every open directory (cache is kept — re-expand is instant).
function collapseAll(): void {
  expanded.clear()
}

// Toolbar: create a file/folder at the workspace root (the per-row context menu
// covers creating inside a specific dir). Errors surface as a toast, never thrown.
async function createAtRoot(kind: 'file' | 'dir'): Promise<void> {
  const r = root.value
  if (!r) return
  const name = await prompt({
    title: t(kind === 'file' ? 'files.prompt.newFileTitle' : 'files.prompt.newFolderTitle'),
    placeholder: kind === 'file' ? t('files.prompt.newFilePh') : '',
    submitLabel: t(kind === 'file' ? 'files.ctx.newFile' : 'files.ctx.newFolder'),
  })
  if (!name) return
  try {
    if (kind === 'file') await fs.createFile(r, name)
    else await fs.createDir(r, name)
    await reloadDir('')
  } catch (err) {
    useToast().add({
      title: err instanceof Error && err.message ? err.message : String(err),
      color: 'error',
    })
  }
}

// Open a file in the shared PreviewModal (workspaceRoot + path → fs.readFile).
//
// For an IMAGE the enclosing FOLDER is the context the user is browsing, so the other images
// of that folder go along as the preview's ‹ › gallery. They're already loaded (the tree's
// own dir entries) — no extra IPC, and no guessing: what the tree shows is what steps.
function openFile(path: string): void {
  const r = root.value
  if (!r) return
  selectedPath.value = path
  const item: PreviewRef = {
    name: path.split('/').pop() || path,
    kind: previewKindFromPath(path),
    workspaceRoot: r,
    path,
  }
  preview.open(item, item.kind === 'image' ? folderImages(path, r) : [])
}

// Sibling images of `path`, in the order the tree lists them.
function folderImages(path: string, r: string): PreviewRef[] {
  const i = path.lastIndexOf('/')
  const dir = i > 0 ? path.slice(0, i) : ''
  const images = (childrenByPath[dir] ?? []).filter(
    (e) => e.kind === 'file' && previewKindFromPath(e.name) === 'image',
  )
  if (images.length < 2) return []
  return images.map((e) => ({
    name: e.name,
    kind: 'image' as const,
    workspaceRoot: r,
    path: e.path,
  }))
}

// Shared file context menu (right-click a tree row). Open a file → preview modal;
// mutating ops reload the affected dir.
const fileMenu = useFileContextMenu({
  root: () => root.value,
  onOpen: (tgt) => {
    if (tgt.kind === 'file') openFile(tgt.path)
  },
  onChanged: (dir) => reloadDir(dir),
})

// Controller handed to SessionFileTree for real-data expand/select + lazy load.
const ctrl: FileTreeController = {
  isOpen: (p) => expanded.has(p),
  toggle: (p) => {
    if (expanded.has(p)) {
      expanded.delete(p)
    } else {
      expanded.add(p)
      void loadDir(p)
    }
  },
  selectedPath,
  selectFile: (p) => openFile(p),
  childrenFor: (p) => nodesFor(p),
  onContext: (e, path, kind) => fileMenu.open(e, { path, kind }),
}

watch(root, (r) => {
  // Reset tree state when the root changes (session switch) + load the new root.
  for (const k of Object.keys(childrenByPath)) delete childrenByPath[k]
  expanded.clear()
  selectedPath.value = null
  if (r) void loadDir('')
})

onMounted(() => {
  if (root.value) void loadDir('')
})
</script>
