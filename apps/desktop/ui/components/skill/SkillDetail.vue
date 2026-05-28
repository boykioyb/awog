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
            class="text-[10px] px-1.5 py-0.5 rounded font-mono"
            :style="{
              background: t.bgInput,
              color: t.textDim,
              border: `1px solid ${t.border}`,
            }"
          >
            /{{ skill.id }}
          </span>
          <span
            class="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
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

    <div v-if="hasMetaChips" class="flex flex-wrap gap-1.5 mb-6">
      <span
        v-for="g in skill.globs ?? []"
        :key="`g-${g}`"
        class="text-[10px] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        glob: {{ g }}
      </span>
      <span
        v-for="tool in skill.alwaysAllow ?? []"
        :key="`a-${tool}`"
        class="text-[10px] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        allow: {{ tool }}
      </span>
      <span
        v-for="src in skill.requiredSources ?? []"
        :key="`s-${src}`"
        class="text-[10px] px-1.5 py-0.5 rounded font-mono"
        :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
      >
        source: {{ src }}
      </span>
    </div>

    <div class="mb-6">
      <div class="flex items-center justify-between mb-2">
        <div class="text-[10px] uppercase tracking-wider font-medium" :style="{ color: t.textDim }">
          Instructions
        </div>
        <div class="flex items-center gap-1">
          <div
            class="flex items-center rounded overflow-hidden"
            :style="{ border: `1px solid ${t.border}` }"
          >
            <button
              v-for="mode in ['preview', 'raw'] as const"
              :key="mode"
              class="px-2 py-1 text-[10px] inline-flex items-center gap-1 transition"
              :style="viewModeStyle(mode)"
              @click="viewMode = mode"
            >
              <component :is="mode === 'preview' ? Eye : FileCode" :size="10" />
              {{ mode }}
            </button>
          </div>
          <button
            class="px-2 py-1 text-[10px] rounded inline-flex items-center gap-1 transition"
            :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
            :title="copied ? 'Copied!' : 'Copy markdown to clipboard'"
            @click="onCopy"
          >
            <component :is="copied ? Check : Copy" :size="10" />
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
          <button
            class="px-2 py-1 text-[10px] rounded inline-flex items-center gap-1 transition"
            :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
            title="Edit body via LLM prompt"
            @click="onEditBody"
          >
            <Sparkles :size="10" />
            Edit
          </button>
        </div>
      </div>

      <div
        v-if="!skill.body"
        class="text-[11px] italic p-3 rounded"
        :style="{
          color: t.textFaint,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
        }"
      >
        (empty body — click Edit to draft instructions)
      </div>
      <div
        v-else-if="viewMode === 'preview'"
        class="p-3 rounded text-[13px] leading-relaxed"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
        }"
      >
        <MarkdownRenderer :content="skill.body" />
      </div>
      <pre
        v-else
        class="text-[12px] font-mono whitespace-pre-wrap leading-relaxed p-3 rounded"
        :style="{
          color: t.textMuted,
          background: t.bgInput,
          border: `1px solid ${t.border}`,
          margin: 0,
        }"
        >{{ skill.body }}</pre
      >
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
          <div class="flex-shrink-0 flex justify-center" :style="{ width: `${colWidth}px` }">
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
import type { CSSProperties } from 'vue'
import { Wand2, Edit3, Trash2, Eye, FileCode, Copy, Check, Sparkles } from 'lucide-vue-next'
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

const onEditBody = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  emit('edit-body', { top: rect.bottom + 8, left: rect.left })
}

const { t } = useTheme()
const ws = useWorkspaceStore()

type ViewMode = 'preview' | 'raw'
const viewMode = ref<ViewMode>('preview')
const copied = ref(false)

const viewModeStyle = (mode: ViewMode): CSSProperties => {
  const active = viewMode.value === mode
  return {
    background: active ? t.value.bgActive : 'transparent',
    color: active ? t.value.text : t.value.textDim,
    borderRight: mode === 'preview' ? `1px solid ${t.value.border}` : 'none',
  }
}

const onCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.skill.body ?? '')
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard API can fail under non-secure contexts (e.g. file://). Fall
    // back to legacy execCommand which Tauri webview tolerates.
    const textarea = document.createElement('textarea')
    textarea.value = props.skill.body ?? ''
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 1500)
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

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
