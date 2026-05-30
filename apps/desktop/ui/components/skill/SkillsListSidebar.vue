<template>
  <div class="px-3 py-3 flex items-center gap-2" :style="{ borderBottom: `1px solid ${t.border}` }">
    <SearchInput
      :model-value="searchQuery"
      class="flex-1"
      placeholder="Search skills..."
      @update:model-value="(v: string) => $emit('update:search-query', v)"
    />
    <button
      class="flex items-center gap-1 px-2 py-1.5 text-xs rounded transition"
      :style="{
        background: 'transparent',
        color: t.textMuted,
        border: `1px solid ${t.border}`,
      }"
      :title="refreshTitle"
      :disabled="refreshing"
      @click="$emit('refresh')"
    >
      <RefreshCw :size="12" :class="refreshing ? 'animate-spin' : ''" />
    </button>
    <button
      ref="newButtonRef"
      class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded font-medium transition"
      :style="{ background: t.accent, color: t.accentText }"
      @click="$emit('new')"
    >
      <Plus :size="12" />
      New
    </button>
  </div>
  <div
    v-if="skills.length > 0"
    class="px-3 py-1.5 flex items-center gap-2 text-[0.79em]"
    :style="{ borderBottom: `1px solid ${t.border}`, color: t.textDim }"
  >
    <input
      type="checkbox"
      :checked="allFilteredSelected"
      :indeterminate.prop="someFilteredSelected && !allFilteredSelected"
      class="cursor-pointer"
      :style="{ accentColor: t.accent }"
      :title="allFilteredSelected ? 'Deselect all visible' : 'Select all visible'"
      @click="$emit('toggle-select-all')"
    />
    <span v-if="bulkSelection.size > 0" :style="{ color: t.text }">
      {{ bulkSelection.size }} selected
    </span>
    <span v-else>Select to bulk-delete</span>
    <span class="flex-1" />
    <button
      v-if="bulkSelection.size > 0"
      class="text-[0.71em] inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition"
      :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
      @click="$emit('clear-bulk')"
    >
      Clear
    </button>
  </div>
  <div class="flex-1 overflow-y-auto">
    <SkillsListItem
      v-for="skill in skills"
      :key="skillKey(skill)"
      :skill="skill"
      :selected="selectedKey === skillKey(skill)"
      :bulk-selected="bulkSelection.has(skillKey(skill))"
      :renaming="renamingKey === skillKey(skill)"
      :rename-value="renameValue"
      :agent-count="agentCountFor(skill.id)"
      :source-label="sourceLabel(skill)"
      :source-badge-style="sourceBadgeStyle(skill)"
      @select="(s: Skill) => $emit('select', s)"
      @context-menu="(e: MouseEvent, s: Skill) => $emit('context-menu', e, s)"
      @toggle-bulk="(s: Skill) => $emit('toggle-bulk', s)"
      @start-rename="(s: Skill) => $emit('start-rename', s)"
      @update:rename-value="(v: string) => $emit('update:rename-value', v)"
      @commit-rename="$emit('commit-rename')"
      @cancel-rename="$emit('cancel-rename')"
      @open-menu="(e: MouseEvent, s: Skill) => $emit('open-menu', e, s)"
      @rename-input-mounted="(el: HTMLInputElement | null) => $emit('rename-input-mounted', el)"
    />
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Plus, RefreshCw } from 'lucide-vue-next'
import type { Skill } from '~/types'

type Props = {
  skills: Skill[]
  selectedKey: string | null
  bulkSelection: Set<string>
  renamingKey: string | null
  renameValue: string
  refreshing: boolean
  refreshTitle: string
  searchQuery: string
  allFilteredSelected: boolean
  someFilteredSelected: boolean
  skillKey: (skill: Pick<Skill, 'id' | 'source' | 'projectId'>) => string
  agentCountFor: (id: string) => number
  sourceLabel: (skill: Skill) => string
  sourceBadgeStyle: (skill: Skill) => CSSProperties
}

defineProps<Props>()

defineEmits<{
  select: [skill: Skill]
  'context-menu': [event: MouseEvent, skill: Skill]
  'toggle-bulk': [skill: Skill]
  'start-rename': [skill: Skill]
  'update:rename-value': [v: string]
  'commit-rename': []
  'cancel-rename': []
  'open-menu': [event: MouseEvent, skill: Skill]
  'rename-input-mounted': [el: HTMLInputElement | null]
  'update:search-query': [v: string]
  refresh: []
  new: []
  'toggle-select-all': []
  'clear-bulk': []
}>()

const { t } = useTheme()

const newButtonRef = ref<HTMLButtonElement | null>(null)

defineExpose({ newButtonRef })
</script>
