<template>
  <LibraryEntityModal
    :open="open"
    :title="t('commands.bodyEdit.title', { name: command.name })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('commands.bodyEdit.hint') }}</div>

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('commands.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <!-- mono-ok: lệnh slash -->
          <span class="font-mono text-sm font-medium text-foreground">/{{ draft.name }}</span>
          <Badge v-if="draft.argumentHint" variant="secondary" class="font-mono">
            {{ draft.argumentHint }}
          </Badge>
        </div>
        <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('commands.bodyEdit.proposed')"
          :content="draft.body || t('commands.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('commands.bodyEdit.regenerate') }}
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
        {{ isGenerating ? t('commands.bodyEdit.generating') : t('commands.bodyEdit.generate') }}
      </Button>
      <Button v-else variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('commands.bodyEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven body edit — port of the old UI CommandBodyEditModal, using the
// one-shot `commands.generate` RPC with `currentCommand` (revise the existing
// command). On a sidecar/account miss it falls back to a local "revision note"
// append so the UX stays usable offline. Apply preserves storage metadata
// (identity/source/projectId) — only content fields come from the model.
import { ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useCommandsStore, type Command } from '~/stores/commands'
import { startAiEditSave } from '~/composables/useAiEditSave'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  command: Command
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [command: Command]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useCommandsStore()

type Draft = { name: string; description: string; argumentHint: string; body: string }

const prompt = ref('')
const draft = ref<Draft | null>(null)
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
      name: props.command.name,
      description: props.command.description,
      argumentHint: props.command.argumentHint ?? '',
      body: props.command.body,
    }
    draft.value = await store.generateCommand(text, props.accountId, current)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

// Preserve identity/location; only content fields come from the model.
const applyDraft = (d: Draft): Command => {
  const updated: Command = {
    ...props.command,
    name: d.name,
    description: d.description,
    body: d.body,
  }
  if (d.argumentHint) updated.argumentHint = d.argumentHint
  return updated
}

const onApply = () => {
  const d = draft.value
  if (!d) return
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
  const command = props.command
  const accountId = props.accountId
  const current = {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint ?? '',
    body: command.body,
  }
  emit('cancel')
  startAiEditSave({
    key: `command-${command.id}`,
    name: command.name || command.id,
    task: async () => {
      const d = await store.generateCommand(text, accountId, current)
      if (!d.name || !d.body) throw new Error('Model returned an incomplete draft')
      const updated: Command = {
        ...command,
        name: d.name,
        description: d.description,
        body: d.body,
      }
      if (d.argumentHint) updated.argumentHint = d.argumentHint
      await store.saveCommand(updated)
      return undefined
    },
  })
}
</script>
