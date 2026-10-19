<template>
  <LibraryEntityModal
    :open="open"
    :title="t('skills.bodyEdit.title', { id: skill.id })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('skills.bodyEdit.hint') }}</div>

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('skills.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <!-- mono-ok: định danh (slug / lệnh) -->
          <span class="font-mono text-sm font-medium text-foreground">{{ draft.name }}</span>
          <Badge v-if="draft.id" variant="secondary" class="font-mono">/{{ draft.id }}</Badge>
        </div>
        <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('skills.bodyEdit.proposed')"
          :content="draft.body || t('skills.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('skills.bodyEdit.regenerate') }}
      </Button>
      <Button
        v-if="!draft"
        :disabled="isGenerating || !prompt.trim()"
        variant="outline"
        :title="t('library.bgEdit.hint')"
        @click="onGenerateSave"
      >
        <Icon name="check" />
        {{ t('library.bgEdit.generateSave') }}
      </Button>
      <Button
        v-if="!draft"
        :disabled="isGenerating || !prompt.trim()"
        variant="default"
        @click="onGenerate"
      >
        <Icon
          :name="isGenerating ? 'refresh' : 'sparkles'"
          :class="{ 'animate-spin': isGenerating }"
        />
        {{ isGenerating ? t('skills.bodyEdit.generating') : t('skills.bodyEdit.generate') }}
      </Button>
      <Button v-else :disabled="!canApply" variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('skills.bodyEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven body edit — port of the old UI SkillPromptCreator edit flow, using
// the one-shot `skills.generate` RPC with `currentSkill` (revise the existing
// skill). On a sidecar/account miss it falls back to a local "revision note"
// append so the UX stays usable offline. Apply preserves storage metadata
// (source/projectId) — only content comes from the model.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSkillsStore, type Skill } from '~/stores/skills'
import { startAiEditSave } from '~/composables/useAiEditSave'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  skill: Skill
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [skill: Skill]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useSkillsStore()

const prompt = ref('')
const draft = ref<Skill | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      draft.value = null
      error.value = null
    }
  },
)

const canApply = computed(() => !!(draft.value?.id && draft.value.name && draft.value.description))

const resetDraft = () => {
  draft.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  try {
    // No engine / no account: there is nothing to revise with, so report it
    // instead of stamping a comment in and calling it a revision.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    const current = {
      id: props.skill.id,
      name: props.skill.name,
      description: props.skill.description,
      body: props.skill.body,
      icon: props.skill.icon,
      globs: props.skill.globs,
      alwaysAllow: props.skill.alwaysAllow,
      requiredSources: props.skill.requiredSources,
    }
    const result = await store.generateSkill(text, props.accountId, current)
    draft.value = {
      ...result,
      source: props.skill.source,
      projectId: props.skill.projectId,
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

// Merge draft vào skill hiện tại: giữ storage metadata; content từ model.
const applyDraft = (d: Skill): Skill => {
  const updated: Skill = {
    id: d.id,
    source: props.skill.source,
    name: d.name,
    description: d.description,
    body: d.body,
  }
  if (props.skill.projectId) updated.projectId = props.skill.projectId
  if (d.icon) updated.icon = d.icon
  if (d.globs && d.globs.length > 0) updated.globs = [...d.globs]
  if (d.alwaysAllow && d.alwaysAllow.length > 0) updated.alwaysAllow = [...d.alwaysAllow]
  if (d.requiredSources && d.requiredSources.length > 0)
    updated.requiredSources = [...d.requiredSources]
  return updated
}

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  emit('apply', applyDraft(d))
}

// "Sửa + lưu": generate + apply + save chạy nền — đóng modal ngay, xong/lỗi
// bắn toast. Chụp entity + account lúc bấm vì modal unmount sau emit('cancel').
const onGenerateSave = () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  if (!sc.available || !props.accountId) {
    error.value = t('common.aiUnavailable')
    return
  }
  const skill = props.skill
  const accountId = props.accountId
  const current = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    icon: skill.icon,
    globs: skill.globs,
    alwaysAllow: skill.alwaysAllow,
    requiredSources: skill.requiredSources,
  }
  emit('cancel')
  startAiEditSave({
    key: `skill-${skill.id}`,
    name: skill.name || skill.id,
    task: async () => {
      const result = await store.generateSkill(text, accountId, current)
      if (!result.id || !result.name || !result.description) {
        throw new Error('Model returned an incomplete draft')
      }
      const updated: Skill = {
        id: result.id,
        source: skill.source,
        name: result.name,
        description: result.description,
        body: result.body,
      }
      if (skill.projectId) updated.projectId = skill.projectId
      if (result.icon) updated.icon = result.icon
      if (result.globs && result.globs.length > 0) updated.globs = [...result.globs]
      if (result.alwaysAllow && result.alwaysAllow.length > 0)
        updated.alwaysAllow = [...result.alwaysAllow]
      if (result.requiredSources && result.requiredSources.length > 0)
        updated.requiredSources = [...result.requiredSources]
      await store.saveSkill(updated)
      return undefined
    },
  })
}
</script>
