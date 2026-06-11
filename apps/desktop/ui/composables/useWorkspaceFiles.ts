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

  // '' key = workspace root. Lazy: a directory's children load on first expand.
  const childrenByPath = ref<Record<string, FsEntry[]>>({})
  const expanded = ref<Record<string, boolean>>({})
  const selectedPath = ref<string | null>(null)
  const fileContent = ref<FsFileContent | null>(null)
  const loading = ref(false)
  // Tree is an overlay, hidden by default — toggled from the header icon. Picking
  // a file collapses it so the preview shows immediately at full size.
  const showTree = ref(false)

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

  const toggle = async (path: string) => {
    if (expanded.value[path]) {
      expanded.value = { ...expanded.value, [path]: false }
      return
    }
    if (!childrenByPath.value[path]) await loadDir(path)
    expanded.value = { ...expanded.value, [path]: true }
  }

  const loadInto = async (path: string, line: number | null, endLine: number | null) => {
    selectedPath.value = path
    fileContent.value = null
    pendingRange.value = line != null ? { start: line, end: endLine ?? line } : null
    try {
      fileContent.value = await api.readFile(props.workspaceRoot, path)
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return
      fileContent.value = { path, content: '', truncated: false, isBinary: false }
      return
    }
    pushToEditor()
  }

  const select = (entry: FsEntry) => {
    showTree.value = false // collapse overlay → preview shows full-size immediately
    loadInto(entry.path, null, null).catch(() => {})
  }

  const openInEditor = () => {
    if (props.session.projectId && selectedPath.value) {
      navigateTo(
        `/projects/${props.session.projectId}/code?file=${encodeURIComponent(selectedPath.value)}`,
      )
    }
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

  // Chat link `path#Lnn` → open + jump, driven by the workspacePanel store.
  watch(
    () => panel.pendingFileOpen(props.session.id),
    (req) => {
      if (req) loadInto(req.path, req.line, req.endLine).catch(() => {})
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
    expanded.value = {}
    selectedPath.value = null
    fileContent.value = null
    pendingRange.value = null
    await loadRoot()
  }

  watch(() => props.workspaceRoot, refresh)
  onMounted(() => {
    loadRoot()
    sidecar
      .isVscodeAvailable()
      .then((ok) => {
        vscodeAvailable.value = ok
      })
      .catch(() => {})
  })

  return {
    // tree + preview
    childrenByPath,
    expanded,
    selectedPath,
    fileContent,
    loading,
    showTree,
    editorRef,
    onEditorReady,
    toggle,
    select,
    refresh,
    close,
    openInEditor,
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
