<template>
  <LibraryEntityModal
    :open="open"
    :title="t('rules.creator.title')"
    :lock-scrim="isGenerating"
    :width="560"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('rules.creator.hint') }}</div>

      <LibraryScopePicker v-model="scope" :projects="projects" />

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('rules.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-foreground">{{ draft.name }}</span>
          <Badge v-if="slug" variant="secondary" class="font-mono">{{ slug }}.md</Badge>
        </div>
        <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('rules.creator.proposed')"
          :content="draft.body || t('rules.creator.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('rules.creator.regenerate') }}
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
        {{ isGenerating ? t('rules.creator.generating') : t('rules.creator.generate') }}
      </Button>
      <Button v-else :disabled="!canSave" variant="default" @click="onSave">
        <Icon name="check" />
        {{ t('rules.creator.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Chat-driven rule creation — drafts a rule from a natural-language prompt via
// the one-shot `rules.generate` RPC, then persists into the chosen tier. Unlike
// the reference SkillPromptCreator (streaming `skills.author`), the sidecar has
// NO `rules.author` method, so this mirrors the SkillBodyEditModal one-shot shape
// instead: prompt → draft preview → save. On a sidecar/account miss it falls
// back to dropping the prompt into the body so the UX stays usable offline.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useRulesStore, type Rule, type RuleDraft } from '~/stores/rules'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    // Tier preselected when the modal opens — 'global' or a projectId, set by the
    // per-group "+" so creating inside a project group lands in that tier.
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{ save: [payload: { rule: Rule }]; close: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useRulesStore()

const scope = ref('global')
const prompt = ref('')
const draft = ref<RuleDraft | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const slug = computed(() => (draft.value ? slugify(draft.value.name) : ''))

const canSave = computed(() => !!(draft.value?.name && draft.value.body && slug.value))

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      scope.value = props.initialScope
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
    // No engine / no account: say so. A locally-derived draft would be presented
    // as the model's output, which it is not.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    draft.value = await store.generateRule(text, props.accountId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onSave = () => {
  const d = draft.value
  if (!d || !canSave.value) return
  // Map the picked scope ('global' or a projectId) to source/projectId.
  const rule: Rule = {
    id: slug.value,
    source: scope.value === 'global' ? 'global' : 'project',
    name: d.name,
    description: d.description,
    body: d.body,
    enabled: true,
  }
  if (rule.source === 'project') rule.projectId = scope.value
  emit('save', { rule })
}
</script>
