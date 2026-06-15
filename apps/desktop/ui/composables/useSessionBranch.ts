import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from 'vue'
import { useGitApi, type SidecarGitBranch } from '~/composables/useGitApi'
import { SidecarError, SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

const gitCodeOf = (err: unknown): string | null => {
  if (!(err instanceof SidecarError)) return null
  return (err.data as { gitCode?: string } | undefined)?.gitCode ?? null
}

// Lightweight, session-scoped git branch reader + quick switcher. Talks to the
// sidecar directly (like WorkspaceDiffTab) instead of the global git store, so
// it stays pinned to THIS session's project path and never mutates the Git
// page's selection. The full manager (stage/commit/history) lives in the
// SessionGitModal which does drive the global store. `git:status:changed`
// notifications (HEAD/refs touched — including a checkout done in the modal or
// an external terminal) refresh the branch list automatically.
export function useSessionBranch(workspaceRoot: MaybeRefOrGetter<string | null>) {
  const api = useGitApi()

  const branches = ref<SidecarGitBranch[]>([])
  const loading = ref(false)
  const noRepo = ref(false)
  // Set when a quick switch is refused because the working tree is dirty — the
  // dropdown surfaces a notice that points the user at the full Git manager
  // (force/stash recovery lives there, not in the inline switcher).
  const dirtyBranch = ref<string | null>(null)

  const currentInfo = computed(() => branches.value.find((b) => b.isCurrent && b.kind === 'local'))
  const currentBranch = computed(() => currentInfo.value?.name ?? null)
  const ahead = computed(() => currentInfo.value?.ahead ?? 0)
  const behind = computed(() => currentInfo.value?.behind ?? 0)
  const localBranches = computed(() => branches.value.filter((b) => b.kind === 'local'))

  const load = async () => {
    const root = toValue(workspaceRoot)
    if (!root) {
      branches.value = []
      noRepo.value = false
      return
    }
    loading.value = true
    try {
      const result = await api.branchList(root)
      branches.value = result.branches
      noRepo.value = false
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return
      if (gitCodeOf(err) === 'NO_REPO') {
        branches.value = []
        noRepo.value = true
        return
      }
      // Any other failure: leave the last good list, don't surface noise.
      console.warn('[session-branch] load failed', err)
    } finally {
      loading.value = false
    }
  }

  // Clean-tree branch switch. A dirty working tree (DIRTY_TREE) is reported via
  // `dirtyBranch` rather than force-discarding — the safe default. Returns true
  // on a successful checkout so the caller can close its dropdown.
  const switchBranch = async (name: string): Promise<boolean> => {
    const root = toValue(workspaceRoot)
    if (!root || name === currentBranch.value) return false
    dirtyBranch.value = null
    try {
      await api.branchCheckout(root, { name })
      await load()
      return true
    } catch (err) {
      if (err instanceof SidecarUnavailableError) return false
      if (gitCodeOf(err) === 'DIRTY_TREE') {
        dirtyBranch.value = name
        return false
      }
      console.warn('[session-branch] checkout failed', err)
      return false
    }
  }

  const clearDirty = () => {
    dirtyBranch.value = null
  }

  // Subscribe to sidecar status changes (debounced) so the chip reflects a
  // checkout made elsewhere without a manual refresh.
  let unlisten: (() => void) | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const subscribe = async () => {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    unlisten = await sidecar.onEvent((evt) => {
      const typed = evt as unknown as { type?: string; method?: string }
      if ((typed.type ?? typed.method) !== 'git:status:changed') return
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        load().catch(() => undefined)
      }, 200)
    })
  }

  watch(
    () => toValue(workspaceRoot),
    () => {
      dirtyBranch.value = null
      load()
    },
  )

  onMounted(() => {
    load()
    subscribe()
  })

  onBeforeUnmount(() => {
    if (refreshTimer) clearTimeout(refreshTimer)
    if (unlisten) unlisten()
  })

  return {
    branches,
    localBranches,
    currentBranch,
    ahead,
    behind,
    loading,
    noRepo,
    dirtyBranch,
    load,
    switchBranch,
    clearDirty,
  }
}
