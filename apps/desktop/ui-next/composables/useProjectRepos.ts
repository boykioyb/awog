import { computed, ref, watch } from 'vue'
import { githubSlugFromRemote } from '~/components/project/data'
import { useSidecar } from './useSidecar'

// Discover the git repos under a project folder (git.discoverRepos, ≤2 levels).
// A project may be a multi-repo workspace (no .git at its own root), so this is
// how the UI surfaces every child repo + derives a GitHub slug per repo (for the
// Issues/PR repo picker + the Overview repo card). Browser-dev (no sidecar) →
// empty list; callers fall back to the entity-derived single repo.

export interface ProjectRepo {
  // basename of the repo folder.
  name: string
  // Path relative to the project root; '.' when the project root is itself a repo.
  relativePath: string
  isRoot: boolean
  // '' when unknown (git call failed / no remote).
  branch: string
  remote: string
  // Count of tracked working-tree changes; 0 = clean.
  dirty: number
  // owner/repo when the origin remote is a github.com URL, else null.
  ghSlug: string | null
}

type GitRepoEntryDto = {
  path: string
  name: string
  relativePath: string
  isRoot: boolean
  branch?: string
  remote?: string
  dirty?: number
}

export function useProjectRepos(getProjectId: () => string | null, getPath: () => string | null) {
  const sc = useSidecar()
  const repos = ref<ProjectRepo[]>([])
  const loading = ref(false)

  async function refresh(): Promise<void> {
    const path = getPath()
    if (!sc.available || !path) {
      repos.value = []
      return
    }
    loading.value = true
    try {
      const res = await sc.request<{ repos: GitRepoEntryDto[] }>('git.discoverRepos', {
        root: path,
      })
      repos.value = res.repos.map((r) => ({
        name: r.name,
        relativePath: r.relativePath,
        isRoot: r.isRoot,
        branch: r.branch ?? '',
        remote: r.remote ?? '',
        dirty: r.dirty ?? 0,
        ghSlug: githubSlugFromRemote(r.remote ?? ''),
      }))
    } catch {
      repos.value = []
    } finally {
      loading.value = false
    }
  }

  // Re-discover when the bound project (id or path) changes.
  watch([getProjectId, getPath], () => void refresh(), { immediate: true })

  // Repos whose origin remote resolves to a GitHub slug — the ones that can serve
  // Issues / PRs.
  const ghRepos = computed(() => repos.value.filter((r) => r.ghSlug))

  return { repos, ghRepos, loading, refresh }
}
