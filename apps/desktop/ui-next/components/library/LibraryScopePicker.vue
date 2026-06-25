<template>
  <div class="lsp">
    <span class="lsp-label">{{ t('library.saveTo') }}</span>
    <AppSelect v-model="model" :options="options" width="100%" />
  </div>
</template>

<script setup lang="ts">
// Shared "Save to" tier picker for every library creator (skills, agents,
// commands, rules, hooks). Port of the old UI CreatorScopePicker. The bound
// value is 'global' (→ ~/.awog) or a projectId (→ {project}/.awog); callers map
// it to { source, projectId } before persisting. Uses AppSelect (no native
// <select>, per ui-next convention).
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'

const props = withDefaults(defineProps<{ projects?: { id: string; name: string }[] }>(), {
  projects: () => [],
})

const model = defineModel<string>({ required: true })

const { t } = useI18n()

const options = computed<AppSelectOption[]>(() => [
  { value: 'global', label: t('library.userGlobal') },
  ...props.projects.map((p) => ({ value: p.id, label: p.name })),
])
</script>

<style scoped>
.lsp {
  display: flex;
  align-items: center;
  gap: 10px;
}
.lsp-label {
  flex: 0 0 auto;
  font-size: 0.8846rem;
  color: var(--textDim);
}
.lsp :deep(.asel) {
  flex: 1;
  min-width: 0;
}
</style>
