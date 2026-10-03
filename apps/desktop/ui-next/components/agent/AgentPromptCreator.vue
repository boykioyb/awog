<template>
  <LibraryCreatorPanel
    :open="open"
    method="agents.author"
    :account="account"
    hide-scope
    :title="t('agents.creator.title')"
    :subtitle="t('agents.creator.subtitle')"
    :hint="t('agents.creator.hint')"
    :placeholder="t('agents.creator.placeholder')"
    :iterate-placeholder="t('agents.creator.iterate')"
    @close="emit('close')"
    @turn="emit('turn')"
  >
    <template #hint>
      {{ t('agents.creator.hint') }}
      <button class="apc-manual" @click="emit('manual')">
        {{ t('agents.creator.manual') }}
      </button>
    </template>
  </LibraryCreatorPanel>
</template>

<script setup lang="ts">
// Agent creation panel — thin wrapper over the generic LibraryCreatorPanel,
// configured for the `agents.author` streaming RPC. Agents are global roles:
// the scope picker is hidden (hide-scope) and the model writes the AGENT.md
// (YAML frontmatter + markdown body) to ~/.awog/agents; the page re-hydrates
// on close / each turn. Mirrors SkillPromptCreator.
import LibraryCreatorPanel from '~/components/library/LibraryCreatorPanel.vue'
import type { CreatorAccountKind, ProviderName } from '~/stores/settings'

defineProps<{
  open: boolean
  account: { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }
}>()

const emit = defineEmits<{ close: []; turn: []; manual: [] }>()

const { t } = useI18n()
</script>

<style scoped>
/* Link thoát sang form tay — nằm trong hint, mảnh để không đánh chiếm creator */
.apc-manual {
  display: inline;
  padding: 0;
  margin-left: 4px;
  background: none;
  border: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.apc-manual:hover {
  opacity: 0.8;
}
</style>
