// Lazy workspace file-tree builder for the Project Code Workspace explorer
// (EditorFileTree). Loads a directory's children on first expand via fs.listDir
// (workspace-relative paths, gated by assertInsideWorkspace in the sidecar) and
// caches them keyed by dir path ('' = root). Dirs sort before files, both A→Z.
//
// SoC: orchestrates IPC only — the component owns markup. Browser-dev (no engine)
// → useFsApi returns empty results, so the tree just renders empty (never throws).
import { computed, reactive, ref, type Ref } from 'vue'
import { useFsApi, type FsEntry } from '~/composables/useFsApi'

export interface WorkspaceTreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
}

// Stable name sort: directories first, then case-insensitive A→Z.
function sortEntries(entries: FsEntry[]): WorkspaceTreeNode[] {
  return [...entries]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    .map<WorkspaceTreeNode>((e) => ({ name: e.name, path: e.path, kind: e.kind }))
}

export function useWorkspaceFiles(root: Ref<string | null>) {
  const fs = useFsApi()

  // Loaded children keyed by workspace-relative dir path ('' = root).
  const childrenByPath = reactive<Record<string, WorkspaceTreeNode[]>>({})
  // Expanded dir paths (drives the recursive render + lazy load).
  const expanded = reactive<Set<string>>(new Set())
  const loading = ref(false)

  const rootNodes = computed<WorkspaceTreeNode[]>(() => childrenByPath[''] ?? [])

  async function loadDir(dir: string): Promise<void> {
    if (!root.value || childrenByPath[dir]) return
    loading.value = true
    try {
      const res = await fs.listDir(root.value, dir || undefined)
      childrenByPath[dir] = sortEntries(res.entries)
    } catch {
      childrenByPath[dir] = []
    } finally {
      loading.value = false
    }
  }

  function childrenFor(dir: string): WorkspaceTreeNode[] {
    return childrenByPath[dir] ?? []
  }

  function isExpanded(dir: string): boolean {
    return expanded.has(dir)
  }

  function toggle(dir: string): void {
    if (expanded.has(dir)) {
      expanded.delete(dir)
    } else {
      expanded.add(dir)
      void loadDir(dir)
    }
  }

  // Drop all cached state (project switch / explicit refresh) and reload the root.
  async function reset(): Promise<void> {
    for (const k of Object.keys(childrenByPath)) delete childrenByPath[k]
    expanded.clear()
    if (root.value) await loadDir('')
  }

  return {
    rootNodes,
    loading: computed(() => loading.value),
    childrenFor,
    isExpanded,
    toggle,
    loadDir,
    reset,
  }
}
