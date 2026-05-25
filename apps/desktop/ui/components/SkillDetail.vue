<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Wand2 :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-mono font-semibold" :style="{ color: t.text }">
            {{ skill.name }}
          </h1>
          <span
            class="text-[11px] px-1.5 py-0.5 rounded"
            :style="{
              background: t.bgInput,
              color: t.textMuted,
              border: `1px solid ${t.border}`,
            }"
          >
            {{ skill.category }}
          </span>
        </div>
        <div class="text-[13px] leading-relaxed" :style="{ color: t.textMuted }">
          {{ skill.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @mouseenter="
            (e: MouseEvent) => ((e.currentTarget as HTMLElement).style.background = t.bgHover)
          "
          @mouseleave="
            (e: MouseEvent) => ((e.currentTarget as HTMLElement).style.background = 'transparent')
          "
          @click="emit('edit')"
        >
          <Edit3 :size="11" />
          Edit
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          @mouseenter="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = t.dangerBg
              el.style.color = t.danger
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      <div
        class="rounded p-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <div
          class="text-[10px] uppercase tracking-wider font-medium mb-2"
          :style="{ color: t.textDim }"
        >
          Inputs
        </div>
        <div class="space-y-1">
          <div
            v-for="inp in skill.inputs"
            :key="inp"
            class="text-[11px] font-mono flex items-center gap-1.5"
            :style="{ color: t.text }"
          >
            <Hash :size="9" :style="{ color: t.textDim }" />
            {{ inp }}
          </div>
        </div>
      </div>
      <div
        class="rounded p-3"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <div
          class="text-[10px] uppercase tracking-wider font-medium mb-2"
          :style="{ color: t.textDim }"
        >
          Outputs
        </div>
        <div class="space-y-1">
          <div
            v-for="out in skill.outputs"
            :key="out"
            class="text-[11px] font-mono flex items-center gap-1.5"
            :style="{ color: t.text }"
          >
            <FileText :size="9" :style="{ color: t.textDim }" />
            {{ out }}
          </div>
        </div>
      </div>
    </div>

    <div class="mb-6">
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Prompt Template
      </div>
      <pre
        class="text-[11px] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          margin: 0,
        }"
        >{{ skill.promptTemplate }}</pre
      >
    </div>

    <div class="mb-6">
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Tags
      </div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="tag in skill.tags"
          :key="tag"
          class="text-[10px] px-1.5 py-0.5 rounded"
          :style="{
            background: t.bgInput,
            color: t.textMuted,
            border: `1px solid ${t.border}`,
          }"
        >
          #{{ tag }}
        </span>
      </div>
    </div>

    <div>
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Used by · {{ agentsUsing.length }} agents
      </div>
      <div v-if="agentsUsing.length === 0" class="text-[11px]" :style="{ color: t.textFaint }">
        Not assigned to any agent yet
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="agent in agentsUsing"
          :key="agent.id"
          class="flex items-center gap-2.5 p-2.5 rounded"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <div class="flex-shrink-0 flex justify-center" :style="{ width: colWidth + 'px' }">
            <RoleBadge :role="agent.role" />
          </div>
          <div class="flex-1">
            <div class="text-[12px] font-medium" :style="{ color: t.text }">
              {{ agent.name }}
            </div>
            <div class="text-[10px]" :style="{ color: t.textDim }">
              {{ MODELS.find((m) => m.id === agent.model)?.label }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Wand2, Edit3, Trash2, Hash, FileText } from 'lucide-vue-next'
import type { Agent, Skill } from '~/types'
import { MODELS } from '~/utils/models'
import { calcBadgeColWidth } from '~/utils/graph'

const props = defineProps<{
  skill: Skill
}>()

const emit = defineEmits<{
  edit: []
  delete: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const agentsUsing = computed<Agent[]>(() =>
  ws.agents.filter((a) => a.skillIds.includes(props.skill.id)),
)

const colWidth = computed(() => calcBadgeColWidth(agentsUsing.value.map((a) => a.role)))
</script>
