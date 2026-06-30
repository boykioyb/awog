// Per-project pinned branches — a user's "keep this branch handy" choice that
// floats it to the top of the Git sidebar's Branches section. Persisted to
// localStorage (key `awog.git.pinnedBranches` → `{ "<projectId>": string[] }`)
// so it survives restarts. Module-level singleton: every GitManager instance in
// this renderer (full /git page + session Git modal) shares one source of truth.
import { computed, ref } from 'vue'

const STORAGE_KEY = 'awog.git.pinnedBranches'

type PinMap = Record<string, string[]>

function load(): PinMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PinMap) : {}
  } catch {
    return {}
  }
}

// Shared across all callers in this renderer.
const byProject = ref<PinMap>(load())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject.value))
  } catch {
    // localStorage unavailable (private mode / quota) — pins just won't persist.
  }
}

export function useGitBranchPins(getProjectId: () => string) {
  const pinned = computed<Set<string>>(() => new Set(byProject.value[getProjectId()] ?? []))

  const isPinned = (name: string): boolean => pinned.value.has(name)

  // Pin if absent, unpin if present. New pins append (most-recent last).
  const toggle = (name: string): void => {
    const id = getProjectId()
    if (!id) return
    const cur = byProject.value[id] ? [...byProject.value[id]!] : []
    const i = cur.indexOf(name)
    if (i >= 0) cur.splice(i, 1)
    else cur.push(name)
    byProject.value = { ...byProject.value, [id]: cur }
    persist()
  }

  return { pinned, isPinned, toggle }
}
