import { ref } from 'vue'

// Collapse state of the Sessions page's master list column (SessionList).
//
// WHY a shared singleton and not local page state: the toggle lives in the tab
// strip (SessionTabBar), which sits ABOVE both columns and stays visible while the
// list is hidden — an expand affordance inside the list itself would disappear with
// it. The page reads the same flag to drop the resize handle and the terminal
// dock's left inset.
//
// localStorage, like the other per-machine view preferences of this screen
// (group-by / sort-by / show-archived): nothing the engine reads, so no IPC.
const STORAGE_KEY = 'awog.sessions.listCollapsed'

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const collapsed = ref(load())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed.value ? '1' : '0')
  } catch {
    // localStorage unavailable (private mode / quota) — the choice just won't persist.
  }
}

export function useSessionListCollapse() {
  const toggle = (): void => {
    collapsed.value = !collapsed.value
    persist()
  }
  const expand = (): void => {
    if (!collapsed.value) return
    collapsed.value = false
    persist()
  }
  return { collapsed, toggle, expand }
}
