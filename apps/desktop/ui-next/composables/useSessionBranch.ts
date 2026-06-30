import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SidecarError, useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { useGitApi } from '~/composables/useGitApi'
import { useWorkspaceData } from '~/composables/useWorkspaceData'

// Current branch + quick local-branch switch for a project's repo. Mirrors
// useGitDirtyCount: resolves the project's workspace root (useWorkspaceData), reads
// branches from `git.branchList`, and refreshes (debounced) on the sidecar's
// `git:status:changed` watcher event (a checkout elsewhere triggers it). `checkout`
// runs `git.branchCheckout` against that root then reloads.
//
// Decoupled from the global `git` Pinia store (which is pinned to ONE selected
// workspace) so the status bar can show the active session's branch regardless of
// which project the Git page last opened. Returns null branch / empty list when the
// sidecar is unavailable (browser-dev) or the project has no repo.

// gitCode (DIRTY_TREE / …) out of a SidecarError, when present.
function gitCodeOf(err: unknown): string | null {
  if (err instanceof SidecarError && err.data && typeof err.data === 'object') {
    const c = (err.data as { gitCode?: unknown }).gitCode
    return typeof c === 'string' ? c : null
  }
  return null
}

export function useSessionBranch(projectId: () => string | undefined) {
  const sc = useSidecar()
  const api = useGitApi()
  const { confirm } = useConfirm()
  const { t } = useI18n()
  const { root } = useWorkspaceData(projectId)
  const branch = ref<string | null>(null)
  const localBranches = ref<string[]>([])
  const loading = ref(false)
  const switching = ref(false)

  async function load(): Promise<void> {
    if (!root.value || !sc.available) {
      branch.value = null
      localBranches.value = []
      return
    }
    loading.value = true
    try {
      const res = await api.branchList(root.value)
      const locals = res.branches.filter((b) => b.kind === 'local')
      localBranches.value = locals.map((b) => b.name)
      branch.value = locals.find((b) => b.isCurrent)?.name ?? null
    } catch {
      // No repo / detached / unavailable → treat as "no branch" rather than throw.
      branch.value = null
      localBranches.value = []
    } finally {
      loading.value = false
    }
  }

  async function checkout(name: string): Promise<void> {
    if (!root.value || !sc.available || name === branch.value) return
    const repoRoot = root.value
    switching.value = true
    try {
      await api.branchCheckout(repoRoot, { name })
      branch.value = name // optimistic; load() confirms below
    } catch (err) {
      // `git checkout` refuses to clobber a dirty tree — offer to stash first
      // (incl. untracked, which may be the blocker) then retry, mirroring the
      // Git Manager flow. Other failures just log.
      if (gitCodeOf(err) !== 'DIRTY_TREE') {
        console.warn('[statusbar] branch checkout failed', err)
        return
      }
      const ok = await confirm({
        title: t('git.checkoutDirty.title'),
        description: t('git.checkoutDirty.desc', { name }),
        kind: 'primary',
        confirmLabel: t('git.checkoutDirty.stashSwitch'),
      })
      if (!ok) return
      try {
        await api.stashSave(repoRoot, {
          message: `WIP on ${branch.value || 'HEAD'}`,
          includeUntracked: true,
        })
        await api.branchCheckout(repoRoot, { name })
        branch.value = name
      } catch (err2) {
        console.warn('[statusbar] stash & switch failed', err2)
      }
    } finally {
      switching.value = false
      void load()
    }
  }

  // Re-load when the root resolves (projects may hydrate after mount).
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

  return { branch, localBranches, loading, switching, checkout }
}
