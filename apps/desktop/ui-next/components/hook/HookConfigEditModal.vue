<template>
  <LibraryEntityModal
    :open="open"
    :title="t('hooks.configEdit.title', { name: hook.name || hook.event })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('hooks.configEdit.hint') }}</div>

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('hooks.configEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2 rounded-lg border bg-muted p-3">
        <div class="flex flex-wrap items-center gap-2">
          <!-- mono-ok: tên event hook -->
          <Badge variant="secondary" class="font-mono text-primary">{{ draft.event }}</Badge>
          <Badge variant="secondary">{{ draft.runMode }}</Badge>
        </div>
        <!-- mono-ok: lệnh shell của hook -->
        <pre
          class="m-0 whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 font-mono text-sm leading-(--lh-prose) text-muted-foreground"
          >{{ draft.command }}</pre
        >
        <!-- mono-ok: matcher -->
        <div v-if="matcherText" class="font-mono text-xs text-dim">matcher: {{ matcherText }}</div>
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('hooks.configEdit.regenerate') }}
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
        {{ isGenerating ? t('hooks.configEdit.generating') : t('hooks.configEdit.generate') }}
      </Button>
      <Button v-else variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('hooks.configEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven hook CONFIG edit — one-shot `hooks.generate` with `currentHook`
// (revise the existing draft). Apply emits the proposed config up to the editor,
// which merges it into the editing draft (user still Saves). With no engine /
// account it surfaces an error — there is nothing to revise with.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useHooksStore, type Hook, type HookConfig } from '~/stores/hooks'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  hook: Hook
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [config: HookConfig]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useHooksStore()

const prompt = ref('')
const draft = ref<HookConfig | null>(null)
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

const matcherText = computed(() =>
  draft.value && Object.keys(draft.value.matcher).length ? JSON.stringify(draft.value.matcher) : '',
)

const resetDraft = () => {
  draft.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  if (!sc.available || !props.accountId) {
    error.value = !sc.available ? t('hooks.configEdit.offline') : t('hooks.configEdit.noAccount')
    return
  }
  isGenerating.value = true
  error.value = null
  try {
    draft.value = await store.generateHook(text, props.accountId, {
      name: props.hook.name,
      description: props.hook.description,
      event: props.hook.event,
      matcher: props.hook.matcher,
      command: props.hook.command,
      cwd: props.hook.cwd,
      timeoutMs: props.hook.timeoutMs,
      runMode: props.hook.runMode,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  if (draft.value) emit('apply', draft.value)
}
</script>
