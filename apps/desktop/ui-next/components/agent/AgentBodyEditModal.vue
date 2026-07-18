<template>
  <LibraryEntityModal
    :open="open"
    :title="t('agents.bodyEdit.title', { id: agent.id })"
    :lock-scrim="isGenerating"
    :width="540"
    @close="emit('cancel')"
  >
    <div class="abe">
      <div class="abe-hint">{{ t('agents.bodyEdit.hint') }}</div>

      <div v-if="!draft" class="abe-promptbox">
        <textarea
          v-model="prompt"
          class="abe-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('agents.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="abe-err">{{ error }}</div>

      <div v-if="draft" class="abe-preview">
        <div class="abe-prow">
          <span class="mono abe-pname">{{ draft.name }}</span>
          <span v-if="draft.role" class="tag">{{ draft.role }}</span>
          <span v-if="draft.id" class="tag mono">{{ draft.id }}</span>
        </div>
        <div class="abe-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('agents.bodyEdit.proposed')"
          :content="draft.systemPrompt || t('agents.bodyEdit.emptyPrompt')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('agents.bodyEdit.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('agents.bodyEdit.generating') : t('agents.bodyEdit.generate') }}
      </button>
      <button v-else class="btn pri" :disabled="!canApply" @click="onApply">
        <Icon name="check" />
        {{ t('agents.bodyEdit.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven system-prompt edit — port of the old UI AgentBodyEditModal, using
// the one-shot `agents.generate` RPC with `currentAgent` (revise the existing
// agent). On a sidecar/account miss it falls back to a local "revision note"
// append so the UX stays usable offline. Apply preserves storage metadata
// (source/projectId) + per-agent restrictions (tools/mcpServerIds) — only
// content (name/description/model/role/systemPrompt) comes from the model.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useAgentsStore, type Agent } from '~/stores/agents'

const props = defineProps<{
  open: boolean
  agent: Agent
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [agent: Agent]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useAgentsStore()

type AgentDraft = {
  id: string
  name: string
  description: string
  model: string
  systemPrompt: string
  role: string
  mcpServerIds?: string[]
}

const prompt = ref('')
const draft = ref<AgentDraft | null>(null)
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
    if (!sc.available || !props.accountId) {
      // Offline fallback: append a revision note so something visibly changes.
      await new Promise<void>((r) => setTimeout(r, 350))
      draft.value = {
        id: props.agent.id,
        name: props.agent.name,
        description: props.agent.description,
        model: props.agent.model,
        role: props.agent.role,
        systemPrompt: `${props.agent.systemPrompt}\n\n<!-- Edit requested: ${text} -->`,
      }
      return
    }
    const current = {
      id: props.agent.id,
      name: props.agent.name,
      description: props.agent.description,
      model: props.agent.model,
      systemPrompt: props.agent.systemPrompt,
      role: props.agent.role,
      mcpServerIds: props.agent.mcpServerIds,
    }
    const result = await store.generateAgent(text, props.accountId, current)
    draft.value = result
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  const d = draft.value
  if (!d || !d.id) return
  // Preserve storage metadata + per-agent restrictions; content from the model.
  const updated: Agent = {
    id: props.agent.id,
    source: props.agent.source,
    name: d.name,
    description: d.description,
    provider: props.agent.provider,
    model: d.model || props.agent.model,
    systemPrompt: d.systemPrompt,
    role: d.role,
  }
  if (props.agent.projectId) updated.projectId = props.agent.projectId
  if (props.agent.accountId) updated.accountId = props.agent.accountId
  if (props.agent.tools && props.agent.tools.length > 0) updated.tools = [...props.agent.tools]
  if (props.agent.mcpServerIds && props.agent.mcpServerIds.length > 0) {
    updated.mcpServerIds = [...props.agent.mcpServerIds]
  }
  emit('apply', updated)
}
</script>

<style scoped>
.abe {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.abe-hint {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.55;
}
.abe-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px;
}
.abe-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: 0.9231rem;
  line-height: 1.55;
  font-family: var(--sans);
}
.abe-err {
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.abe-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.abe-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.abe-pname {
  font-size: 0.9615rem;
  font-weight: 500;
  color: var(--text);
}
.abe-pdesc {
  font-size: 0.9231rem;
  color: var(--textMuted);
}
.spin {
  animation: abe-spin 0.9s linear infinite;
}
@keyframes abe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
