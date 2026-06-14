<template>
  <div class="flex items-center gap-2">
    <span class="text-[1em] flex-shrink-0" :style="{ color: t.textDim }">
      {{ tr('creator.save_to') }}
    </span>
    <AppSelect :model-value="modelValue" class="flex-1 min-w-0" @update:model-value="onChange">
      <option value="global">{{ tr('common.user_global') }}</option>
      <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
    </AppSelect>
  </div>
</template>

<script setup lang="ts">
// Shared "Save to" scope picker for every LLM-driven creator (agents, skills,
// rules, commands, hooks, workflows). The bound value is `'global'` or a
// projectId — callers map it to { source, projectId } before persisting.
withDefaults(defineProps<{ modelValue: string; projects?: { id: string; name: string }[] }>(), {
  projects: () => [],
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

const onChange = (value: string) => emit('update:modelValue', value)
</script>
