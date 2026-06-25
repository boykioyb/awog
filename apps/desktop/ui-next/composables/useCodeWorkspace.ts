// Page-controller for the Project Code Workspace (pages/code/[id].vue). Owns the
// project root resolution, the file-tree controller, the open tabs + dirty
// tracking, and save. The page stays a thin template. SoC: all fs access goes
// through useFsApi (sidecar IPC); no direct fs here.
//
// Resolve flow: route id → projects.list → project.path (absolute workspace root).
// Browser-dev (no engine) → root stays null, the tree is empty, edits are local.
import { computed, ref } from 'vue'
import { useFsApi } from '~/composables/useFsApi'
import { useWorkspaceFiles } from '~/composables/useWorkspaceFiles'
import { loadProjects } from '~/composables/useWorkspaceData'
import { useSidecar } from '~/composables/useSidecar'
import type { FileTreeController } from '~/components/editor/file-tree-controller'
import type { EditorTab, MonacoEditorHandle } from '~/components/editor/types'

const basename = (p: string): string => p.split('/').pop() || p

// Best-effort Monaco language from a file extension (the sidecar's fs.readFile
// also returns one; this covers the not-yet-read case for new tabs).
const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  toml: 'toml',
  sql: 'sql',
}
function languageOf(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext ? EXT_LANG[ext] : undefined
}

export type CodeToast = { id: number; text: string; kind: 'success' | 'error' }

export function useCodeWorkspace(projectId: string) {
  const sc = useSidecar()
  const fs = useFsApi()

  const projectName = ref<string | null>(null)
  const root = ref<string | null>(null)
  // null = still resolving; false = resolved-but-not-found / browser-dev no root.
  const ready = ref<boolean | null>(null)

  const tree = useWorkspaceFiles(root)

  // ── Tabs + active file ──────────────────────────────────────────────────
  const tabs = ref<EditorTab[]>([])
  const activePath = ref('')
  const cursor = ref({ line: 1, column: 1 })

  const activeTab = computed<EditorTab | null>(
    () => tabs.value.find((tab) => tab.path === activePath.value) ?? null,
  )
  const hasOpenTabs = computed(() => tabs.value.length > 0)

  // Imperative Monaco handle (set by the page once EditorMonacoPane mounts).
  const editorRef = ref<MonacoEditorHandle | null>(null)
  // Files the user clicked before Monaco was ready (flushed on editor `ready`).
  const pending: { path: string; content: string; language?: string }[] = []

  // ── Toasts ────────────────────────────────────────────────────────────────
  const toasts = ref<CodeToast[]>([])
  let toastSeq = 0
  function pushToast(text: string, kind: CodeToast['kind']): void {
    const id = ++toastSeq
    toasts.value.push({ id, text, kind })
    setTimeout(() => {
      toasts.value = toasts.value.filter((tt) => tt.id !== id)
    }, 2600)
  }

  // ── Open / close / activate ─────────────────────────────────────────────
  async function openFile(path: string): Promise<void> {
    const existing = tabs.value.find((tab) => tab.path === path)
    if (existing) {
      activePath.value = path
      return
    }
    if (!root.value) return
    let content = ''
    let language = languageOf(path)
    try {
      const fc = await fs.readFile(root.value, path)
      if (fc.isBinary) {
        pushToast(`Cannot open binary file: ${basename(path)}`, 'error')
        return
      }
      content = fc.content
      if (fc.language) language = fc.language
    } catch {
      pushToast(`Failed to open ${basename(path)}`, 'error')
      return
    }
    tabs.value.push({ path, name: basename(path), language, dirty: false })
    activePath.value = path
    if (editorRef.value) editorRef.value.openFile(path, content, language)
    else pending.push({ path, content, language })
  }

  function activateTab(path: string): void {
    activePath.value = path
  }

  function closeTab(path: string): void {
    const idx = tabs.value.findIndex((tab) => tab.path === path)
    if (idx === -1) return
    editorRef.value?.closeFile(path)
    tabs.value.splice(idx, 1)
    if (activePath.value === path) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
      activePath.value = next?.path ?? ''
    }
  }

  // ── Editor events ─────────────────────────────────────────────────────────
  function onChange(payload: { path: string; value: string }): void {
    const tab = tabs.value.find((tt) => tt.path === payload.path)
    if (tab && !tab.dirty) tab.dirty = true
  }

  function onCursorChange(pos: { line: number; column: number }): void {
    cursor.value = pos
  }

  function onEditorReady(): void {
    // Flush opens requested before the editor mounted, then activate the current.
    for (const op of pending) editorRef.value?.openFile(op.path, op.content, op.language)
    pending.length = 0
    if (activePath.value) editorRef.value?.focus()
  }

  async function saveFile(): Promise<void> {
    const tab = activeTab.value
    if (!tab || !root.value || !editorRef.value) return
    const value = editorRef.value.getValue(tab.path)
    try {
      await fs.writeFile(root.value, tab.path, value)
      tab.dirty = false
      pushToast(`Saved ${tab.name}`, 'success')
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : 'Save failed'
      pushToast(msg, 'error')
    }
  }

  // ── File-tree controller (handed to EditorFileTree) ──────────────────────
  const fileTreeCtrl: FileTreeController = {
    childrenFor: (dir) => tree.childrenFor(dir),
    isExpanded: (dir) => tree.isExpanded(dir),
    toggle: (dir) => tree.toggle(dir),
    openFile: (path) => void openFile(path),
    loading: tree.loading,
  }

  // ── Resolve root + load root tree ─────────────────────────────────────────
  async function init(): Promise<void> {
    if (!sc.available) {
      ready.value = false
      return
    }
    const projects = await loadProjects()
    const hit = projects.find((p) => p.id === projectId) ?? null
    if (!hit) {
      ready.value = false
      return
    }
    projectName.value = hit.name
    root.value = hit.path
    ready.value = true
    await tree.loadDir('')
  }

  return {
    // resolved project
    projectName: computed(() => projectName.value),
    projectPath: computed(() => root.value),
    ready: computed(() => ready.value),
    available: sc.available,
    // tree
    fileTreeCtrl,
    // tabs
    tabs: computed(() => tabs.value),
    activePath: computed(() => activePath.value),
    activeTab,
    hasOpenTabs,
    cursor: computed(() => cursor.value),
    // editor handle binding (the page sets this ref on the pane)
    editorRef,
    // actions
    init,
    openFile,
    activateTab,
    closeTab,
    saveFile,
    onChange,
    onCursorChange,
    onEditorReady,
    // toasts
    toasts: computed(() => toasts.value),
  }
}
