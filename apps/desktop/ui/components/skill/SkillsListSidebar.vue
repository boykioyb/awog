<template>
  <div class="px-3 py-3 flex items-center gap-2" :style="{ borderBottom: `1px solid ${t.border}` }">
    <SearchInput
      :model-value="searchQuery"
      class="flex-1"
      placeholder="Search skills..."
      @update:model-value="(v: string) => $emit('update:search-query', v)"
    />
    <button
      class="flex items-center gap-1 px-2 py-1.5 text-[1em] rounded transition"
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
      class="p-1.5 rounded transition"
      :style="{ color: t.textDim }"
      title="New skill"
      @click="$emit('new')"
      @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
      @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
    >
      <Plus :size="14" />
    </button>
  </div>
  <div
    v-if="groups.length > 0"
    class="px-3 py-1.5 flex items-center gap-2 text-[1em]"
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
    <template v-if="showHeaders">
      <button
        class="p-1 rounded transition opacity-60 hover:opacity-100"
        :style="{ color: t.textDim }"
        title="Collapse all groups"
        @click="collapseAll"
      >
        <ChevronsDownUp :size="13" />
      </button>
      <button
        class="p-1 rounded transition opacity-60 hover:opacity-100"
        :style="{ color: t.textDim }"
        title="Expand all groups"
        @click="expandAll"
      >
        <ChevronsUpDown :size="13" />
      </button>
    </template>
    <button
      v-if="bulkSelection.size > 0"
      class="text-[1em] inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition"
      :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
      @click="$emit('clear-bulk')"
    >
      Clear
    </button>
  </div>
  <div class="flex-1 overflow-y-auto">
    <div
      v-for="(group, gi) in groups"
      :key="group.key"
      :style="{ marginTop: gi > 0 ? '4px' : '0' }"
    >
      <button
        v-if="showHeaders"
        class="w-full px-3 py-1.5 flex items-center gap-1.5 transition"
        :style="{
          color: t.textDim,
          background: groupHover === group.key ? t.bgHover : 'transparent',
        }"
        @click="toggleGroup(group.key)"
        @mouseenter="groupHover = group.key"
        @mouseleave="groupHover = null"
      >
        <ChevronDown
          :size="10"
          :style="{
            transform: collapsedGroups[group.key] ? 'rotate(-90deg)' : 'none',
            transition: 'transform 0.15s',
          }"
        />
        <span class="text-[12px] uppercase tracking-wider font-medium flex-1 text-left truncate">
          {{ group.label }}
        </span>
        <span class="text-[12px] font-mono leading-none" :style="{ color: t.textFaint }">
          {{ group.skills.length }}
        </span>
      </button>
      <template v-if="!showHeaders || !collapsedGroups[group.key]">
        <SkillsListItem
          v-for="skill in group.skills"
          :key="skillKey(skill)"
          :skill="skill"
          :selected="selectedKey === skillKey(skill)"
          :bulk-selected="bulkSelection.has(skillKey(skill))"
          :renaming="renamingKey === skillKey(skill)"
          :rename-value="renameValue"
          :source-label="sourceLabel(skill)"
          :source-badge-style="sourceBadgeStyle(skill)"
          :in-group="showHeaders"
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
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Plus, RefreshCw } from 'lucide-vue-next'
import type { Skill } from '~/types'
import type { SkillGroup } from '~/composables/useSkillsManager'

type Props = {
  groups: SkillGroup[]
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
  sourceLabel: (skill: Skill) => string
  sourceBadgeStyle: (skill: Skill) => CSSProperties
}

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

const props = defineProps<Props>()

// Collapse + hover are pure view state local to this list. A single group
// (e.g. only user/global skills, no projects) reads as a flat list — no header.
const collapsedGroups = ref<Record<string, boolean>>({})
const groupHover = ref<string | null>(null)
const showHeaders = computed(() => props.groups.length > 1)

const toggleGroup = (key: string) => {
  collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
}

const collapseAll = () => {
  collapsedGroups.value = Object.fromEntries(props.groups.map((g: SkillGroup) => [g.key, true]))
}

const expandAll = () => {
  collapsedGroups.value = {}
}

const newButtonRef = ref<HTMLButtonElement | null>(null)

defineExpose({ newButtonRef })
</script>
