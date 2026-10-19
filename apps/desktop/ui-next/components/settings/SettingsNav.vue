<template>
  <nav class="flex flex-col gap-2.5">
    <div v-for="g in groups" :key="g.id" class="flex flex-col gap-0.5">
      <div class="px-2.5 pt-1 pb-1 text-xs font-medium text-muted-foreground">
        {{ t(g.labelKey) }}
      </div>
      <Button
        v-for="s in g.items"
        :key="s.id"
        variant="ghost"
        size="sm"
        class="w-full justify-start gap-2 px-2.5 text-sm font-normal text-muted-foreground"
        :class="{
          'bg-selected font-medium text-foreground ring-1 ring-selected-border hover:bg-selected':
            s.id === active,
        }"
        :aria-current="s.id === active ? 'page' : undefined"
        @click="emit('select', s.id)"
      >
        <Icon :name="s.icon" class="size-3.5" />
        <span class="truncate">{{ t(s.labelKey) }}</span>
      </Button>
    </div>
  </nav>
</template>

<script setup lang="ts">
// Danh sách section của Settings, nhóm theo SETTINGS_GROUPS (nhãn nhóm muted kiểu
// sidebar shadcn). Mục đang chọn = accent-tint `bg-selected`. Khung chứa (rộng, viền,
// nền sidebar, cuộn) do nơi nhúng lo — SettingsModal / DocSettings.
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
