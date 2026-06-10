// Page-controller for the Project Code Workspace (docs/features/project-workspace.md).
// Owns explorer tree, open tabs, dirty/save, file ops, find-in-files, and the
// project-wide watcher reconcile. The page stays a thin template. SoC: this
// orchestrates state + IPC only — no direct fs access (everything via useFsApi).
import { Files, GitBranch, Save, Search, TerminalSquare, X } from 'lucide-vue-next'
import { inject, type InjectionKey } from 'vue'
import type { UnlistenFn } from '~/composables/useSidecar'
import type { FsEntry, FsSearchMatch, Project } from '~/types'
import { useFsApi, type FsSearchOptions } from '~/composables/useFsApi'
import { useSidecar } from '~/composables/useSidecar'
import { useWorkspaceStore } from '~/stores/workspace'
import { useToasts } from '~/composables/useToasts'
import type { PaletteCommand } from '~/composables/useCommandPalette'

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
  const { t: tr } = useI18n()
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
      pushToast(errMsg(err, tr('code.toast.load_dir_failed')), 'error')
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
        pushToast(tr('code.toast.binary_external'), 'info')
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
      pushToast(errMsg(err, tr('code.toast.open_failed')), 'error')
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
      pushToast(errMsg(err, tr('code.toast.save_failed')), 'error')
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
      pushToast(errMsg(err, tr('code.toast.create_file_failed')), 'error')
    }
  }

  async function createFolder(dir: string, name: string): Promise<void> {
    const path = dir ? `${dir}/${name}` : name
    try {
      await fs.createDir(workspaceRoot.value, path)
      await loadDir(dir)
      expanded[dir] = true
    } catch (err) {
      pushToast(errMsg(err, tr('code.toast.create_dir_failed')), 'error')
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
      pushToast(errMsg(err, tr('code.toast.rename_failed')), 'error')
    }
  }

  async function deletePath(path: string, isDir: boolean): Promise<void> {
    try {
      await fs.deletePath(workspaceRoot.value, path, isDir)
      if (findTab(path)) closeTab(path)
      await loadDir(dirName(path))
    } catch (err) {
      pushToast(errMsg(err, tr('code.toast.delete_failed')), 'error')
    }
  }

  // ── Find-in-files ─────────────────────────────────────────────────────────
  const searchQuery = ref('')
  const searchOpts = reactive<FsSearchOptions>({
    regex: false,
    caseSensitive: false,
    wholeWord: false,
    includeGlob: '',
    excludeGlob: '',
  })
  const searchResults = ref<FsSearchMatch[]>([])
  const searchTruncated = ref(false)
  const searching = ref(false)
  // Monotonic token so an out-of-order search response can't clobber a newer one
  // (type "foo" then "foobar" fast → "foo" must not overwrite "foobar" results).
  let searchSeq = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

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
    const seq = ++searchSeq
    searching.value = true
    // Empty glob strings are invalid backend params (z.string().min(1)) — only
    // forward globs the user actually typed.
    const opts: FsSearchOptions = {
      regex: searchOpts.regex,
      caseSensitive: searchOpts.caseSensitive,
      wholeWord: searchOpts.wholeWord,
    }
    if (searchOpts.includeGlob?.trim()) opts.includeGlob = searchOpts.includeGlob.trim()
    if (searchOpts.excludeGlob?.trim()) opts.excludeGlob = searchOpts.excludeGlob.trim()
    try {
      const res = await fs.search(workspaceRoot.value, searchQuery.value, opts)
      if (seq !== searchSeq) return // a newer search superseded this one
      searchResults.value = res.matches
      searchTruncated.value = res.truncated
    } catch (err) {
      if (seq !== searchSeq) return
      pushToast(errMsg(err, tr('code.toast.search_failed')), 'error')
    } finally {
      if (seq === searchSeq) searching.value = false
    }
  }

  // Live search: re-run (debounced) on query / option changes. The `{ ...opts }`
  // getter reads every searchOpts field so toggles + globs all trigger it.
  watch([searchQuery, () => ({ ...searchOpts })], () => {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
    if (searchQuery.value.trim().length === 0) {
      searchSeq++ // discard any in-flight response
      searchResults.value = []
      searchTruncated.value = false
      searching.value = false
      return
    }
    searchTimer = setTimeout(() => {
      searchTimer = null
      runSearch()
    }, 250)
  })

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
      pushToast(tr('code.toast.external_change', { count: conflicts.length }), 'info')
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

  // ── Command palette / quick open ────────────────────────────────────────────
  const paletteOpen = ref(false)
  const paletteMode = ref<'file' | 'command'>('file')

  const openPalette = (m: 'file' | 'command' = 'file'): void => {
    if (paletteOpen.value) return // ignore re-trigger while open (use `>` to switch mode)
    paletteMode.value = m
    paletteOpen.value = true
  }
  const closePalette = (): void => {
    paletteOpen.value = false
  }

  // Actions for command mode — co-located with the handlers they call. Computed
  // so labels re-translate if the locale changes while the workspace is open.
  const paletteCommands = computed<PaletteCommand[]>(() => [
    { id: 'save', label: tr('code.cmd.save'), icon: Save, run: () => void saveFile() },
    {
      id: 'closeTab',
      label: tr('code.cmd.close_tab'),
      icon: X,
      run: () => {
        if (activePath.value) requestCloseTab(activePath.value)
      },
    },
    {
      id: 'toggleTerminal',
      label: tr('code.cmd.toggle_terminal'),
      icon: TerminalSquare,
      run: () => {
        terminalOpen.value = !terminalOpen.value
      },
    },
    {
      id: 'showExplorer',
      label: tr('code.cmd.show_explorer'),
      icon: Files,
      run: () => {
        activity.value = 'explorer'
      },
    },
    {
      id: 'showSearch',
      label: tr('code.cmd.find_in_files'),
      icon: Search,
      run: () => {
        activity.value = 'search'
      },
    },
    {
      id: 'showGit',
      label: tr('code.cmd.source_control'),
      icon: GitBranch,
      run: () => {
        activity.value = 'git'
      },
    },
  ])

  // Cmd/Ctrl+P → quick open; Cmd/Ctrl+Shift+P → command palette. Capture phase so
  // we beat Monaco's own bindings + the browser print dialog; bail on IME compose
  // (the user types Vietnamese, so a composition keystroke must never hijack).
  const onGlobalKeydown = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.code !== 'KeyP' || e.altKey || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    e.stopPropagation()
    openPalette(e.shiftKey ? 'command' : 'file')
  }

  onMounted(async () => {
    window.addEventListener('keydown', onGlobalKeydown, true)
    await ws.hydrateProjectsFromSidecar()
    if (ready.value) await boot()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onGlobalKeydown, true)
    if (searchTimer) clearTimeout(searchTimer)
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
    // command palette / quick open
    paletteOpen,
    paletteMode,
    paletteCommands,
    openPalette,
    closePalette,
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
