// Controller for the Session Workspace "Files" tab — owns the lazy file tree,
// the read-only preview, and the right-click context menu (rename / copy path /
// reveal / open in VS Code / delete). Extracted from WorkspaceFilesTab.vue so the
// component stays a thin template (nuxt-vue page-controller convention).

import { Code2, Copy, FolderOpen, Pencil, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import type { FsEntry, FsFileContent, Session } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { useFsApi } from '~/composables/useFsApi'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'

// Minimal slice of <MonacoEditor>'s defineExpose used here.
export interface EditorExposed {
  openFile: (path: string, content: string, language?: string) => void
  revealRange: (path: string, startLine: number, endLine: number) => void
  focus: () => void
}

const dirName = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
const errMsg = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback

export function useWorkspaceFiles(props: { session: Session; workspaceRoot: string }) {
  const { t: tr } = useI18n()
  const api = useFsApi()
  const sidecar = useSidecar()
  const panel = useWorkspacePanelStore()
  const { toasts, pushToast, toastStyle } = useToasts()

  const close = () => panel.closeDrawer(props.session.id)

  // '' key = workspace root. Lazy: a directory's contents load on first visit.
  const childrenByPath = ref<Record<string, FsEntry[]>>({})
  // Finder-style cursor: the folder currently shown in the browser overlay.
  const cwd = ref('')
  const selectedPath = ref<string | null>(null)
  const fileContent = ref<FsFileContent | null>(null)
  // Non-null when the last read failed — shown in the preview area instead of a
  // blank pane (the old silent fallback hid path mismatches and read errors).
  const loadError = ref<string | null>(null)
  const loading = ref(false)
  // Browser is an overlay, hidden by default — toggled from the header icon.
  // Picking a file collapses it so the preview shows immediately at full size.
  const showTree = ref(false)

  const currentEntries = computed<FsEntry[]>(() => childrenByPath.value[cwd.value] ?? [])
  const atRoot = computed(() => cwd.value === '')

  // Breadcrumb segments from root → path. `isFile` marks the final segment when
  // the path points at a file (rendered as the non-clickable current item).
  type Crumb = { name: string; path: string; isFile: boolean }
  const crumbsFor = (path: string, isFile: boolean): Crumb[] => {
    const crumbs: Crumb[] = [{ name: tr('workspace.files.root'), path: '', isFile: false }]
    if (!path) return crumbs
    const parts = path.split('/')
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part
      crumbs.push({ name: part, path: acc, isFile: isFile && i === parts.length - 1 })
    })
    return crumbs
  }
  // Browser overlay breadcrumb (the folder cursor) and the file-preview
  // breadcrumb (the open file's path) share the same shape so both views match.
  const breadcrumbs = computed(() => crumbsFor(cwd.value, false))
  const fileBreadcrumbs = computed(() =>
    selectedPath.value ? crumbsFor(selectedPath.value, true) : [],
  )

  // Read-only Monaco surface, shared with the Project Code Workspace. We open one
  // file at a time imperatively; pending state covers the gap before Monaco mounts.
  const editorRef = ref<EditorExposed | null>(null)
  const pendingRange = ref<{ start: number; end: number } | null>(null)

  const pushToEditor = () => {
    const ed = editorRef.value
    const fc = fileContent.value
    const path = selectedPath.value
    if (!ed || !fc || !path || fc.isBinary) return
    ed.openFile(path, fc.content, fc.language)
    if (pendingRange.value) {
      ed.revealRange(path, pendingRange.value.start, pendingRange.value.end)
      pendingRange.value = null
    }
  }

  const onEditorReady = () => pushToEditor()

  const loadDir = async (path: string) => {
    try {
      const result = await api.listDir(props.workspaceRoot, path || undefined)
      childrenByPath.value = { ...childrenByPath.value, [path]: result.entries }
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return
      childrenByPath.value = { ...childrenByPath.value, [path]: [] }
    }
  }

  // Navigate the browser into a folder (load its contents on first visit).
  const openDir = async (path: string) => {
    cwd.value = path
    if (!childrenByPath.value[path]) await loadDir(path)
  }
  const goUp = () => {
    if (cwd.value) openDir(dirName(cwd.value)).catch(() => {})
  }

  // The model sometimes anchors a chat-link path on an ANCESTOR of the workspace
  // root (it worked from a parent dir in the terminal), so the path re-includes
  // the root's own trailing segments — `src/147/api/x.md` when the workspace root
  // already ends with `/src/147`. Returns the path with that duplicated prefix
  // stripped, or null when there is no leading overlap to strip.
  const dedupRootPrefix = (workspaceRoot: string, path: string): string | null => {
    const rootSegs = workspaceRoot.split(/[\\/]+/).filter(Boolean)
    const pathSegs = path.split('/').filter(Boolean)
    for (let k = Math.min(rootSegs.length, pathSegs.length); k > 0; k--) {
      const rootTail = rootSegs.slice(rootSegs.length - k).join('/')
      const pathHead = pathSegs.slice(0, k).join('/')
      if (rootTail === pathHead) return pathSegs.slice(k).join('/')
    }
    return null
  }

  const loadInto = async (path: string, line: number | null, endLine: number | null) => {
    selectedPath.value = path
    fileContent.value = null
    loadError.value = null
    pendingRange.value = line != null ? { start: line, end: endLine ?? line } : null
    try {
      fileContent.value = await api.readFile(props.workspaceRoot, path)
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return
      // Retry once with the duplicated root prefix stripped before giving up, so
      // an over-qualified link still opens. Only reached on a genuine read
      // failure — a valid path never lands here, so this can't hijack a good read.
      const alt = dedupRootPrefix(props.workspaceRoot, path)
      if (alt && alt !== path) {
        try {
          fileContent.value = await api.readFile(props.workspaceRoot, alt)
          selectedPath.value = alt
          pushToEditor()
          return
        } catch {
          // recovery failed too — surface the original error below
        }
      }
      loadError.value = errMsg(err, tr('workspace.files.openFailed'))
      return
    }
    pushToEditor()
  }

  const select = (entry: FsEntry) => {
    showTree.value = false // collapse overlay → preview shows full-size immediately
    loadInto(entry.path, null, null).catch(() => {})
  }

  // Row click in the browser: dirs navigate in, files open the preview.
  const openEntry = (entry: FsEntry) => {
    if (entry.kind === 'dir') openDir(entry.path).catch(() => {})
    else select(entry)
  }

  // Open the browser overlay scoped to the current file's folder (so it lands
  // where you are), or toggle it shut.
  const toggleBrowser = async () => {
    if (showTree.value) {
      showTree.value = false
      return
    }
    const dir = selectedPath.value ? dirName(selectedPath.value) : cwd.value
    await openDir(dir).catch(() => {})
    showTree.value = true
  }

  // Reopen the browser overlay focused on a folder — used by the file-preview
  // breadcrumb (click a folder) and its back button (return to the listing).
  const browseTo = async (path: string) => {
    await openDir(path).catch(() => {})
    showTree.value = true
  }
  const goBackToList = () => {
    browseTo(selectedPath.value ? dirName(selectedPath.value) : cwd.value).catch(() => {})
  }

  // Re-read the currently open file from disk (content + preview) without
  // touching the tree or selection — for the per-file "Reload" button.
  const reloadFile = async () => {
    if (selectedPath.value) await loadInto(selectedPath.value, null, null)
  }

  const openInEditor = () => {
    if (props.session.projectId && selectedPath.value) {
      // `from=session` tells the code page's back button to return to the
      // session (the store keeps the selection) instead of the project list.
      const file = encodeURIComponent(selectedPath.value)
      navigateTo(`/projects/${props.session.projectId}/code?file=${file}&from=session`)
    }
  }

  // Reveal the open file in the OS file manager (Finder / Explorer) — the
  // preview-header twin of the tree's right-click "Reveal in OS".
  const revealCurrent = () => {
    if (selectedPath.value)
      sidecar.revealPath(props.workspaceRoot, selectedPath.value).catch(() => {})
  }

  // Copy the workspace-relative path with a brief confirmation (matches the chat
  // copy-button pattern) — used by the preview header button.
  const copied = ref(false)
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  const copyPath = async () => {
    if (!selectedPath.value) return
    try {
      await navigator.clipboard.writeText(selectedPath.value)
      copied.value = true
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        copied.value = false
      }, 1500)
    } catch {
      // clipboard may be denied in restricted contexts — ignore
    }
  }

  // ── Context menu ──
  const menu = ref<{ x: number; y: number; entry: FsEntry } | null>(null)
  const onContext = (entry: FsEntry, ev: MouseEvent) => {
    menu.value = { x: ev.clientX, y: ev.clientY, entry }
  }
  const closeMenu = () => {
    menu.value = null
  }

  // Whether VS Code is on this machine — gates the "Open in VS Code" menu item.
  const vscodeAvailable = ref(false)

  const absPathOf = (path: string): string =>
    `${props.workspaceRoot.replace(/[/\\]+$/, '')}/${path}`

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      pushToast(tr('workspace.files.copied'), 'success')
    } catch {
      // clipboard may be denied in restricted contexts — ignore
    }
  }

  const revealInFinder = (entry: FsEntry) => {
    sidecar.revealPath(props.workspaceRoot, entry.path).catch(() => {})
  }
  const openInVscode = (entry: FsEntry) => {
    sidecar.openInVscode(props.workspaceRoot, entry.path).catch(() => {})
  }

  // ── Rename (inline in the tree node) ──
  const renamingPath = ref<string | null>(null)
  const startRename = (entry: FsEntry) => {
    showTree.value = true // ensure the tree (with the inline input) is visible
    renamingPath.value = entry.path
  }
  const onRenameCancel = () => {
    renamingPath.value = null
  }
  const onRenameSubmit = async (from: string, name: string) => {
    renamingPath.value = null
    const parent = dirName(from)
    const to = parent ? `${parent}/${name}` : name
    try {
      await api.rename(props.workspaceRoot, from, to)
    } catch (err) {
      pushToast(errMsg(err, tr('code.toast.rename_failed')), 'error')
      return
    }
    await loadDir(parent)
    if (selectedPath.value === from) {
      await loadInto(to, null, null)
    } else if (selectedPath.value?.startsWith(`${from}/`)) {
      // The previewed file lived inside a renamed folder — its path is now stale.
      selectedPath.value = null
      fileContent.value = null
    }
  }

  // ── Delete (confirm modal) ──
  const deleting = ref<{ path: string; isDir: boolean } | null>(null)
  const requestDelete = (entry: FsEntry) => {
    deleting.value = { path: entry.path, isDir: entry.kind === 'dir' }
  }
  const cancelDelete = () => {
    deleting.value = null
  }
  const confirmDelete = async () => {
    const target = deleting.value
    if (!target) return
    deleting.value = null
    try {
      await api.deletePath(props.workspaceRoot, target.path, target.isDir)
    } catch (err) {
      pushToast(errMsg(err, tr('code.toast.delete_failed')), 'error')
      return
    }
    await loadDir(dirName(target.path))
    if (selectedPath.value === target.path || selectedPath.value?.startsWith(`${target.path}/`)) {
      selectedPath.value = null
      fileContent.value = null
    }
  }

  const menuItems = computed<ContextMenuItem[]>(() => {
    const entry = menu.value?.entry
    if (!entry) return []
    const items: ContextMenuItem[] = [
      { label: tr('common.rename'), icon: Pencil, action: () => startRename(entry) },
      { separator: true },
      {
        label: tr('workspace.files.copyAbsPath'),
        icon: Copy,
        action: () => copyToClipboard(absPathOf(entry.path)),
      },
      {
        label: tr('workspace.files.copyRelPath'),
        icon: Copy,
        action: () => copyToClipboard(entry.path),
      },
      { separator: true },
      {
        label: tr('code.menu.reveal_os'),
        icon: FolderOpen,
        action: () => revealInFinder(entry),
      },
    ]
    if (vscodeAvailable.value) {
      items.push({
        label: tr('workspace.files.openInVscode'),
        icon: Code2,
        action: () => openInVscode(entry),
      })
    }
    items.push(
      { separator: true },
      {
        label: tr('common.delete'),
        icon: Trash2,
        danger: true,
        action: () => requestDelete(entry),
      },
    )
    return items
  })

  // Chat link `path#Lnn` → open + jump, driven by the workspacePanel store. A
  // fresh request wins over the persisted view restore (see onMounted); clear it
  // once consumed so it doesn't re-fire (and re-clobber) on every tab remount.
  let openedFromRequest = false
  watch(
    () => panel.pendingFileOpen(props.session.id),
    (req) => {
      if (!req) return
      openedFromRequest = true
      loadInto(req.path, req.line, req.endLine).catch(() => {})
      panel.clearFileOpen(props.session.id)
    },
    { immediate: true },
  )

  // Load (or reload) the root tree without touching the current selection.
  const loadRoot = async () => {
    if (loading.value) return
    loading.value = true
    try {
      await loadDir('')
    } finally {
      loading.value = false
    }
  }

  // Full reset — used by the refresh button and on workspaceRoot change. NOT on
  // initial mount: a chat-link `requestOpenFile` fires the immediate
  // `pendingFileOpen` watch during setup, and resetting here would wipe the file
  // the user just clicked (the old "click twice" bug).
  const refresh = async () => {
    childrenByPath.value = {}
    cwd.value = ''
    selectedPath.value = null
    fileContent.value = null
    pendingRange.value = null
    await loadRoot()
  }

  // Open the selected file in the default browser (HTML/PDF "Show in browser").
  const openInBrowser = async () => {
    if (!selectedPath.value) return
    try {
      await sidecar.openFileExternal(props.workspaceRoot, selectedPath.value)
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return
      pushToast(errMsg(err, tr('workspace.files.openFailed')), 'error')
    }
  }

  // Persist the view (folder cursor + open file + browser visibility) to the
  // store so returning to the tab restores it — the full-screen code editor
  // rebuilds the session page, so local state alone is lost on return.
  watch([cwd, selectedPath, showTree], () => {
    panel.setFilesView(props.session.id, {
      cwd: cwd.value,
      selectedPath: selectedPath.value,
      showTree: showTree.value,
    })
  })

  watch(() => props.workspaceRoot, refresh)
  onMounted(async () => {
    // Restore the saved view unless a chat link just opened a specific file (that
    // takes precedence). Set the cursor/visibility synchronously first so the UI
    // shows the right folder immediately, then re-fetch the data behind it.
    const saved = openedFromRequest ? null : panel.filesView(props.session.id)
    if (saved) {
      showTree.value = saved.showTree
      cwd.value = saved.cwd
    } else if (!openedFromRequest && !selectedPath.value) {
      showTree.value = true // fresh tab → show the folder browser straight away
    }
    await loadRoot()
    if (saved) {
      if (saved.cwd) await loadDir(saved.cwd)
      if (saved.selectedPath) await loadInto(saved.selectedPath, null, null)
    }
    sidecar
      .isVscodeAvailable()
      .then((ok) => {
        vscodeAvailable.value = ok
      })
      .catch(() => {})
  })

  return {
    // browser + preview
    currentEntries,
    breadcrumbs,
    fileBreadcrumbs,
    atRoot,
    selectedPath,
    fileContent,
    loadError,
    loading,
    showTree,
    editorRef,
    onEditorReady,
    openDir,
    goUp,
    openEntry,
    toggleBrowser,
    browseTo,
    goBackToList,
    refresh,
    reloadFile,
    close,
    openInEditor,
    openInBrowser,
    revealCurrent,
    copied,
    copyPath,
    // context menu
    menu,
    menuItems,
    closeMenu,
    onContext,
    // rename
    renamingPath,
    onRenameSubmit,
    onRenameCancel,
    // delete
    deleting,
    cancelDelete,
    confirmDelete,
    // toasts
    toasts,
    toastStyle,
  }
}
