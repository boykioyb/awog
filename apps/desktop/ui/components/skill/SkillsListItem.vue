<template>
  <div
    class="w-full px-3 py-2 cursor-pointer transition"
    :style="{
      background: selected ? t.bgActive : 'transparent',
      borderBottom: `1px solid ${t.border}`,
      borderLeft: `2px solid ${selected ? t.accent : 'transparent'}`,
    }"
    @click="$emit('select', skill)"
    @contextmenu="$emit('context-menu', $event, skill)"
    @mouseenter="
      (e: MouseEvent) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = t.bgHover
      }
    "
    @mouseleave="
      (e: MouseEvent) => {
        if (!selected) (e.currentTarget as HTMLElement).style.background = 'transparent'
      }
    "
  >
    <div class="flex items-center gap-2 mb-0.5">
      <input
        type="checkbox"
        :checked="bulkSelected"
        class="cursor-pointer flex-shrink-0"
        :style="{ accentColor: t.accent }"
        :title="bulkSelected ? 'Remove from selection' : 'Add to selection'"
        @click.stop="$emit('toggle-bulk', skill)"
      />
      <span v-if="skill.icon" class="text-[1em]">{{ skill.icon }}</span>
      <Wand2 v-else :size="11" :style="{ color: t.textDim }" />
      <input
        v-if="renaming"
        :ref="onRenameInputMounted"
        :value="renameValue"
        class="text-[1em] font-mono flex-1 rounded px-1 py-0.5"
        :style="{
          background: t.bgInput,
          border: `1px solid ${t.borderStrong}`,
          color: t.text,
          outline: 'none',
        }"
        @click.stop
        @input="(e: Event) => $emit('update:rename-value', (e.target as HTMLInputElement).value)"
        @keydown.enter="$emit('commit-rename')"
        @keydown.escape="$emit('cancel-rename')"
        @blur="$emit('commit-rename')"
      />
      <span
        v-else
        class="text-[1em] font-mono flex-1 truncate"
        :style="{ color: t.text }"
        @dblclick.stop="$emit('start-rename', skill)"
      >
        {{ skill.name }}
      </span>
      <button
        class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
        :style="{ color: t.textMuted }"
        title="Actions"
        @click.stop="$emit('open-menu', $event, skill)"
      >
        <MoreHorizontal :size="13" />
      </button>
    </div>
    <div class="flex items-center gap-1.5 pl-5">
      <span class="text-[1em] font-mono truncate flex-1 min-w-0" :style="{ color: t.textDim }">
        /{{ skill.id }}
      </span>
      <span
        class="text-[0.7em] px-1 py-0.5 rounded font-mono uppercase tracking-wider whitespace-nowrap flex-shrink-0"
        :style="sourceBadgeStyle"
      >
        {{ sourceLabel }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { MoreHorizontal, Wand2 } from 'lucide-vue-next'
import type { Skill } from '~/types'

type Props = {
  skill: Skill
  selected: boolean
  bulkSelected: boolean
  renaming: boolean
  renameValue: string
  sourceLabel: string
  sourceBadgeStyle: CSSProperties
}

defineProps<Props>()

const emit = defineEmits<{
  select: [skill: Skill]
  'context-menu': [event: MouseEvent, skill: Skill]
  'toggle-bulk': [skill: Skill]
  'start-rename': [skill: Skill]
  'update:rename-value': [v: string]
  'commit-rename': []
  'cancel-rename': []
  'open-menu': [event: MouseEvent, skill: Skill]
  'rename-input-mounted': [el: HTMLInputElement | null]
}>()

const { t } = useTheme()

const onRenameInputMounted = (el: unknown) => {
  emit('rename-input-mounted', el instanceof HTMLInputElement ? el : null)
}
</script>
