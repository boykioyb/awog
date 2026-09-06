<template>
  <div class="wsfiles">
    <!-- Toolbar (real-data mode only): create/collapse/reload for the whole tree.
         Right-click a row still exposes the full per-target menu. -->
    <div v-if="ready" class="wsfiles-tb">
      <span class="wsfiles-tb-name mono" :title="root ?? ''">{{ rootLabel }}</span>
      <div class="wsfiles-tb-actions">
        <button class="wpib" :title="t('files.ctx.newFile')" @click="createAtRoot('file')">
          <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button class="wpib" :title="t('files.ctx.newFolder')" @click="createAtRoot('dir')">
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="wpib"
          :title="t('sessions.workspace.files.collapseAll')"
          @click="collapseAll"
        >
          <Icon name="foldv" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          class="wpib"
          :class="{ spin: treeLoading }"
          :disabled="treeLoading"
          :title="t('sessions.workspace.files.reload')"
          @click="reloadTree"
        >
          <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>

    <!-- Not ready → say why. A session with no project has no root to walk, so the
         tree stays empty: never stand in a sample tree, which would look like the
         user's own files. -->
    <div v-if="!ready" class="wsfiles-fallback">
      <div class="empty" style="padding: 30px">
        <div class="et">
          {{ available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable') }}
        </div>
      </div>
    </div>

    <!-- File tree. Clicking a file opens the SHARED PreviewModal (same as attachment
         preview) via usePreview — there is exactly ONE file-preview surface. -->
    <div v-else class="ftree2">
      <SessionFileTree :nodes="rootNodes" :ctrl="ctrl" />
      <div v-if="!rootNodes.length && !treeLoading" class="empty" style="padding: 24px">
        <div class="et">{{ t('sessions.workspace.files.empty') }}</div>
      </div>
    </div>

    <!-- Shared file context menu (right-click a tree row). -->
    <ContextMenu
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
import type { Session, TreeNode } from '~/composables/useSessionsData'
import type { FileTreeController } from '~/components/session/SessionFileTree.vue'
import { useSidecar } from '~/composables/useSidecar'
import { usePreview, previewKindFromPath, type PreviewRef } from '~/composables/usePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useFileContextMenu } from '~/composables/useFileContextMenu'
import { useFsApi } from '~/composables/useFsApi'
import { useTextPrompt } from '~/composables/useTextPrompt'
import { pushActionToast } from '~/composables/useActionToasts'

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
    pushActionToast(err instanceof Error && err.message ? err.message : String(err), 'error')
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

<style scoped>
.wsfiles {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
/* Slim action bar above the tree — mirrors the panel-header button style (.wpib). */
.wsfiles-tb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.wsfiles-tb-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.wsfiles-tb-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
.wsfiles-tb .wpib:disabled {
  opacity: 0.5;
  cursor: default;
}
.wsfiles-tb .wpib.spin > .icn {
  animation: wsfiles-spin 0.8s linear infinite;
}
@keyframes wsfiles-spin {
  to {
    transform: rotate(360deg);
  }
}
.wsfiles-fallback {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
/* The tree fills the panel body and scrolls on its own (the file list overflows). */
.wsfiles > .ftree2 {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}
</style>
