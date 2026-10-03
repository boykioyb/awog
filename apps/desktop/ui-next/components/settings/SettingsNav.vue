<template>
  <nav class="setnav">
    <div v-for="g in groups" :key="g.id" class="setgroup">
      <div class="setgl">{{ t(g.labelKey) }}</div>
      <div
        v-for="s in g.items"
        :key="s.id"
        class="setni"
        :class="{ on: s.id === active }"
        @click="emit('select', s.id)"
      >
        <Icon :name="s.icon" class="size-3.5" />
        <span>{{ t(s.labelKey) }}</span>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
// Settings section list — nhóm theo SETTINGS_GROUPS (label nhóm kiểu sidebar
// shadcn: uppercase nhỏ, muted). `.setni`/`.setnav` giữ tên class vì
// theme-cute.css deep-select vào chúng.
import type { SettingsGroup, SettingsSectionId } from './sections'

defineProps<{
  groups: readonly SettingsGroup[]
  active: SettingsSectionId
}>()

const emit = defineEmits<{
  select: [id: SettingsSectionId]
}>()

const { t } = useI18n()
</script>
