<template>
  <div class="rld">
    <div class="dh">
      <div class="rld-icn">
        <Icon name="rules" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </div>
      <div class="dt">{{ rule.name }}</div>
      <span class="tag mono">{{ rule.id }}.md</span>
      <span class="tag" :class="{ acc: isProject }" :title="sourcePath">{{ sourceLabel }}</span>
      <span v-if="isImported" class="tag rld-lock" :title="t('rules.detail.importedHint')">
        <Icon name="shield" style="width: 10px; height: 10px" />
        {{ t('rules.detail.imported') }}
      </span>
      <span style="flex: 1" />
      <span class="fd rld-injhint">{{ t('rules.detail.autoInject') }}</span>
      <span
        class="tog2"
        :class="{ off: !rule.enabled }"
        :title="t('rules.detail.enableToggle')"
        @click="emit('toggle')"
      />
      <button class="iconbtn rld-act" :title="t('rules.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        v-if="!isImported"
        class="iconbtn rld-act rld-danger"
        :title="t('rules.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <div class="dscroll">
      <p class="rld-desc">
        {{ rule.description || (isImported ? t('rules.detail.importedDesc') : '') }}
      </p>

      <div v-if="hasGlobs" class="rld-chips">
        <span class="rld-globlabel">{{ t('rules.detail.globs') }}</span>
        <span v-for="g in rule.globs ?? []" :key="`g-${g}`" class="chip mono">{{ g }}</span>
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
// Rule detail pane — port of the old UI RuleDetail logic, rendered in prototype
// CSS (.dh header + .dscroll body, matching skills/agents detail markup). The
// header carries the auto-inject toggle (tog2) + edit / delete actions;
// LibraryMarkdownBody renders the instruction body with an LLM-edit trigger.
import { computed } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import type { Rule } from '~/stores/rules'

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

<style scoped>
.rld {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.rld-icn {
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--textMuted);
  flex: 0 0 auto;
}
.rld-act {
  width: 28px;
  height: 28px;
}
.rld-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.rld-lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rld-injhint {
  margin: 0;
}
.rld-desc {
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0;
}
.rld-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
}
.rld-globlabel {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
