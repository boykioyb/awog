<template>
  <LibraryCreatorPanel
    :open="open"
    method="agents.author"
    :account-id="accountId"
    :projects="projects"
    :initial-scope="initialScope"
    :title="t('agents.creator.title')"
    :subtitle="t('agents.creator.subtitle')"
    :hint="t('agents.creator.hint')"
    :placeholder="t('agents.creator.placeholder')"
    :iterate-placeholder="t('agents.creator.iterate')"
    @close="emit('close')"
    @turn="emit('turn')"
  />
</template>

<script setup lang="ts">
// Agent creation panel — thin wrapper over the generic LibraryCreatorPanel,
// configured for the `agents.author` streaming RPC. The model writes an
// AGENT.md (YAML frontmatter + markdown body) to the chosen scope's dir; the
// page re-hydrates on close / each turn. Mirrors SkillPromptCreator.
import LibraryCreatorPanel from '~/components/library/LibraryCreatorPanel.vue'

withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{ close: []; turn: [] }>()

const { t } = useI18n()
</script>
