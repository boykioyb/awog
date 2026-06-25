<template>
  <div class="cmd">
    <div class="dh">
      <div class="cmd-icn"><Icon name="commands" style="width: 14px; height: 14px" /></div>
      <div class="dt mono">/{{ command.name }}</div>
      <span class="tag" :class="{ acc: isProject }" :title="sourcePath">{{ sourceLabel }}</span>
      <span v-if="isImported" class="tag cmd-lock" :title="t('commands.detail.imported')">
        <Icon name="lock" style="width: 10px; height: 10px" />
        {{ t('commands.detail.imported') }}
      </span>
      <span style="flex: 1" />
      <button class="iconbtn cmd-act" :title="t('commands.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button
        v-if="!isImported"
        class="iconbtn cmd-act"
        :title="t('commands.detail.duplicate')"
        @click="emit('duplicate')"
      >
        <Icon name="copy" style="width: 14px; height: 14px" />
      </button>
      <button
        v-if="!isImported"
        class="iconbtn cmd-act cmd-danger"
        :title="t('commands.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p class="cmd-desc">{{ command.description || '—' }}</p>

      <div class="cmd-invoke mono">
        /{{ command.name }}
        <span v-if="command.argumentHint" class="cmd-arg">{{ command.argumentHint }}</span>
      </div>

      <div class="cmd-meta">
        <!-- Enable/disable toggle — imported commands are locked (identity = the CC file). -->
        <div v-if="!isImported" class="cmd-toggle">
          <span class="cmd-toggle-label">{{ t('commands.detail.enabled') }}</span>
          <button
            class="seg cmd-seg"
            type="button"
            role="switch"
            :aria-checked="command.enabled"
            @click="emit('toggle')"
          >
            <span :class="{ on: command.enabled }">{{ t('commands.detail.on') }}</span>
            <span :class="{ on: !command.enabled }">{{ t('commands.detail.off') }}</span>
          </button>
        </div>

        <span v-if="command.argumentHint" class="chip mono">
          {{ t('commands.detail.argumentHint') }}: {{ command.argumentHint }}
        </span>
        <span v-if="command.allowedTools" class="chip mono">
          {{ t('commands.detail.allowedTools') }}: {{ command.allowedTools }}
        </span>
        <span v-if="command.model" class="chip mono">
          {{ t('commands.detail.model') }}: {{ command.model }}
        </span>
      </div>

      <LibraryMarkdownBody
        :title="t('commands.detail.template')"
        :content="command.body ?? ''"
        :empty-text="t('commands.detail.emptyBody')"
        allow-edit
        :edit-label="t('commands.detail.editBody')"
        :edit-title="t('commands.detail.editBodyTitle')"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Command detail pane — port of the old UI CommandDetail logic, rendered in
// prototype CSS (.dh header + .dscroll body). Surfaces the slash invocation +
// arg hint, an enable/disable toggle (prototype `.seg`, wired to toggleCommand),
// and the prompt template body via LibraryMarkdownBody with an LLM-edit trigger.
// Imported (read-only) commands hide toggle/duplicate/delete.
import { computed } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import type { Command } from '~/stores/commands'

const props = defineProps<{
  command: Command
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  edit: []
  duplicate: []
  delete: []
  toggle: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useI18n()

const isProject = computed(() => (props.command.source ?? 'global') === 'project')
const isImported = computed(() => props.command.readOnly === true)

const sourceLabel = computed(() => (isProject.value ? '.awog' : '~/.awog'))

const sourcePath = computed(() => {
  const file = `${props.command.id.split(':').join('/')}.md`
  if ((props.command.source ?? 'global') === 'global') return `~/.awog/commands/${file}`
  const project = props.projects.find((p) => p.id === props.command.projectId)
  const base = project?.path ?? '<project>'
  return `${base}/.awog/commands/${file}`
})
</script>

<style scoped>
.cmd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.cmd-icn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  flex: 0 0 auto;
}
.cmd-lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cmd-act {
  width: 28px;
  height: 28px;
}
.cmd-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.cmd-desc {
  font-size: 1rem;
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0;
}
.cmd-invoke {
  margin-top: 10px;
  font-size: 0.9615rem;
  color: var(--textDim);
}
.cmd-arg {
  color: var(--textFaint);
}
.cmd-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.cmd-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cmd-toggle-label {
  font-size: 0.8846rem;
  color: var(--textDim);
}
.cmd-seg {
  cursor: pointer;
}
</style>
