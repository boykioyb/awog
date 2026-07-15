// Per-project PR-summary preferences — the base branch and the commit-rule file
// the user last chose in the PR summary modal. Persisted to localStorage (key
// `awog.git.prPrefs` → `{ "<projectId>": { base?, rulePath? } }`) so the modal
// reopens on those choices (pick once, change anytime). Module-level singleton,
// shared across GitManager instances in this renderer.
//
// `rulePath` is a workspace-relative path to a rule file (e.g.
// `.awog/rules/git-commit.md`); the empty string means "Default (app setting)".
// `undefined`/absent means the user has never chosen — the modal then auto-picks.
import { ref } from 'vue'

const STORAGE_KEY = 'awog.git.prPrefs'

type PrPrefs = { base?: string; rulePath?: string }
type PrefsMap = Record<string, PrPrefs>

function load(): PrefsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PrefsMap) : {}
  } catch {
    return {}
  }
}

const byProject = ref<PrefsMap>(load())

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byProject.value))
  } catch {
    // localStorage unavailable (private mode / quota) — prefs just won't persist.
  }
}

function patch(id: string, next: PrPrefs): void {
  if (!id) return
  byProject.value = { ...byProject.value, [id]: { ...byProject.value[id], ...next } }
  persist()
}

export function useGitPrPrefs(getProjectId: () => string) {
  const getBase = (): string | null => byProject.value[getProjectId()]?.base ?? null
  const rememberBase = (base: string): void => patch(getProjectId(), { base })

  // Returns `null` when the user has never chosen a rule (so the modal can
  // auto-pick a default); `''` is a real value meaning "Default (app setting)".
  const getRulePath = (): string | null => byProject.value[getProjectId()]?.rulePath ?? null
  const rememberRulePath = (rulePath: string): void => patch(getProjectId(), { rulePath })

  return { getBase, rememberBase, getRulePath, rememberRulePath }
}
