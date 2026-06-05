<template>
  <div
    class="h-screen w-full flex overflow-hidden"
    :style="{ background: t.bg, color: t.text, fontFamily: 'var(--font-sans)' }"
  >
    <NavRail />
    <div class="flex flex-col flex-1 overflow-hidden">
      <!-- <TopBar /> -->
      <UpdateBanner />
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Project } from '~/types'

const { t } = useTheme()

// NavRail dirty badge + ahead/behind chip need live `git.status` + `branches`
// regardless of which page is mounted. The store defaults to mock id `'prj1'`
// which matches the INITIAL_BRANCHES seed (one with ahead=2) — without
// selecting a real project first, the chip would show "↑2" everywhere until
// the user happens to visit `/git`. Hydrate + select + load here so any route
// boots with real numbers from the start.
const gitStore = useGitStore()
const workspace = useWorkspaceStore()
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  try {
    if (workspace.projects.length === 0) {
      await workspace.hydrateProjectsFromSidecar()
    }
    const hasSelected = workspace.projects.some((p: Project) => p.id === gitStore.selectedProjectId)
    if (!hasSelected && workspace.projects.length > 0) {
      gitStore.setSelectedProject(workspace.projects[0]!.id)
    }
    await Promise.all([gitStore.loadStatus(), gitStore.loadBranches()])
  } catch {
    // Silent: sidecar unavailable in dev browser, or no workspace yet.
  }
  try {
    unsubscribe = await gitStore.subscribe()
  } catch {
    // Silent: sidecar unavailable; the page-level subscribe in /git is a
    // no-op too, so badge stays at the seed values.
  }
})

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})
</script>
