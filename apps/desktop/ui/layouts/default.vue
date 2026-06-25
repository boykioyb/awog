<template>
  <div
    class="h-screen w-full flex flex-row overflow-hidden gap-2 p-2"
    :style="{ background: appBackground, color: t.text, fontFamily: 'var(--font-sans)' }"
  >
    <NavRail />
    <div class="flex-1 flex flex-col overflow-hidden min-h-0 gap-2">
      <AppTopBar @open-search="searchOpen = true" />
      <UpdateBanner />
      <QuotaBanner />
      <main class="flex-1 flex flex-col overflow-hidden min-h-0">
        <slot />
      </main>
    </div>
    <SessionSearchPalette :open="searchOpen" @close="searchOpen = false" />
    <SettingsModal />
  </div>
</template>

<script setup lang="ts">
import type { Project } from '~/types'

const { t } = useTheme()
const { appBackground } = useGlass()

// Cmd/Ctrl+K opens the cross-session search palette from anywhere in the app.
const searchOpen = ref(false)
const onGlobalKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    searchOpen.value = !searchOpen.value
  }
}

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
  window.addEventListener('keydown', onGlobalKeydown)
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
  window.removeEventListener('keydown', onGlobalKeydown)
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
})
</script>
