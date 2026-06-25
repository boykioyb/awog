<template>
  <nav class="setnav">
    <div
      v-for="s in sections"
      :key="s.id"
      class="setni"
      :class="{ on: s.id === active }"
      @click="emit('select', s.id)"
    >
      <Icon :name="s.icon" style="width: 14px; height: 14px" />
      <span>{{ t(s.labelKey) }}</span>
    </div>
  </nav>
</template>

<script setup lang="ts">
// Settings section list — ports SETSECS + the .setni nav from renderSet().
import type { SettingsSection, SettingsSectionId } from './sections'

defineProps<{
  sections: readonly SettingsSection[]
  active: SettingsSectionId
}>()

const emit = defineEmits<{
  select: [id: SettingsSectionId]
}>()

const { t } = useI18n()
</script>
