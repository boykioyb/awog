<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 w-full">
    <div class="flex flex-col sm:flex-row sm:items-start gap-3 mb-6">
      <div
        class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
      >
        <Slash :size="18" :style="{ color: t.textMuted }" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1 flex-wrap">
          <h1 class="text-lg font-mono font-semibold" :style="{ color: t.text }">
            /{{ command.name }}
          </h1>
          <span
            class="text-[12px] px-2 py-0.5 rounded-full font-mono uppercase tracking-wider leading-none"
            :style="{
              background: isProjectScoped ? t.accent : 'transparent',
              color: isProjectScoped ? t.accentText : t.textDim,
              border: `1px solid ${isProjectScoped ? t.accent : t.border}`,
            }"
            :title="sourcePath"
          >
            {{ sourceLabel }}
          </span>
          <span
            v-if="isImported"
            class="text-[12px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 leading-none"
            :style="{ color: t.textDim, border: `1px solid ${t.border}` }"
          >
            <Lock :size="10" />
            {{ tr('commands.detail.imported') }}
          </span>
        </div>
        <div class="text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
          {{ command.description || (isImported ? tr('commands.detail.imported_desc') : '') }}
        </div>
        <div class="mt-2 text-[1em] font-mono" :style="{ color: t.textDim }">
          /{{ command.name }}
          <span v-if="command.argumentHint" :style="{ color: t.textFaint }">
            {{ command.argumentHint }}
          </span>
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
        :label="tr('commands.detail.enabled')"
        :value="command.enabled"
        @toggle="ws.toggleCommand(command.id)"
      />
      <KeyValueCard v-else :label="tr('commands.detail.source')" :value="readOnlyHint" />
      <KeyValueCard
        v-if="command.argumentHint"
        :label="tr('commands.detail.argument_hint')"
        :value="command.argumentHint"
      />
      <KeyValueCard
        v-if="command.allowedTools"
        :label="tr('commands.detail.allowed_tools')"
        :value="command.allowedTools"
      />
      <KeyValueCard
        v-if="command.model"
        :label="tr('commands.detail.model')"
        :value="command.model"
      />
    </div>

    <MarkdownBodyView
      :title="tr('commands.detail.template')"
      :content="command.body ?? ''"
      :empty-text="tr('commands.detail.empty')"
      allow-edit
      :edit-label="tr('commands.detail.edit_llm')"
      :edit-title="tr('commands.detail.edit_llm')"
      @edit-body="(a) => emit('edit-body', a)"
    />
  </div>
</template>

<script setup lang="ts">
import { Slash, Edit3, Trash2, Lock } from 'lucide-vue-next'
import type { Command, CommandSource } from '~/types'

const props = defineProps<{ command: Command }>()
const emit = defineEmits<{
  edit: []
  delete: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

const isImported = computed(() => props.command.readOnly === true)

const SOURCE_KEY: Record<CommandSource, string> = {
  global: 'commands.source.global',
  project: 'commands.source.project',
}
const sourceLabel = computed(() => tr(SOURCE_KEY[props.command.source ?? 'global']))

const isProjectScoped = computed(() => props.command.source === 'project')

const readOnlyHint = computed(() =>
  tr('commands.detail.readonly_hint', { source: sourceLabel.value }),
)

const sourcePath = computed(() => {
  const project = ws.projects.find((p) => p.id === props.command.projectId)
  const base = project?.path ?? '<project>'
  const file = `${props.command.id.split(':').join('/')}.md`
  if (props.command.source === 'project') return `${base}/.awog/commands/${file}`
  return `~/.awog/commands/${file}`
})
</script>
