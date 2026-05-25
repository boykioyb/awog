<template>
  <div class="p-4 md:p-6 max-w-3xl">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="rounded flex items-center justify-center text-sm font-bold flex-shrink-0"
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
        <div class="text-[12px] inline-flex items-center gap-1.5" :style="{ color: t.textDim }">
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
          class="px-3 py-1.5 text-xs rounded inline-flex items-center gap-1.5 transition"
          :style="{ color: t.text, border: `1px solid ${t.borderStrong}` }"
          @click="emit('edit')"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.background = t.bgHover)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')"
        >
          <Edit3 :size="11" />
          Edit
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
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        System Prompt
      </div>
      <div
        class="text-[12px] leading-relaxed p-3 rounded"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
        }"
      >
        <template v-if="agent.systemPrompt">{{ agent.systemPrompt }}</template>
        <span v-else :style="{ color: t.textFaint }">No system prompt set</span>
      </div>
    </div>

    <div class="mb-6">
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Skills · {{ agentSkills.length }}
      </div>
      <div v-if="agentSkills.length === 0" class="text-[11px] py-2" :style="{ color: t.textFaint }">
        No skills assigned. This agent cannot be used in workflows.
      </div>
      <div v-else class="space-y-3">
        <div v-for="[category, catSkills] in skillsByCategory" :key="category">
          <div class="text-[10px] mb-1.5" :style="{ color: t.textDim }">{{ category }}</div>
          <div class="space-y-1">
            <div
              v-for="s in catSkills"
              :key="s.id"
              class="rounded px-3 py-2 flex items-start gap-2.5"
              :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
            >
              <Wand2 :size="11" :style="{ color: t.textDim, marginTop: '3px' }" />
              <div class="flex-1 min-w-0">
                <div class="text-[12px] font-mono" :style="{ color: t.text }">{{ s.name }}</div>
                <div class="text-[10px] mt-0.5 leading-relaxed" :style="{ color: t.textDim }">
                  {{ s.description }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div
        class="text-[10px] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Context Providers
      </div>
      <div class="flex flex-wrap gap-1.5">
        <div v-if="agent.context.length === 0" class="text-[11px]" :style="{ color: t.textFaint }">
          No context providers configured
        </div>
        <template v-else>
          <div
            v-for="p in providers"
            :key="p.id"
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px]"
            :style="{ background: t.bgInput, color: t.text, border: `1px solid ${t.border}` }"
          >
            <component :is="p.icon" :size="10" :style="{ color: t.textDim }" />
            {{ p.label }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Copy, Edit3, Sparkles, Trash2, Wand2 } from 'lucide-vue-next'
import type { Agent, Skill, SkillCategory } from '~/types'
import { CONTEXT_PROVIDERS } from '~/utils/initial-data'
import { MODELS } from '~/utils/models'

const props = defineProps<{
  agent: Agent
}>()

const emit = defineEmits<{
  edit: []
  duplicate: []
  delete: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const model = computed(() => MODELS.find((m) => m.id === props.agent.model))

const agentSkills = computed<Skill[]>(() =>
  ws.skills.filter((s) => props.agent.skillIds.includes(s.id)),
)

const skillsByCategory = computed<[SkillCategory, Skill[]][]>(() => {
  const map = new Map<SkillCategory, Skill[]>()
  agentSkills.value.forEach((s) => {
    const arr = map.get(s.category) || []
    arr.push(s)
    map.set(s.category, arr)
  })
  return Array.from(map.entries())
})

const providers = computed(() =>
  props.agent.context
    .map((c) => CONTEXT_PROVIDERS.find((p) => p.id === c))
    .filter((p): p is (typeof CONTEXT_PROVIDERS)[number] => !!p),
)
</script>
