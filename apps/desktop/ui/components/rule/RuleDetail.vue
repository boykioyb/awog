<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 w-full">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded flex items-center justify-center"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <ScrollText :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-semibold" :style="{ color: t.text }">{{ rule.name }}</h1>
          <span
            class="text-[1em] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider"
            :style="{
              background: isProjectScoped ? t.accent : t.bgInput,
              color: isProjectScoped ? t.accentText : t.textDim,
              border: `1px solid ${isProjectScoped ? t.accent : t.border}`,
            }"
            :title="sourcePath"
          >
            {{ sourceLabel }}
          </span>
          <span
            v-if="isImported"
            class="text-[1em] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
          >
            <Lock :size="10" />
            {{ tr('rules.detail.imported') }}
          </span>
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ rule.description || (isImported ? tr('rules.detail.imported_desc') : '') }}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <AppButton variant="ghost" size="icon" :title="tr('common.edit')" @click="emit('edit')">
          <Edit3 :size="13" />
        </AppButton>
        <AppButton
          v-if="!isImported"
          variant="ghostDanger"
          size="icon"
          :title="tr('common.delete')"
          @click="emit('delete')"
        >
          <Trash2 :size="13" />
        </AppButton>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
      <ToggleCard
        v-if="!isImported"
        :label="tr('rules.detail.enabled')"
        :value="rule.enabled"
        @toggle="ws.toggleRule(rule.id)"
      />
      <KeyValueCard v-else :label="tr('rules.detail.source')" :value="readOnlyHint" />
      <KeyValueCard
        :label="tr('rules.detail.injected')"
        :value="tr('rules.detail.injected_value')"
      />
    </div>

    <div v-if="rule.globs && rule.globs.length" class="mb-6">
      <div class="text-[1em] uppercase tracking-wider mb-1.5" :style="{ color: t.textDim }">
        {{ tr('rules.detail.globs') }}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="g in rule.globs"
          :key="g"
          class="text-[12px] px-1.5 py-0.5 rounded font-mono leading-none"
          :style="{ background: t.bgInput, color: t.textMuted, border: `1px solid ${t.border}` }"
        >
          {{ g }}
        </span>
      </div>
    </div>

    <MarkdownBodyView
      :title="tr('rules.detail.instructions')"
      :content="rule.body ?? ''"
      :empty-text="tr('rules.detail.empty')"
      allow-edit
      :edit-label="tr('rules.detail.edit_llm')"
      :edit-title="tr('rules.detail.edit_llm')"
      @edit-body="(a) => emit('edit-body', a)"
    />
  </div>
</template>

<script setup lang="ts">
import { ScrollText, Edit3, Trash2, Lock } from 'lucide-vue-next'
import type { Rule, RuleSource } from '~/types'

const props = defineProps<{ rule: Rule }>()
const emit = defineEmits<{
  edit: []
  delete: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

const isImported = computed(() => props.rule.readOnly === true)

const SOURCE_KEY: Record<RuleSource, string> = {
  global: 'rules.source.global',
  project: 'rules.source.project',
}
const sourceLabel = computed(() => tr(SOURCE_KEY[props.rule.source ?? 'global']))

const isProjectScoped = computed(() => props.rule.source === 'project')

const readOnlyHint = computed(() => tr('rules.detail.readonly_hint', { source: sourceLabel.value }))

const sourcePath = computed(() => {
  const project = ws.projects.find((p) => p.id === props.rule.projectId)
  const base = project?.path ?? '<project>'
  if (props.rule.source === 'project') return `${base}/.awog/rules/${props.rule.id}.md`
  return `~/.awog/rules/${props.rule.id}.md`
})
</script>
