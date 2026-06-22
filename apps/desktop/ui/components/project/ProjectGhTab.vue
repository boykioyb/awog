<!--
  Container for one Project GitHub tab (Issues OR Pull Requests, by `kind`).
  Owns the gh.accounts load + account picker (bound to the app-level settings
  store), lazy first fetch, and the list + resizable drawer. All data logic
  lives in useProjectGh; this component wires events → composable actions. The
  drawer's language tabs drive translation (errors show inline per segment).
-->
<template>
  <div class="relative flex flex-col h-full min-h-0">
    <!-- Account picker (shared header for both tabs) -->
    <div
      v-if="accounts.length > 0"
      class="flex-shrink-0 px-1 pb-3 flex items-center justify-between gap-2"
    >
      <ProjectGhAccountPicker
        :accounts="accounts"
        :model-value="settingsStore.githubAccount"
        @update:model-value="onAccountChange"
      />
    </div>

    <ProjectGhList
      class="flex-1 min-h-0"
      :kind="kind"
      :items="gh.visibleItems.value"
      :loading="gh.loading.value"
      :error-code="gh.errorCode.value"
      :state-filter="gh.stateFilter.value"
      :assignee-filter="gh.assigneeFilter.value"
      :known-assignees="gh.knownAssignees.value"
      :search-query="gh.searchQuery.value"
      @update:state="gh.setStateFilter"
      @update:assignee="gh.setAssigneeFilter"
      @update:search="(v: string) => (gh.searchQuery.value = v)"
      @refresh="() => gh.refresh({ force: true })"
      @select="gh.open"
    />

    <ProjectGhDrawer
      v-if="gh.drawerOpen.value"
      :kind="kind"
      :thread="gh.selected.value"
      :loading="gh.detailLoading.value"
      :view-lang="gh.viewLang.value"
      :segment-translation="gh.segmentTranslation"
      @close="gh.closeDrawer"
      @set-view-lang="gh.setViewLang"
    />
  </div>
</template>

<script setup lang="ts">
import type { GhAccount, GhThreadKind, Project } from '~/types'
import { useProjectGh } from '~/composables/useProjectGh'

const props = defineProps<{
  project: Project
  kind: GhThreadKind
}>()

const sidecar = useSidecar()
const settingsStore = useSettingsStore()

const gh = useProjectGh(props.project.id, props.kind)

const accounts = ref<GhAccount[]>([])
let accountsLoaded = false

// Load the gh account list once per mount of a GitHub tab, then default the
// app-level selection to the active account when none is stored yet.
const loadAccounts = async () => {
  if (accountsLoaded || !sidecar.available) return
  accountsLoaded = true
  try {
    const res = await sidecar.request<{ accounts: GhAccount[] }>('gh.accounts', {})
    accounts.value = res.accounts
    if (!settingsStore.githubAccount) {
      const active = res.accounts.find((a) => a.active)
      if (active) settingsStore.setGithubAccount(active.login)
    }
  } catch {
    // gh missing / not authed — refresh() will set the matching error state, so
    // leave the account list empty and skip the picker.
    accountsLoaded = false
  }
}

const onAccountChange = (login: string) => {
  settingsStore.setGithubAccount(login)
  void gh.refresh()
}

onMounted(async () => {
  await loadAccounts()
  await gh.refresh()
})
</script>
