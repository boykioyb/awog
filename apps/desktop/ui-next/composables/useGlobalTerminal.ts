import { ref } from 'vue'

// Shared, app-wide state for the GLOBAL terminal — a bottom dock mounted once in
// the default layout (GlobalTerminalHost) that is reachable from the status bar
// on every page, independent of any session. cwd defaults to the home directory
// ("~", expanded by the sidecar). Mirrors useGitModal / useWorkspacePanel:
// module-level refs are the single source of truth for every caller.
//
// `everOpened` keeps the PTY alive across open/close — the host renders the
// terminal once first opened, then only hides it (v-show) so reopening is
// instant and the shell + scrollback survive. The sidecar idle-sweep reaps it
// after 30 min idle; app shutdown kills it regardless.
//
// `collapsed` is the in-place "roll-up" minimize: the dock shrinks to just its
// header bar (content hidden, PTY untouched) and clicking the header expands it
// again. Distinct from `close` (hides the whole dock) — a collapsed dock is
// still visible, just tiny. Persisted so the roll-up state survives reloads.

const HEIGHT_KEY = 'awog-global-terminal-height'
const COLLAPSED_KEY = 'awog-global-terminal-collapsed'
const SNIPPETS_KEY = 'awog-global-terminal-snippets-open'
const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 120
const MAX_HEIGHT = 900

function loadHeight(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_HEIGHT
  const raw = Number(localStorage.getItem(HEIGHT_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw))
}

const isOpen = ref(false)
const everOpened = ref(false)
const height = ref(loadHeight())
const collapsed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === '1',
)
const snippetsOpen = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SNIPPETS_KEY) === '1',
)

export function useGlobalTerminal() {
  // Open the dock. Always expands the roll-up so clicking "Terminal" reveals the
  // content (never a bare header bar).
  function open(): void {
    everOpened.value = true
    isOpen.value = true
    setCollapsed(false)
  }
  function close(): void {
    isOpen.value = false
  }
  function toggle(): void {
    if (isOpen.value) close()
    else open()
  }
  // Roll-up state: shrink the dock to its header (keeps the PTY alive).
  function setCollapsed(v: boolean): void {
    collapsed.value = v
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0')
    }
  }
  function toggleCollapse(): void {
    setCollapsed(!collapsed.value)
  }
  // Snippets rail (right side of the dock body).
  function setSnippetsOpen(v: boolean): void {
    snippetsOpen.value = v
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SNIPPETS_KEY, v ? '1' : '0')
    }
  }
  function toggleSnippets(): void {
    setSnippetsOpen(!snippetsOpen.value)
  }
  // Clamp + persist the dock height (called while dragging the resize handle).
  function setHeight(px: number): void {
    height.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px)))
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HEIGHT_KEY, String(height.value))
    }
  }
  return {
    isOpen,
    everOpened,
    height,
    collapsed,
    snippetsOpen,
    open,
    close,
    toggle,
    setCollapsed,
    toggleCollapse,
    setSnippetsOpen,
    toggleSnippets,
    setHeight,
    MIN_HEIGHT,
    MAX_HEIGHT,
  }
}
