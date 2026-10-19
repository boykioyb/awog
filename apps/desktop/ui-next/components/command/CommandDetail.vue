<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <div
        class="grid size-6.5 flex-none place-items-center rounded-sm border bg-muted text-muted-foreground"
      >
        <Icon name="commands" class="size-3.5" />
      </div>
      <!-- mono-ok: lệnh slash người dùng gõ lại -->
      <div class="min-w-0 truncate font-mono text-lg font-semibold">/{{ command.name }}</div>
      <Badge
        variant="outline"
        :class="isProject ? 'border-primary/45 bg-primary/8 text-primary' : 'text-muted-foreground'"
        :title="sourcePath"
      >
        {{ sourceLabel }}
      </Badge>
      <Badge
        v-if="isImported"
        variant="outline"
        class="text-muted-foreground"
        :title="t('commands.detail.imported')"
      >
        <Icon name="lock" />
        {{ t('commands.detail.imported') }}
      </Badge>
      <span class="flex-1" />
      <Button
        :title="t('commands.detail.edit')"
        variant="outline"
        size="iconSm"
        @click="emit('edit')"
      >
        <Icon name="edit" />
      </Button>
      <Button
        v-if="!isImported"
        :title="t('commands.detail.duplicate')"
        variant="outline"
        size="iconSm"
        @click="emit('duplicate')"
      >
        <Icon name="copy" />
      </Button>
      <Button
        v-if="!isImported"
        :title="t('commands.detail.delete')"
        class="hover:border-destructive hover:text-destructive"
        variant="outline"
        size="iconSm"
        @click="emit('delete')"
      >
        <Icon name="trash" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto p-5.5">
      <p class="m-0 text-base leading-(--lh-prose) text-muted-foreground">
        {{ command.description || '—' }}
      </p>

      <!-- mono-ok: lệnh slash + gợi ý tham số người dùng gõ lại -->
      <div class="mt-2.5 font-mono text-sm text-dim">
        /{{ command.name }}
        <span v-if="command.argumentHint" class="text-faint">{{ command.argumentHint }}</span>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-2.5">
        <!-- Enable/disable toggle — imported commands are locked (identity = the CC file). -->
        <div v-if="!isImported" class="flex items-center gap-2">
          <span class="text-sm font-medium text-dim">{{ t('commands.detail.enabled') }}</span>
          <Switch
            :checked="command.enabled"
            :aria-label="t('commands.detail.enabled')"
            @update:checked="emit('toggle')"
          />
          <span class="text-xs text-dim">
            {{ command.enabled ? t('commands.detail.on') : t('commands.detail.off') }}
          </span>
        </div>

        <!-- mono-ok: giá trị frontmatter (tham số, tool, model id) -->
        <Badge v-if="command.argumentHint" variant="outline" :class="CHIP">
          {{ t('commands.detail.argumentHint') }}: {{ command.argumentHint }}
        </Badge>
        <Badge v-if="command.allowedTools" variant="outline" :class="CHIP">
          {{ t('commands.detail.allowedTools') }}: {{ command.allowedTools }}
        </Badge>
        <Badge v-if="command.model" variant="outline" :class="CHIP">
          {{ t('commands.detail.model') }}: {{ command.model }}
        </Badge>
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
// Command detail pane — port of the old UI CommandDetail logic: header cố định +
// thân cuộn. Surfaces the slash invocation + arg hint, an enable/disable
// toggle (Switch, wired to toggleCommand),
// and the prompt template body via LibraryMarkdownBody with an LLM-edit trigger.
// Imported (read-only) commands hide toggle/duplicate/delete.
import { computed } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import type { Command } from '~/stores/commands'
import Button from '~/components/ui/button/Button.vue'

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

// Chip frontmatter (giá trị kỹ thuật nên mono).
const CHIP = 'font-mono text-muted-foreground'

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
