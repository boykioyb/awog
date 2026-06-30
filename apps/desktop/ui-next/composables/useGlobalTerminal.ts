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

const STORAGE_KEY = 'awog-global-terminal-height'
const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 120
const MAX_HEIGHT = 900

function loadHeight(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_HEIGHT
  const raw = Number(localStorage.getItem(STORAGE_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw))
}

const isOpen = ref(false)
const everOpened = ref(false)
const height = ref(loadHeight())

export function useGlobalTerminal() {
  function open(): void {
    everOpened.value = true
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  function toggle(): void {
    if (isOpen.value) close()
    else open()
  }
  // Clamp + persist the dock height (called while dragging the resize handle).
  function setHeight(px: number): void {
    height.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px)))
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, String(height.value))
    }
  }
  return { isOpen, everOpened, height, open, close, toggle, setHeight, MIN_HEIGHT, MAX_HEIGHT }
}
