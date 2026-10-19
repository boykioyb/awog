<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <div
        class="grid size-6.5 flex-none place-items-center rounded-sm border bg-muted text-muted-foreground"
      >
        <Icon name="rules" class="size-3.5" />
      </div>
      <div class="min-w-0 truncate text-lg font-semibold">{{ rule.name }}</div>
      <!-- mono-ok: tên file rule -->
      <Badge variant="outline" class="font-mono text-muted-foreground">{{ rule.id }}.md</Badge>
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
        :title="t('rules.detail.importedHint')"
      >
        <Icon name="shield" />
        {{ t('rules.detail.imported') }}
      </Badge>
      <span class="flex-1" />
      <span class="text-sm text-dim">{{ t('rules.detail.autoInject') }}</span>
      <Switch
        :checked="rule.enabled"
        :title="t('rules.detail.enableToggle')"
        :aria-label="t('rules.detail.enableToggle')"
        @update:checked="emit('toggle')"
      />
      <Button :title="t('rules.detail.edit')" variant="outline" size="iconSm" @click="emit('edit')">
        <Icon name="edit" />
      </Button>
      <Button
        v-if="!isImported"
        :title="t('rules.detail.delete')"
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
        {{ rule.description || (isImported ? t('rules.detail.importedDesc') : '') }}
      </p>

      <div v-if="hasGlobs" class="mt-3.5 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-dim">{{ t('rules.detail.globs') }}</span>
        <!-- mono-ok: glob path -->
        <Badge
          v-for="g in rule.globs ?? []"
          :key="`g-${g}`"
          variant="outline"
          class="font-mono text-muted-foreground"
        >
          {{ g }}
        </Badge>
      </div>

      <LibraryMarkdownBody
        :title="t('rules.detail.instructions')"
        :content="rule.body ?? ''"
        :empty-text="t('rules.detail.emptyBody')"
        allow-edit
        :edit-label="t('rules.detail.editBody')"
        :edit-title="t('rules.detail.editBodyTitle')"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Rule detail pane — port of the old UI RuleDetail logic: header cố định + thân
// cuộn, cùng bố cục với detail của skills/agents. The header carries the
// auto-inject toggle (Switch) + edit / delete actions;
// LibraryMarkdownBody renders the instruction body with an LLM-edit trigger.
import { computed } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import type { Rule } from '~/stores/rules'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  rule: Rule
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useI18n()

const isProject = computed(() => props.rule.source === 'project')
const isImported = computed(() => props.rule.readOnly === true)

const sourceLabel = computed(() => (isProject.value ? '.awog' : '~/.awog'))

const sourcePath = computed(() => {
  if (props.rule.source === 'global') return `~/.awog/rules/${props.rule.id}.md`
  const project = props.projects.find((p) => p.id === props.rule.projectId)
  const base = project?.path ?? '<project>'
  return `${base}/.awog/rules/${props.rule.id}.md`
})

const hasGlobs = computed(() => (props.rule.globs?.length ?? 0) > 0)
</script>
