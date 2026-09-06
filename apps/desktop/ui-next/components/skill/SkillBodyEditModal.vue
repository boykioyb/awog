<template>
  <LibraryEntityModal
    :open="open"
    :title="t('skills.bodyEdit.title', { id: skill.id })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="sbe">
      <div class="sbe-hint">{{ t('skills.bodyEdit.hint') }}</div>

      <div v-if="!draft" class="sbe-promptbox">
        <textarea
          v-model="prompt"
          class="sbe-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('skills.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="sbe-err">{{ error }}</div>

      <div v-if="draft" class="sbe-preview">
        <div class="sbe-prow">
          <span class="mono sbe-pname">{{ draft.name }}</span>
          <span v-if="draft.id" class="tag mono">/{{ draft.id }}</span>
        </div>
        <div class="sbe-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('skills.bodyEdit.proposed')"
          :content="draft.body || t('skills.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('skills.bodyEdit.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('skills.bodyEdit.generating') : t('skills.bodyEdit.generate') }}
      </button>
      <button v-else class="btn pri" :disabled="!canApply" @click="onApply">
        <Icon name="check" />
        {{ t('skills.bodyEdit.apply') }}
      </button>
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

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  // Preserve storage metadata; only content fields come from the model.
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
  emit('apply', updated)
}
</script>

<style scoped>
.sbe {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sbe-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.55;
}
.sbe-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 10px;
}
.sbe-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.55;
  font-family: var(--sans);
}
.sbe-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 10px;
}
.sbe-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sbe-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sbe-pname {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  color: var(--text);
}
.sbe-pdesc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.spin {
  animation: sbe-spin 0.9s linear infinite;
}
@keyframes sbe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
