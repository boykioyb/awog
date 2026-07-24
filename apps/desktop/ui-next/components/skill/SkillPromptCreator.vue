<template>
  <LibraryCreatorPanel
    :open="open"
    method="skills.author"
    :account="account"
    :projects="projects"
    :initial-scope="initialScope"
    :title="t('skills.creator.title')"
    :subtitle="t('skills.creator.subtitle')"
    :hint="t('skills.creator.hint')"
    :placeholder="t('skills.creator.placeholder')"
    :iterate-placeholder="t('skills.creator.iterate')"
    @close="emit('close')"
    @turn="emit('turn')"
  />
</template>

<script setup lang="ts">
// Skill creation panel — thin wrapper over the generic LibraryCreatorPanel,
// configured for the `skills.author` streaming RPC. The model writes a SKILL.md
// to the chosen scope's dir; the page re-hydrates on close / each turn. This is
// the reference each sibling feature mirrors (swap method + i18n keys).
import LibraryCreatorPanel from '~/components/library/LibraryCreatorPanel.vue'
import type { CreatorAccountKind, ProviderName } from '~/stores/settings'

withDefaults(
  defineProps<{
    open: boolean
    account: { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }
    projects: { id: string; name: string }[]
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{ close: []; turn: [] }>()

const { t } = useI18n()
</script>
