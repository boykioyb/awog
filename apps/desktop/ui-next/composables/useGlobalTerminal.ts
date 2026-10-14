import { computed, ref } from 'vue'

// Shared, app-wide state for the terminal dock — a bottom dock mounted once in the
// default layout (GlobalTerminalHost), reachable from the status bar on every page.
// Module-level refs are the single source of truth for every caller (status bar
// toggle, ⌘J shortcut, MinimizeDock, and the host itself).
//
// OPEN/CLOSE IS PER PROJECT. `openByKey` maps a project key (GlobalTerminalHost's
// `sessions.activeTab`, '' → '__home__') to whether the dock is open for THAT project,
// so opening the terminal in project A and closing it in project B is remembered
// independently: return to A → shown open; stay on B → shown closed. The host tells us
// which project is active via `setActiveKey`; `isOpen` is that project's flag. Persisted
// so the choice survives a reload.
//
// The host keeps a project's terminal mounted (v-show) once opened so the shell +
// scrollback survive a close→reopen or a project switch; closing a project's TAB
// disposes it. The sidecar idle-sweep reaps a PTY after 30 min idle; app shutdown kills
// it regardless.
//
// `collapsed` is the in-place "roll-up" minimize (dock shrinks to its header; PTY
// untouched). `height` / `collapsed` / `snippetsOpen` stay GLOBAL (shared across
// projects) — only open/close is per-project. All three are persisted.

const HOME_KEY = '__home__'
const HEIGHT_KEY = 'awog-global-terminal-height'
const COLLAPSED_KEY = 'awog-global-terminal-collapsed'
const SNIPPETS_KEY = 'awog-global-terminal-snippets-open'
const OPEN_MAP_KEY = 'awog-global-terminal-open-by-project'
const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 120
const MAX_HEIGHT = 900

function loadHeight(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_HEIGHT
  const raw = Number(localStorage.getItem(HEIGHT_KEY))
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HEIGHT
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, raw))
}

// Per-project open state, persisted. A corrupt/absent value → empty map → every project
// starts closed (matches the pre-feature "dock starts closed on load" behaviour).
function loadOpenMap(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OPEN_MAP_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v
      }
      return out
    }
  } catch {
    // Corrupt value → every project closed.
  }
  return {}
}

// The project key the dock is currently showing (set by GlobalTerminalHost). Drives
// which entry of `openByKey` is the live `isOpen`.
const activeKey = ref(HOME_KEY)
const openByKey = ref<Record<string, boolean>>(loadOpenMap())
const height = ref(loadHeight())
const collapsed = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === '1',
)
const snippetsOpen = ref(
  typeof localStorage !== 'undefined' && localStorage.getItem(SNIPPETS_KEY) === '1',
)
// Bề mặt có dock terminal riêng (Session Workbench, ADR 0098) set cờ này để
// giấu dock toàn cục: hai dock đáy chồng nhau thì xterm nằm dưới và ⌘J bật cả
// hai cùng lúc. Chỉ là cờ hiển thị — PTY sống tiếp, trạng thái mở per-project
// không đổi; bỏ cờ là dock trở lại đúng trạng thái cũ.
const suppressed = ref(false)

// Open state of the ACTIVE project's dock (absent key → closed). `suppressed`
// wins over the per-project flag so the host hides itself entirely.
const isOpen = computed(() => !suppressed.value && (openByKey.value[activeKey.value] ?? false))

function setOpen(key: string, value: boolean): void {
  // Always reassign so the shallow ref fires; persist the per-project map.
  openByKey.value = { ...openByKey.value, [key]: value }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(OPEN_MAP_KEY, JSON.stringify(openByKey.value))
  }
}

export function useGlobalTerminal() {
  // The host calls this whenever the open project changes so open/close/toggle act on
  // the right project and `isOpen` reflects it. '' (Default tab) → the home key.
  function setActiveKey(key: string): void {
    activeKey.value = key || HOME_KEY
  }
  // Open the ACTIVE project's dock. Always expands the roll-up so clicking "Terminal"
  // reveals the content (never a bare header bar). Suppressed → no-op: on a surface
  // with its own dock (workbench) ⌘J must not open this one underneath.
  function open(): void {
    if (suppressed.value) return
    setOpen(activeKey.value, true)
    setCollapsed(false)
  }
  function close(): void {
    if (suppressed.value) return
    setOpen(activeKey.value, false)
  }
  function toggle(): void {
    if (suppressed.value) return
    if (isOpen.value) close()
    else open()
  }
  // Giấu/hiện toàn bộ dock (Session Workbench có dock terminal riêng). PTY sống
  // tiếp; bỏ cờ là dock trở lại đúng trạng thái cũ.
  function setSuppressed(v: boolean): void {
    suppressed.value = v
  }
  // Roll-up state (global): shrink the dock to its header (keeps the PTY alive).
  function setCollapsed(v: boolean): void {
    collapsed.value = v
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0')
    }
  }
  function toggleCollapse(): void {
    setCollapsed(!collapsed.value)
  }
  // Snippets rail (global) — right side of the dock body.
  function setSnippetsOpen(v: boolean): void {
    snippetsOpen.value = v
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SNIPPETS_KEY, v ? '1' : '0')
    }
  }
  function toggleSnippets(): void {
    setSnippetsOpen(!snippetsOpen.value)
  }
  // Clamp + persist the dock height (global; called while dragging the resize handle).
  function setHeight(px: number): void {
    height.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(px)))
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(HEIGHT_KEY, String(height.value))
    }
  }
  return {
    isOpen,
    setActiveKey,
    setSuppressed,
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
