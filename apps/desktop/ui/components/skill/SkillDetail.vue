<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl w-full">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center text-lg"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <span v-if="skill.icon">{{ skill.icon }}</span>
        <Wand2 v-else :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-mono font-semibold" :style="{ color: t.text }">
            {{ skill.name }}
          </h1>
          <span
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgInput,
              color: t.textDim,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ skill.id }}
          </span>
          <span
            class="text-[0.71em] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
            :style="{
              background: isProjectScoped ? t.accent : t.bgInput,
              color: isProjectScoped ? t.accentText : t.textDim,
              border: `1px solid ${isProjectScoped ? t.accent : t.border}`,
            }"
            :title="sourcePath"
          >
            {{ sourceLabel }}
          </span>
        </div>
        <div class="text-[0.93em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ skill.description }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          title="Edit"
          @click="emit('edit')"
          @mouseenter="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = t.bgHover
              el.style.color = t.text
            }
          "
          @mouseleave="
            (e: MouseEvent) => {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'transparent'
              el.style.color = t.textDim
            }
          "
        >
          <Edit3 :size="13" />
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

    <div v-if="hasMetaChips" class="flex flex-wrap gap-1.5 mb-6">
      <span
        v-for="g in skill.globs ?? []"
        :key="`g-${g}`"
        class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        glob: {{ g }}
      </span>
      <span
        v-for="tool in skill.alwaysAllow ?? []"
        :key="`a-${tool}`"
        class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        allow: {{ tool }}
      </span>
      <span
        v-for="src in skill.requiredSources ?? []"
        :key="`s-${src}`"
        class="text-[0.71em] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        source: {{ src }}
      </span>
    </div>

    <div class="mb-6">
      <MarkdownBodyView
        title="Instructions"
        :content="skill.body ?? ''"
        empty-text="(empty body — click Edit to draft instructions)"
        allow-edit
        edit-title="Edit body via LLM prompt"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />
    </div>

    <div>
      <div
        class="text-[0.71em] uppercase tracking-wider font-medium mb-2"
        :style="{ color: t.textDim }"
      >
        Used by · {{ agentsUsing.length }} agents
      </div>
      <div v-if="agentsUsing.length === 0" class="text-[0.79em]" :style="{ color: t.textFaint }">
        Not assigned to any agent yet
      </div>
      <div v-else class="space-y-1.5">
        <div
          v-for="agent in agentsUsing"
          :key="agent.id"
          class="flex items-center gap-2.5 p-2.5 rounded"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
        >
          <div class="flex-shrink-0 flex justify-center" :style="{ width: `${colWidth}px` }">
            <RoleBadge :role="agent.role" />
          </div>
          <div class="flex-1">
            <div class="text-[0.86em] font-medium" :style="{ color: t.text }">
              {{ agent.name }}
            </div>
            <div class="text-[0.71em]" :style="{ color: t.textDim }">
              {{ MODELS.find((m) => m.id === agent.model)?.label }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Wand2, Edit3, Trash2 } from 'lucide-vue-next'
import type { Agent, Skill } from '~/types'
import { MODELS } from '~/utils/models'
import { calcBadgeColWidth } from '~/utils/graph'

const props = defineProps<{
  skill: Skill
}>()

const emit = defineEmits<{
  edit: []
  'edit-body': [anchor: { top: number; left: number } | null]
  delete: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const agentsUsing = computed<Agent[]>(() =>
  ws.agents.filter((a) => a.skillIds.includes(props.skill.id)),
)

const colWidth = computed(() => calcBadgeColWidth(agentsUsing.value.map((a) => a.role)))

const hasMetaChips = computed(
  () =>
    (props.skill.globs?.length ?? 0) > 0 ||
    (props.skill.alwaysAllow?.length ?? 0) > 0 ||
    (props.skill.requiredSources?.length ?? 0) > 0,
)

const SOURCE_LABEL: Record<Skill['source'], string> = {
  global: '~/.awog',
  'user-claude': '~/.claude',
  'user-agents': '~/.agents',
  'project-claude': '.claude',
  'project-agents': '.agents',
}

const USER_PATH_PREFIX: Partial<Record<Skill['source'], string>> = {
  global: '~/.awog/skills',
  'user-claude': '~/.claude/skills',
  'user-agents': '~/.agents/skills',
}

const sourceLabel = computed(() => SOURCE_LABEL[props.skill.source])

const isProjectScoped = computed(
  () => props.skill.source === 'project-claude' || props.skill.source === 'project-agents',
)

const sourcePath = computed(() => {
  const userPrefix = USER_PATH_PREFIX[props.skill.source]
  if (userPrefix) return `${userPrefix}/${props.skill.id}/SKILL.md`
  const project = ws.projects.find((p) => p.id === props.skill.projectId)
  const sub = props.skill.source === 'project-claude' ? '.claude/skills' : '.agents/skills'
  const base = project?.path ?? '<project>'
  return `${base}/${sub}/${props.skill.id}/SKILL.md`
})
</script>
