<template>
  <div class="skd">
    <div class="dh">
      <div class="skd-icn">{{ skill.icon || '✦' }}</div>
      <div class="dt">{{ skill.name }}</div>
      <span class="tag mono">/{{ skill.id }}</span>
      <span class="tag" :class="{ acc: isProject }" :title="sourcePath">{{ sourceLabel }}</span>
      <span style="flex: 1" />
      <button class="iconbtn skd-act" :title="t('skills.detail.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn skd-act"
        :title="t('skills.detail.duplicate')"
        @click="emit('duplicate')"
      >
        <Icon name="copy" style="width: 14px; height: 14px" />
      </button>
      <button
        class="iconbtn skd-act skd-danger"
        :title="t('skills.detail.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="dscroll">
      <p class="skd-desc">{{ skill.description }}</p>

      <div v-if="hasMetaChips" class="skd-chips">
        <span v-for="g in skill.globs ?? []" :key="`g-${g}`" class="chip mono">glob: {{ g }}</span>
        <span v-for="tool in skill.alwaysAllow ?? []" :key="`a-${tool}`" class="chip">
          allow: {{ tool }}
        </span>
        <span v-for="src in skill.requiredSources ?? []" :key="`s-${src}`" class="chip">
          source: {{ src }}
        </span>
      </div>

      <LibraryMarkdownBody
        :title="t('skills.detail.instructions')"
        :content="skill.body ?? ''"
        :empty-text="t('skills.detail.emptyBody')"
        allow-edit
        :edit-label="t('skills.detail.editBody')"
        :edit-title="t('skills.detail.editBodyTitle')"
        @edit-body="(anchor) => emit('edit-body', anchor)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
// Skill detail pane — port of the old UI SkillDetail logic, rendered in
// prototype CSS (.dh header + .dscroll body, matching agents/connections detail
// markup). Header actions (edit / duplicate / delete) emit to the page;
// LibraryMarkdownBody renders the SKILL.md body with an LLM-edit trigger.
import { computed } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import type { Skill } from '~/stores/skills'

const props = defineProps<{
  skill: Skill
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  edit: []
  duplicate: []
  delete: []
  'edit-body': [anchor: { top: number; left: number } | null]
}>()

const { t } = useI18n()

const isProject = computed(() => props.skill.source === 'project')

const sourceLabel = computed(() => (isProject.value ? '.awog' : '~/.awog'))

const sourcePath = computed(() => {
  if (props.skill.source === 'global') return `~/.awog/skills/${props.skill.id}/SKILL.md`
  const project = props.projects.find((p) => p.id === props.skill.projectId)
  const base = project?.path ?? '<project>'
  return `${base}/.awog/skills/${props.skill.id}/SKILL.md`
})

const hasMetaChips = computed(
  () =>
    (props.skill.globs?.length ?? 0) > 0 ||
    (props.skill.alwaysAllow?.length ?? 0) > 0 ||
    (props.skill.requiredSources?.length ?? 0) > 0,
)
</script>

<style scoped>
.skd {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.skd-icn {
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  display: grid;
  place-items: center;
  background: var(--bgInput);
  border: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  flex: 0 0 auto;
}
.skd-act {
  width: 28px;
  height: 28px;
}
.skd-danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.skd-desc {
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: 1.6;
  margin: 0;
}
.skd-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
</style>
