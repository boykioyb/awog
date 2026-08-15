import { ref } from 'vue'

// Shared, app-wide state for the Project quick-view modal. A single
// ProjectQuickViewModal instance (mounted in the default layout) reads this store
// so a button rendered deep in a session can pop the project's detail (Overview /
// Issues / PRs) over the session — to peek info + GitHub issues/PRs — without
// navigating away. Mirrors useGitModal.
//
// `key` is the session's `project` value as-is (a project id OR display name); the
// modal resolves it to the real entity, so callers don't need to know which.
const isOpen = ref(false)
const key = ref<string | null>(null)

// Deep-link target for openers that know WHICH tab / issue-PR they mean (a GitHub
// notification toast). Null = open on Overview, nothing selected.
export type ProjectModalTab = 'issues' | 'prs'
// What the detail pane is asked to show. `token` re-stamps per open() so the same
// target can be re-applied (clicking the same toast twice).
export type ProjectDeepLink = {
  tab: ProjectModalTab
  ghNumber: number | null
  token: number
}
const tab = ref<ProjectModalTab | null>(null)
const ghNumber = ref<number | null>(null)
// Bumped on every open() so the modal re-applies the same target when the user
// clicks a second toast for the issue/PR that is already showing.
const target = ref(0)

export function useProjectModal() {
  function open(
    projectKey: string | null,
    opts: { tab?: ProjectModalTab; ghNumber?: number } = {},
  ): void {
    key.value = projectKey
    tab.value = opts.tab ?? null
    ghNumber.value = opts.ghNumber ?? null
    target.value += 1
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, key, tab, ghNumber, target, open, close }
}
