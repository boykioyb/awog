<template>
  <LibraryEntityModal
    :open="open"
    :title="t('hooks.scriptEdit.title', { path })"
    :lock-scrim="isGenerating"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('hooks.scriptEdit.hint') }}</div>

      <div v-if="content === null">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('hooks.scriptEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="content !== null" class="h-80 overflow-hidden rounded-md border">
        <MonacoViewer :value="content" language="shell" read-only />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="content !== null" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('hooks.scriptEdit.regenerate') }}
      </Button>
      <Button
        v-if="content === null"
        :disabled="isGenerating || !prompt.trim()"
        variant="default"
        @click="onGenerate"
      >
        <Icon
          :name="isGenerating ? 'refresh' : 'sparkles'"
          :class="{ 'animate-spin': isGenerating }"
        />
        {{ isGenerating ? t('hooks.scriptEdit.generating') : t('hooks.scriptEdit.generate') }}
      </Button>
      <Button v-else variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('hooks.scriptEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven hook SCRIPT edit — one-shot `hooks.generate-script` (writes/revises
// the raw code of the file a hook runs, e.g. format-after-edit.sh). The proposed
// content is previewed read-only in Monaco; Apply emits it up to the editor,
// which feeds it into the inline (editable) Monaco viewer. With no engine /
// account it reports that instead of writing a placeholder into the script.
import { ref, watch } from 'vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useHooksStore } from '~/stores/hooks'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  path: string
  command: string
  currentContent: string
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [content: string]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useHooksStore()

const prompt = ref('')
const content = ref<string | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      content.value = null
      error.value = null
    }
  },
)

const resetDraft = () => {
  content.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  try {
    // Never write a placeholder into a script the hook engine will actually run.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    content.value = await store.generateHookScript(text, props.accountId, {
      command: props.command,
      currentScript: props.currentContent,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  if (content.value !== null) emit('apply', content.value)
}
</script>
