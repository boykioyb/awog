<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl w-full">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="rounded flex items-center justify-center text-[1em] font-bold flex-shrink-0"
        :style="{
          minWidth: '48px',
          height: '48px',
          padding: (agent.role || '').length > 3 ? '0 10px' : '0',
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          color: t.textMuted,
        }"
      >
        {{ agent.role }}
      </div>
      <div class="flex-1 min-w-0">
        <h1 class="text-lg font-semibold mb-1" :style="{ color: t.text }">{{ agent.name }}</h1>
        <div class="text-[1em] inline-flex items-center gap-1.5" :style="{ color: t.textDim }">
          <Sparkles :size="11" />
          {{ model?.label }}
          <span :style="{ color: t.textFaint }">·</span>
          <span>{{ model?.vendor }}</span>
          <span :style="{ color: t.textFaint }">·</span>
          <span class="font-mono">{{ agent.id }}</span>
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Duplicate"
          @click="emit('duplicate')"
          @mouseenter="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = t.bgHover
              ;(e.currentTarget as HTMLElement).style.color = t.text
            }
          "
          @mouseleave="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = t.textDim
            }
          "
        >
          <Copy :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Edit"
          @click="emit('edit')"
          @mouseenter="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = t.bgHover
              ;(e.currentTarget as HTMLElement).style.color = t.text
            }
          "
          @mouseleave="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = t.textDim
            }
          "
        >
          <Edit3 :size="13" />
        </button>
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Delete"
          @click="emit('delete')"
          @mouseenter="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = t.dangerBg
              ;(e.currentTarget as HTMLElement).style.color = t.danger
            }
          "
          @mouseleave="
            (e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = t.textDim
            }
          "
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </div>

    <div class="mb-6">
      <MarkdownBodyView
        title="System Prompt"
        :content="agent.systemPrompt ?? ''"
        empty-text="(no system prompt — click Edit to draft one)"
        allow-edit
        edit-title="Revise system prompt via LLM"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />
    </div>

    <div v-if="agent.mcpServerIds && agent.mcpServerIds.length > 0" class="mb-6">
      <div
        class="text-[1em] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        MCP Servers · {{ agent.mcpServerIds.length }} allowed
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="id in agent.mcpServerIds"
          :key="id"
          class="inline-flex items-center gap-1.5 text-[1em] px-2 py-1 rounded font-mono"
          :style="mcpPillStyle(id)"
        >
          <Plug :size="10" />
          {{ mcpLabel(id) }}
        </span>
      </div>
      <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">
        Session sees only these MCP servers when this agent is active (intersected with
        session-level whitelist if any).
      </div>
    </div>

    <div v-if="agent.tools && agent.tools.length > 0" class="mb-6">
      <div
        class="text-[1em] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Tools · {{ agent.tools.length }}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="tool in agent.tools"
          :key="tool"
          class="text-[1em] px-2 py-1 rounded font-mono"
          :style="{
            background: t.bgInput,
            color: t.textMuted,
            border: `1px solid ${t.border}`,
          }"
        >
          {{ tool }}
        </span>
      </div>
      <div class="text-[1em] mt-1.5" :style="{ color: t.textDim }">
        SDK toolset restricted to this whitelist (Options.allowedTools).
      </div>
    </div>

    <div class="mb-6">
      <div
        class="text-[1em] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Skills · {{ agentSkills.length }}
      </div>
      <div v-if="agentSkills.length === 0" class="text-[1em] py-2" :style="{ color: t.textFaint }">
        No skills assigned. This agent cannot be used in workflows.
      </div>
      <div v-else class="space-y-1">
        <div
          v-for="s in agentSkills"
          :key="s.id"
          class="rounded px-3 py-2 flex items-start gap-2.5"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <Wand2 :size="11" :style="{ color: t.textDim, marginTop: '3px' }" />
          <div class="flex-1 min-w-0">
            <div class="text-[1em] font-mono" :style="{ color: t.text }">{{ s.name }}</div>
            <div class="text-[1em] mt-0.5 leading-relaxed" :style="{ color: t.textDim }">
              {{ s.description }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { Copy, Edit3, Plug, Sparkles, Trash2, Wand2 } from 'lucide-vue-next'
import type { Agent, Skill } from '~/types'
import { MODELS } from '~/utils/models'

const props = defineProps<{
  agent: Agent
}>()

const emit = defineEmits<{
  edit: []
  'edit-body': [anchor: { top: number; left: number } | null]
  duplicate: []
  delete: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const model = computed(() => MODELS.find((m) => m.id === props.agent.model))

const agentSkills = computed<Skill[]>(() =>
  ws.skills.filter((s) => props.agent.skillIds.includes(s.id)),
)

// MCP pill rendering. Resolve display name from store; gray out + warn style
// if the referenced server is missing (deleted) or disabled.
const mcpLabel = (id: string): string => ws.mcpServers.find((s) => s.id === id)?.name ?? id

const mcpPillStyle = (id: string): CSSProperties => {
  const server = ws.mcpServers.find((s) => s.id === id)
  const missing = !server
  const disabled = server && !server.enabled
  if (missing) {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  if (disabled) {
    return {
      background: t.value.bgInput,
      color: t.value.textFaint,
      border: `1px solid ${t.value.border}`,
    }
  }
  return {
    background: t.value.bgInput,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
  }
}
</script>
