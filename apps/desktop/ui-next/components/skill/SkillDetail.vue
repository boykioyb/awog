<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <div class="grid size-6.5 flex-none place-items-center rounded-sm border bg-muted text-sm">
        {{ skill.icon || '✦' }}
      </div>
      <div class="min-w-0 truncate text-lg font-semibold">{{ skill.name }}</div>
      <!-- mono-ok: lệnh slash của skill -->
      <Badge variant="outline" class="font-mono text-muted-foreground">/{{ skill.id }}</Badge>
      <Badge
        variant="outline"
        :class="isProject ? 'border-primary/45 bg-primary/8 text-primary' : 'text-muted-foreground'"
        :title="sourcePath"
      >
        {{ sourceLabel }}
      </Badge>
      <span class="flex-1" />
      <!-- Nút đang bật = accent-tint (không dùng nền xám). -->
      <Button
        :class="{ 'border-selected-border bg-selected text-primary': showCheck }"
        :title="showCheck ? t('skillsEval.close') : t('skillsEval.open')"
        variant="outline"
        size="iconSm"
        @click="showCheck = !showCheck"
      >
        <Icon name="scan" />
      </Button>
      <Button
        :title="t('skills.detail.edit')"
        variant="outline"
        size="iconSm"
        @click="emit('edit')"
      >
        <Icon name="edit" />
      </Button>
      <Button
        :title="t('skills.detail.duplicate')"
        variant="outline"
        size="iconSm"
        @click="emit('duplicate')"
      >
        <Icon name="copy" />
      </Button>
      <Button
        :title="t('skills.detail.delete')"
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
        {{ skill.description }}
      </p>

      <div v-if="hasMetaChips" class="mt-3.5 flex flex-wrap gap-1.5">
        <!-- mono-ok: glob path -->
        <Badge
          v-for="g in skill.globs ?? []"
          :key="`g-${g}`"
          variant="outline"
          class="font-mono text-muted-foreground"
        >
          glob: {{ g }}
        </Badge>
        <Badge
          v-for="tool in skill.alwaysAllow ?? []"
          :key="`a-${tool}`"
          variant="outline"
          class="text-muted-foreground"
        >
          allow: {{ tool }}
        </Badge>
        <Badge
          v-for="src in skill.requiredSources ?? []"
          :key="`s-${src}`"
          variant="outline"
          class="text-muted-foreground"
        >
          source: {{ src }}
        </Badge>
      </div>

      <!-- Bảng kiểm tra remount theo skill: state (doctor + ca kiểm) thuộc về
           đúng skill đang mở, đổi skill là nạp lại từ đầu. -->
      <SkillCheckPanel
        v-if="showCheck"
        :key="skillKey"
        :skill="skill"
        :project-ids="projects.map((p) => p.id)"
      />

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
// Skill detail pane — port of the old UI SkillDetail logic: header cố định +
// thân cuộn, cùng bố cục với detail của agents/connections. Header actions (edit / duplicate / delete) emit to the page;
// LibraryMarkdownBody renders the SKILL.md body with an LLM-edit trigger.
import { computed, ref } from 'vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import SkillCheckPanel from '~/components/skill/SkillCheckPanel.vue'
import type { Skill } from '~/stores/skills'
import Button from '~/components/ui/button/Button.vue'

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

// Bảng kiểm tra mặc định đóng: mở ra là chạy chẩn đoán, và eval thì tốn tiền.
const showCheck = ref(false)

const skillKey = computed(
  () => `${props.skill.source}|${props.skill.projectId ?? ''}|${props.skill.id}`,
)

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
