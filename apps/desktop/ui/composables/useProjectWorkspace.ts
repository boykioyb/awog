// Page-controller for the Project Code Workspace (docs/features/project-workspace.md).
// Owns explorer tree, open tabs, dirty/save, file ops, find-in-files, and the
// project-wide watcher reconcile. The page stays a thin template. SoC: this
// orchestrates state + IPC only — no direct fs access (everything via useFsApi).
import { inject, type InjectionKey } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { FsEntry, FsSearchMatch, Project } from '~/types'
import { useFsApi, type FsSearchOptions } from '~/composables/useFsApi'
import { useSidecar } from '~/composables/useSidecar'
import { useWorkspaceStore } from '~/stores/workspace'
import { useToasts } from '~/composables/useToasts'

export type ActivityView = 'explorer' | 'search' | 'git'

export interface OpenTab {
  path: string
  name: string
  language: string
  dirty: boolean
  readOnly: boolean
}

export interface SearchGroup {
  path: string
  matches: FsSearchMatch[]
}

// Minimal surface of <MonacoEditor>'s defineExpose — the page binds the ref.
interface MonacoEditorExposed {
  openFile: (path: string, content: string, language?: string) => void
  closeFile: (path: string) => void
  getValue: (path: string) => string
  revealPosition: (path: string, line: number, column: number) => void
  focus: () => void
}

const baseName = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}
const dirName = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback

export function useProjectWorkspace(projectId: string) {
  const fs = useFsApi()
  const sidecar = useSidecar()
  const ws = useWorkspaceStore()
  const { toasts, pushToast, toastStyle } = useToasts()

  const project = computed<Project | undefined>(() =>
    ws.projects.find((p: Project) => p.id === projectId),
  )
  const workspaceRoot = computed(() => project.value?.path ?? '')
  const ready = computed(() => workspaceRoot.value.length > 0)

  const editorRef = ref<MonacoEditorExposed | null>(null)
  const activity = ref<ActivityView>('explorer')
  const terminalOpen = ref(false)
  // Opaque PTY grouping key for the sidecar (terminal.list groups by it).
  const terminalKey = computed(() => `proj:${projectId}`)

  // ── Explorer tree (lazy, mirrors session Files tab shape) ──────────────────
  const expanded = reactive<Record<string, boolean>>({})
  const childrenByPath = reactive<Record<string, FsEntry[]>>({})
  const rootEntries = computed(() => childrenByPath[''] ?? [])

  async function loadDir(path: string): Promise<void> {
    if (!ready.value) return
    try {
      const res = await fs.listDir(workspaceRoot.value, path || undefined)
      childrenByPath[path] = res.entries
    } catch (err) {
      pushToast(errMsg(err, 'Load thư mục thất bại'), 'error')
    }
  }

  async function toggleDir(path: string): Promise<void> {
    if (expanded[path]) {
      expanded[path] = false
      return
    }
    if (!childrenByPath[path]) await loadDir(path)
    expanded[path] = true
  }

  async function refreshTree(): Promise<void> {
    await loadDir('')
    const open = Object.keys(expanded).filter((p) => expanded[p])
    await Promise.all(open.map((p) => loadDir(p)))
  }

  // ── Tabs + buffers ─────────────────────────────────────────────────────────
  const tabs = ref<OpenTab[]>([])
  const activePath = ref('')
  const cursor = ref({ line: 1, column: 1 })
  const savedContent = new Map<string, string>() // disk baseline per open file
  const liveContent = new Map<string, string>() // latest editor value

  const activeTab = computed(() => tabs.value.find((tt) => tt.path === activePath.value) ?? null)
  const findTab = (path: string): OpenTab | undefined => tabs.value.find((tt) => tt.path === path)

  async function openFile(path: string): Promise<void> {
    if (!ready.value) return
    if (findTab(path)) {
      activePath.value = path
      await nextTick()
      editorRef.value?.focus()
      return
    }
    try {
      const file = await fs.readFile(workspaceRoot.value, path)
      if (file.isBinary) {
        await sidecar.openPath(workspaceRoot.value, path).catch(() => undefined)
        pushToast('Binary file — mở bằng ứng dụng ngoài', 'info')
        return
      }
      const tab: OpenTab = {
        path,
        name: baseName(path),
        language: file.language ?? 'plaintext',
        dirty: false,
        readOnly: file.truncated, // oversize/truncated read → read-only, no clobber
      }
      tabs.value = [...tabs.value, tab]
      savedContent.set(path, file.content)
      liveContent.set(path, file.content)
      editorRef.value?.openFile(path, file.content, file.language)
      activePath.value = path
    } catch (err) {
      pushToast(errMsg(err, 'Mở file thất bại'), 'error')
    }
  }

  function onEditorChange(payload: { path: string; value: string }): void {
    liveContent.set(payload.path, payload.value)
    const tab = findTab(payload.path)
    if (tab) tab.dirty = payload.value !== savedContent.get(payload.path)
  }

  function onCursorChange(pos: { line: number; column: number }): void {
    cursor.value = pos
  }

  async function saveFile(path = activePath.value): Promise<void> {
    const tab = findTab(path)
    if (!tab || tab.readOnly || !path) return
    const value = editorRef.value?.getValue(path) ?? liveContent.get(path) ?? ''
    try {
      await fs.writeFile(workspaceRoot.value, path, value)
      savedContent.set(path, value)
      tab.dirty = false
    } catch (err) {
      pushToast(errMsg(err, 'Lưu thất bại'), 'error')
    }
  }

  // ── Tab close (with dirty confirm) ──────────────────────────────────────────
  const closeConfirm = ref<string | null>(null)

  function closeTab(path: string): void {
    editorRef.value?.closeFile(path)
    savedContent.delete(path)
    liveContent.delete(path)
    const idx = tabs.value.findIndex((tt) => tt.path === path)
    tabs.value = tabs.value.filter((tt) => tt.path !== path)
    if (activePath.value === path) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null
      activePath.value = next?.path ?? ''
    }
    if (closeConfirm.value === path) closeConfirm.value = null
  }

  function requestCloseTab(path: string): void {
    if (findTab(path)?.dirty) {
      closeConfirm.value = path
      return
    }
    closeTab(path)
  }

  async function confirmCloseSave(): Promise<void> {
    const path = closeConfirm.value
    if (!path) return
    await saveFile(path)
    closeTab(path)
  }

  function confirmCloseDiscard(): void {
    if (closeConfirm.value) closeTab(closeConfirm.value)
  }

  // ── File operations ─────────────────────────────────────────────────────────
  async function createFile(dir: string, name: string): Promise<void> {
    const path = dir ? `${dir}/${name}` : name
    try {
      await fs.createFile(workspaceRoot.value, path)
      await loadDir(dir)
      expanded[dir] = true
      await openFile(path)
    } catch (err) {
      pushToast(errMsg(err, 'Tạo file thất bại'), 'error')
    }
  }

  async function createFolder(dir: string, name: string): Promise<void> {
    const path = dir ? `${dir}/${name}` : name
    try {
      await fs.createDir(workspaceRoot.value, path)
      await loadDir(dir)
      expanded[dir] = true
    } catch (err) {
      pushToast(errMsg(err, 'Tạo thư mục thất bại'), 'error')
    }
  }

  async function renamePath(from: string, toName: string): Promise<void> {
    const parent = dirName(from)
    const to = parent ? `${parent}/${toName}` : toName
    if (to === from) return
    try {
      await fs.rename(workspaceRoot.value, from, to)
      if (findTab(from)) {
        closeTab(from)
        await openFile(to)
      }
      await loadDir(parent)
    } catch (err) {
      pushToast(errMsg(err, 'Đổi tên thất bại'), 'error')
    }
  }

  async function deletePath(path: string, isDir: boolean): Promise<void> {
    try {
      await fs.deletePath(workspaceRoot.value, path, isDir)
      if (findTab(path)) closeTab(path)
      await loadDir(dirName(path))
    } catch (err) {
      pushToast(errMsg(err, 'Xóa thất bại'), 'error')
    }
  }

  // ── Find-in-files ─────────────────────────────────────────────────────────
  const searchQuery = ref('')
  const searchOpts = reactive<FsSearchOptions>({
    regex: false,
    caseSensitive: false,
    wholeWord: false,
  })
  const searchResults = ref<FsSearchMatch[]>([])
  const searchTruncated = ref(false)
  const searching = ref(false)

  const searchGroups = computed<SearchGroup[]>(() => {
    const map = new Map<string, FsSearchMatch[]>()
    searchResults.value.forEach((m) => {
      const arr = map.get(m.path) ?? []
      arr.push(m)
      map.set(m.path, arr)
    })
    return [...map.entries()].map(([path, matches]) => ({ path, matches }))
  })

  async function runSearch(): Promise<void> {
    if (!ready.value || searchQuery.value.trim().length === 0) {
      searchResults.value = []
      searchTruncated.value = false
      return
    }
    searching.value = true
    try {
      const res = await fs.search(workspaceRoot.value, searchQuery.value, { ...searchOpts })
      searchResults.value = res.matches
      searchTruncated.value = res.truncated
    } catch (err) {
      pushToast(errMsg(err, 'Tìm kiếm thất bại'), 'error')
    } finally {
      searching.value = false
    }
  }

  async function openMatch(match: FsSearchMatch): Promise<void> {
    await openFile(match.path)
    await nextTick()
    editorRef.value?.revealPosition(match.path, match.line, match.column)
  }

  // ── Project-wide watcher reconcile (AC9) ────────────────────────────────────
  let unlisten: UnlistenFn | null = null

  async function reconcile(paths: string[]): Promise<void> {
    await refreshTree()
    const changed = new Set(paths)
    const reloadable = tabs.value.filter((tt) => changed.has(tt.path) && !tt.dirty)
    await Promise.all(
      reloadable.map(async (tt) => {
        try {
          const file = await fs.readFile(workspaceRoot.value, tt.path)
          if (!file.isBinary && file.content !== savedContent.get(tt.path)) {
            savedContent.set(tt.path, file.content)
            liveContent.set(tt.path, file.content)
            editorRef.value?.openFile(tt.path, file.content, file.language)
          }
        } catch {
          // file vanished / unreadable — tree refresh already reflects it
        }
      }),
    )
    const conflicts = tabs.value.filter((tt) => changed.has(tt.path) && tt.dirty)
    if (conflicts.length > 0) {
      pushToast(
        `${conflicts.length} file đổi ngoài app khi đang sửa — kiểm tra trước khi lưu`,
        'info',
      )
    }
  }

  async function startWatch(): Promise<void> {
    if (!ready.value || !sidecar.available) return
    await fs.watch(workspaceRoot.value).catch(() => undefined)
    unlisten = await sidecar.onEvent((e) => {
      if (e.type !== 'fs:changed') return
      const payload = e.payload as { workspaceRoot: string; paths: string[] }
      if (payload.workspaceRoot !== workspaceRoot.value) return
      reconcile(payload.paths).catch(() => undefined)
    })
  }

  async function stopWatch(): Promise<void> {
    if (unlisten) {
      unlisten()
      unlisten = null
    }
    if (ready.value && sidecar.available)
      await fs.unwatch(workspaceRoot.value).catch(() => undefined)
  }

  async function boot(): Promise<void> {
    await loadDir('')
    await startWatch()
  }

  onMounted(async () => {
    await ws.hydrateProjectsFromSidecar()
    if (ready.value) await boot()
  })
  onBeforeUnmount(() => {
    stopWatch().catch(() => undefined)
  })
  // Projects may hydrate after mount (race) — boot when the root resolves.
  watch(ready, (val, old) => {
    if (val && !old) boot().catch(() => undefined)
  })

  return {
    // identity
    project,
    workspaceRoot,
    ready,
    // editor
    editorRef,
    activePath,
    activeTab,
    cursor,
    tabs,
    onEditorChange,
    onCursorChange,
    openFile,
    saveFile,
    requestCloseTab,
    closeTab,
    closeConfirm,
    confirmCloseSave,
    confirmCloseDiscard,
    // activity / explorer
    activity,
    terminalOpen,
    terminalKey,
    expanded,
    childrenByPath,
    rootEntries,
    loadDir,
    toggleDir,
    refreshTree,
    createFile,
    createFolder,
    renamePath,
    deletePath,
    // search
    searchQuery,
    searchOpts,
    searchResults,
    searchGroups,
    searchTruncated,
    searching,
    runSearch,
    openMatch,
    // toasts
    toasts,
    toastStyle,
  }
}

export type ProjectWorkspaceCtx = ReturnType<typeof useProjectWorkspace>

// The page calls useProjectWorkspace() once and provides the controller; child
// panels (explorer, search, tabs, status bar) inject it instead of prop-drilling.
export const ProjectWorkspaceKey: InjectionKey<ProjectWorkspaceCtx> = Symbol('project-workspace')

export function useProjectWorkspaceContext(): ProjectWorkspaceCtx {
  const ctx = inject(ProjectWorkspaceKey)
  if (!ctx) throw new Error('Project workspace context missing — provide it on the page')
  return ctx
}
