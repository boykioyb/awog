<template>
  <LibraryCreatorPanel
    :open="open"
    method="source.author"
    :account-id="accountId"
    :title="t('connections.creator.title')"
    :subtitle="t('connections.creator.subtitle')"
    :hint="t('connections.creator.hint')"
    :placeholder="t('connections.creator.placeholder')"
    :iterate-placeholder="t('connections.creator.iterate')"
    @close="emit('close')"
    @turn="emit('turn')"
  />
</template>

<script setup lang="ts">
// Source creation panel — thin wrapper over the generic LibraryCreatorPanel,
// configured for the `source.author` streaming RPC (ADR 0060 P1). The model
// writes a sources/<slug>/config.json via the Write tool; the page re-hydrates on
// close / each turn. Sources are global-only, so no scope picker projects are
// passed (the panel defaults scope to 'global').
import LibraryCreatorPanel from '~/components/library/LibraryCreatorPanel.vue'

defineProps<{
  open: boolean
  accountId: string | null
}>()

const emit = defineEmits<{ close: []; turn: [] }>()

const { t } = useI18n()
</script>
