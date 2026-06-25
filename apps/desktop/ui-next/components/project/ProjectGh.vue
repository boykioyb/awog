<template>
  <div class="projmain">
    <ProjectIssues
      :kind="kind"
      :items="gh.visibleItems.value"
      :loading="gh.loading.value"
      :error-code="gh.errorCode.value"
      :state-filter="gh.stateFilter.value"
      :assignee="gh.assigneeFilter.value"
      :search="gh.searchQuery.value"
      :account="gh.account.value"
      :accounts="accountLogins"
      :known-assignees="gh.knownAssignees.value"
      @open="gh.open"
      @refresh="gh.refresh"
      @set-state="gh.setStateFilter"
      @set-assignee="gh.setAssigneeFilter"
      @set-account="gh.setAccount"
      @set-search="(v) => (gh.searchQuery.value = v)"
    />
    <ProjectGhDrawer
      v-if="gh.drawerOpen.value"
      :thread="gh.selected.value"
      :kind="kind"
      :loading="gh.detailLoading.value"
      :width="400"
      :view-lang="gh.viewLang.value"
      :segment="gh.segmentTranslation"
      @close="gh.closeDrawer"
      @set-lang="gh.setViewLang"
    />
  </div>
</template>

<script setup lang="ts">
// GitHub Issues / PR tab — wires the useProjectGh controller (live gh.* RPC) and
// composes the presentational list + drawer. Loads the gh CLI account roster once
// for the account picker. `kind` selects issues vs pull requests.
import { onMounted, ref } from 'vue'
import ProjectGhDrawer from './ProjectGhDrawer.vue'
import ProjectIssues from './ProjectIssues.vue'
import { useProjectGh, type GhAccount, type GhKind } from '~/composables/useProjectGh'
import { useSidecar } from '~/composables/useSidecar'

const props = defineProps<{ projectId: string; kind: GhKind }>()

const sc = useSidecar()
const gh = useProjectGh(() => props.projectId, props.kind)

// gh CLI accounts (login only — never a token). Best-effort; empty in browser-dev.
const accountLogins = ref<string[]>([])
onMounted(async () => {
  if (!sc.available) return
  try {
    const res = await sc.request<{ accounts: GhAccount[] }>('gh.accounts', {})
    accountLogins.value = res.accounts.map((a) => a.login)
  } catch {
    accountLogins.value = []
  }
})
</script>
