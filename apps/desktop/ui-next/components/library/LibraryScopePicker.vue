<template>
  <div class="flex items-center gap-2.5">
    <span class="flex-none text-sm font-medium text-dim">{{ t('library.saveTo') }}</span>
    <div class="min-w-0 flex-1">
      <AppSelect v-model="model" :options="options" width="100%" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Shared "Save to" tier picker for every library creator (skills, agents,
// commands, rules, hooks). Port of the old UI CreatorScopePicker. The bound
// value is 'global' (→ ~/.awog) or a projectId (→ {project}/.awog); callers map
// it to { source, projectId } before persisting. Uses AppSelect (không dùng
// select gốc của trình duyệt, theo quy ước ui-next).
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
