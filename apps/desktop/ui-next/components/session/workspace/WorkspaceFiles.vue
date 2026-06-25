<template>
  <div class="wsfiles">
    <!-- Unavailable / no-root → mock tree fallback (browser-dev) or message. -->
    <div v-if="!ready" class="wsfiles-fallback">
      <div v-if="!available" class="empty" style="padding: 30px">
        <div class="et">{{ t('sessions.workspace.unavailable') }}</div>
      </div>
      <!-- Engine present but no project bound → mock tree (keeps panel usable). -->
      <div v-else-if="!root" class="ftree2">
        <SessionFileTree :nodes="FTREE" />
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
  </div>
</template>

<script setup lang="ts">
// Files tab (§5/§10) — real lazy file tree via fs.listDir. Opening a file routes to
// the shared PreviewModal (usePreview) — the SAME modal used for attachment preview,
// so there's a single file-preview surface (the modal reads content via fs.readFile
// when given workspaceRoot + path). Browser-dev (no engine) → static mock tree.
import type { Session, TreeNode } from '~/composables/useSessionsMock'
import type { FileTreeController } from '~/components/session/SessionFileTree.vue'
import { useSidecar } from '~/composables/useSidecar'
import { usePreview, type PreviewRef } from '~/composables/usePreview'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

const props = defineProps<{ session: Session }>()

const { t } = useI18n()
const { FTREE } = useSessionsMock()
const sc = useSidecar()
const preview = usePreview()
const { root, ready, available } = useWorkspaceData(() => props.session.project)

// ── Sidecar fs shapes ────────────────────────────────────────────────────────
type FsEntry = { name: string; path: string; kind: 'file' | 'dir'; size?: number }

// Lazy tree state: children + expanded set keyed by workspace-relative dir path
// ('' = root). Reactive so the recursive tree re-renders on load/expand.
const childrenByPath = reactive<Record<string, FsEntry[]>>({})
const expanded = reactive<Set<string>>(new Set())
const treeLoading = ref(false)
// Highlight the opened file in the tree (no inline viewer — preview is the modal).
const selectedPath = ref<string | null>(null)

// Convert loaded FsEntry[] for a dir into the mock TreeNode shape SessionFileTree
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

// Preview kind from the file extension (the modal reads the real content itself).
function kindOf(path: string): PreviewRef['kind'] {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) return 'image'
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.(md|markdown)$/i.test(path)) return 'markdown'
  return 'text'
}

// Open a file in the shared PreviewModal (workspaceRoot + path → fs.readFile).
function openFile(path: string): void {
  if (!root.value) return
  selectedPath.value = path
  preview.open({
    name: path.split('/').pop() || path,
    kind: kindOf(path),
    workspaceRoot: root.value,
    path,
  })
}

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
