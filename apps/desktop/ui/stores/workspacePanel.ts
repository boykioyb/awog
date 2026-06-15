import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkspacePanelPosition, WorkspaceTab } from '~/types'

// Session workspace tools. The header exposes a dropdown switcher (Preview /
// Diff / Terminal / Files / Background tasks / Plan, mirroring Claude Code);
// picking one opens it as a single overlay drawer floating over the chat. One
// drawer is active per session at a time — `activeDrawerBySession[id]` is the
// open tool (null = closed). `position`, `widthPx`, `heightPx` are global
// ergonomics persisted to localStorage (like MasterDetailShell list widths).

const POSITION_KEY = 'awog.workspacePanel.position'
const WIDTH_KEY = 'awog.workspacePanel.width'
const HEIGHT_KEY = 'awog.workspacePanel.height'

const DEFAULT_WIDTH = 440
const MIN_WIDTH = 300
// Sanity upper bounds only. The real cap is the chat area itself — enforced live
// in SessionWorkspacePanel (drag clamps to the offsetParent size + CSS
// max-width/height: 100%) so the drawer can fill the main chat but never slide
// under the NavRail / off-screen.
const MAX_WIDTH = 1920
const DEFAULT_HEIGHT = 320
const MIN_HEIGHT = 160
const MAX_HEIGHT = 1200
const VALID_POSITIONS: WorkspacePanelPosition[] = ['right', 'left', 'bottom']

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

const readNum = (key: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback
  const n = Number(window.localStorage.getItem(key))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const readPosition = (): WorkspacePanelPosition => {
  if (typeof window === 'undefined') return 'right'
  const raw = window.localStorage.getItem(POSITION_KEY) as WorkspacePanelPosition | null
  return raw && VALID_POSITIONS.includes(raw) ? raw : 'right'
}

const persist = (key: string, value: string): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export const useWorkspacePanelStore = defineStore('workspacePanel', () => {
  const position = ref<WorkspacePanelPosition>(readPosition())
  const widthPx = ref<number>(clamp(readNum(WIDTH_KEY, DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH))
  const heightPx = ref<number>(clamp(readNum(HEIGHT_KEY, DEFAULT_HEIGHT), MIN_HEIGHT, MAX_HEIGHT))
  // null = no drawer open for that session.
  const activeDrawerBySession = ref<Record<string, WorkspaceTab | null>>({})

  const activeDrawer = (sessionId: string): WorkspaceTab | null =>
    activeDrawerBySession.value[sessionId] ?? null

  const openDrawer = (sessionId: string, tab: WorkspaceTab): void => {
    activeDrawerBySession.value = { ...activeDrawerBySession.value, [sessionId]: tab }
  }

  const closeDrawer = (sessionId: string): void => {
    activeDrawerBySession.value = { ...activeDrawerBySession.value, [sessionId]: null }
  }

  // Shortcut / re-click behaviour: same tool toggles closed, else switches.
  const toggleDrawer = (sessionId: string, tab: WorkspaceTab): void => {
    if (activeDrawer(sessionId) === tab) closeDrawer(sessionId)
    else openDrawer(sessionId, tab)
  }

  // "Open this file at a line" request, raised by markdown link clicks in the
  // chat and consumed by WorkspaceFilesTab. `seq` makes the same path+line
  // re-trigger the watcher (clicking the same link twice still navigates).
  let openSeq = 0
  type FileOpenRequest = { path: string; line: number | null; endLine: number | null; seq: number }
  const fileOpenRequest = ref<Record<string, FileOpenRequest>>({})

  const pendingFileOpen = (sessionId: string): FileOpenRequest | null =>
    fileOpenRequest.value[sessionId] ?? null

  const requestOpenFile = (
    sessionId: string,
    path: string,
    line: number | null = null,
    endLine: number | null = null,
  ): void => {
    openSeq += 1
    fileOpenRequest.value = {
      ...fileOpenRequest.value,
      [sessionId]: { path, line, endLine, seq: openSeq },
    }
    openDrawer(sessionId, 'files')
  }

  // Consumed by WorkspaceFilesTab once it has handled the request, so it does not
  // re-fire on every tab remount (e.g. returning from the full-screen editor).
  const clearFileOpen = (sessionId: string): void => {
    if (!fileOpenRequest.value[sessionId]) return
    const next = { ...fileOpenRequest.value }
    delete next[sessionId]
    fileOpenRequest.value = next
  }

  // Per-session Files-tab view (folder cursor + open file + browser visibility) so
  // it survives the tab unmounting — the full-screen code editor opens as a
  // separate route and rebuilds the session page on return.
  type FilesViewState = { cwd: string; selectedPath: string | null; showTree: boolean }
  const filesViewBySession = ref<Record<string, FilesViewState>>({})
  const filesView = (sessionId: string): FilesViewState | null =>
    filesViewBySession.value[sessionId] ?? null
  const setFilesView = (sessionId: string, state: FilesViewState): void => {
    filesViewBySession.value = { ...filesViewBySession.value, [sessionId]: state }
  }

  const setPosition = (pos: WorkspacePanelPosition): void => {
    position.value = pos
    persist(POSITION_KEY, pos)
  }

  // Live during drag — clamps but does not persist. Commit on drag end.
  const setWidth = (px: number): void => {
    widthPx.value = clamp(px, MIN_WIDTH, MAX_WIDTH)
  }
  const setHeight = (px: number): void => {
    heightPx.value = clamp(px, MIN_HEIGHT, MAX_HEIGHT)
  }

  const commitSize = (): void => {
    persist(WIDTH_KEY, String(widthPx.value))
    persist(HEIGHT_KEY, String(heightPx.value))
  }

  return {
    position,
    widthPx,
    heightPx,
    activeDrawer,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    setPosition,
    setWidth,
    setHeight,
    commitSize,
    pendingFileOpen,
    requestOpenFile,
    clearFileOpen,
    filesView,
    setFilesView,
  }
})
