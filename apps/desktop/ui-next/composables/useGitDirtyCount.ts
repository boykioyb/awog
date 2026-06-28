import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SidecarUnavailableError, useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

// Working-tree dirty count for a project's repo — the number of changed files the
// Git Manager would show (whole repo, ignored entries excluded). Resolves the
// project's workspace root via useWorkspaceData, reads it from `git.status`, and
// refreshes (debounced) on the sidecar's `git:status:changed` watcher event.
//
// Used to badge the "open Git" button in a session header; kept generic (takes a
// projectId getter) so any project-scoped surface can reuse it. Returns 0 when the
// sidecar is unavailable (browser dev) or the project has no repo.

type StatusFile = { changeType: string }
type GitStatus = { files: StatusFile[] }

export function useGitDirtyCount(projectId: () => string | undefined) {
  const sc = useSidecar()
  const { root } = useWorkspaceData(projectId)
  const dirtyCount = ref(0)

  async function load(): Promise<void> {
    if (!root.value || !sc.available) {
      dirtyCount.value = 0
      return
    }
    try {
      const res = await sc.request<GitStatus>('git.status', { workspaceRoot: root.value })
      dirtyCount.value = res.files.filter((f) => f.changeType !== 'ignored').length
    } catch (err) {
      // No repo / unavailable / any failure → treat as clean rather than throw.
      if (!(err instanceof SidecarUnavailableError)) dirtyCount.value = 0
    }
  }

  // Re-count when the root resolves (projects may hydrate after mount).
  watch(root, () => void load(), { immediate: true })

  // Debounced refresh on git status changes from the filesystem watcher.
  let unlisten: UnlistenFn | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  onMounted(async () => {
    if (!sc.available) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt.type !== 'git:status:changed') return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          void load()
        }, 200)
      })
    } catch {
      unlisten = null
    }
  })
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    if (unlisten) unlisten()
  })

  return { dirtyCount }
}
