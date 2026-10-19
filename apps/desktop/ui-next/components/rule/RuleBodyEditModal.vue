<template>
  <LibraryEntityModal
    :open="open"
    :title="t('rules.bodyEdit.title', { name: rule.name })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('rules.bodyEdit.hint') }}</div>

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('rules.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-foreground">{{ draft.name }}</span>
        </div>
        <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('rules.bodyEdit.proposed')"
          :content="draft.body || t('rules.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('rules.bodyEdit.regenerate') }}
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
        {{ isGenerating ? t('rules.bodyEdit.generating') : t('rules.bodyEdit.generate') }}
      </Button>
      <Button v-else :disabled="!canApply" variant="default" @click="onApply">
        <Icon name="check" />
        {{ t('rules.bodyEdit.apply') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven body edit — port of the old UI RuleBodyEditModal, using the one-shot
// `rules.generate` RPC with `currentRule` (revise the existing rule). On a
// sidecar/account miss it falls back to a local "revision note" append so the UX
// stays usable offline. Apply preserves storage metadata (source/projectId/
// enabled/globs) — only content comes from the model.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useRulesStore, type Rule, type RuleDraft } from '~/stores/rules'
import { startAiEditSave } from '~/composables/useAiEditSave'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  rule: Rule
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [rule: Rule]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useRulesStore()

const prompt = ref('')
const draft = ref<RuleDraft | null>(null)
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

const canApply = computed(() => !!(draft.value?.name && draft.value.body))

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
    // instead of stamping a comment into the body and calling it a revision.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    const current = {
      name: props.rule.name,
      description: props.rule.description,
      body: props.rule.body,
    }
    draft.value = await store.generateRule(text, props.accountId, current)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

// Preserve identity/location; only content fields come from the model.
const applyDraft = (d: RuleDraft): Rule => ({
  ...props.rule,
  name: d.name,
  description: d.description,
  body: d.body,
})

const onApply = () => {
  const d = draft.value
  if (!d || !canApply.value) return
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
  const rule = props.rule
  const accountId = props.accountId
  const current = { name: rule.name, description: rule.description, body: rule.body }
  emit('cancel')
  startAiEditSave({
    key: `rule-${rule.id}`,
    name: rule.name || rule.id,
    task: async () => {
      const d = await store.generateRule(text, accountId, current)
      if (!d.name || !d.body) throw new Error('Model returned an incomplete draft')
      await store.saveRule({ ...rule, name: d.name, description: d.description, body: d.body })
      return undefined
    },
  })
}
</script>
