<template>
  <GitPrSummaryModal
    :open="open"
    :head="head"
    :branches="store.branches"
    :current-branch="store.branch"
    :project-id="store.currentProjectId"
    :rule-files="store.listPrRuleFiles"
    :generate="store.generatePrSummary"
    @close="prSummary.close()"
  />
</template>

<script setup lang="ts">
// App-wide host for the PR summary modal — mounted once in the default layout so
// ⌘I (from a session) can open it without going through Git Manager first. Reads
// the shared usePrSummaryModal state, scopes the (singleton) git store to the
// requested project, resolves the head branch (context-menu override, else the
// current branch), then renders the same GitPrSummaryModal the Git Manager uses.
import { computed, ref, watch } from 'vue'
import GitPrSummaryModal from '~/components/git/GitPrSummaryModal.vue'
import { useGitStore } from '~/stores/git'
import { usePrSummaryModal } from '~/composables/usePrSummaryModal'

const prSummary = usePrSummaryModal()
const store = useGitStore()

// Gate the modal on `ready` so it only mounts (and auto-loads rule files) once the
// store is scoped + the head branch resolved — never on a stale/empty project.
const ready = ref(false)
const head = ref('')
const open = computed(() => prSummary.isOpen.value && ready.value)

watch(
  () => prSummary.isOpen.value,
  async (isOpen) => {
    if (!isOpen) {
      ready.value = false
      return
    }
    ready.value = false
    await store.ensureScoped(prSummary.projectId.value)
    head.value = prSummary.headOverride.value || store.branch
    ready.value = true
  },
)
</script>
