<template>
  <LibraryEntityModal
    :open="open"
    :title="t('commands.creator.title')"
    :lock-scrim="isGenerating"
    :width="540"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3.5">
      <div class="text-sm text-dim">{{ t('commands.creator.hint') }}</div>

      <LibraryScopePicker v-model="scope" :projects="projects" />

      <div v-if="!draft">
        <Textarea
          v-model="prompt"
          class="min-h-16 resize-y"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('commands.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div v-if="draft" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <!-- mono-ok: định danh (slug / lệnh) -->
          <span class="font-mono text-sm font-medium text-foreground">
            /{{ slugify(draft.name) }}
          </span>
          <Badge v-if="draft.argumentHint" variant="secondary" class="font-mono">
            {{ draft.argumentHint }}
          </Badge>
        </div>
        <div class="text-sm text-muted-foreground">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('commands.creator.generated')"
          :content="draft.body || t('commands.creator.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
      <Button v-if="draft" variant="outline" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('commands.creator.regenerate') }}
      </Button>
      <Button v-if="draft" variant="outline" @click="onEditDetails">
        <Icon name="edit" />
        {{ t('commands.creator.editDetails') }}
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
        {{ isGenerating ? t('commands.creator.generating') : t('commands.creator.generate') }}
      </Button>
      <Button v-else variant="default" @click="onSave">
        <Icon name="save" />
        {{ t('commands.creator.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Command creation panel — port of the old UI CommandPromptCreator. Commands have
// only the ONE-SHOT `commands.generate` RPC (not a streaming `commands.author`),
// so this drafts via generateCommand (mirroring SkillBodyEditModal) rather than
// the streaming LibraryCreatorPanel. The user describes the command, the model
// returns a draft, then they either save directly to the chosen scope or hand off
// to the form editor ("edit details"). Offline / no-account → an explicit error.
import { ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import type { CommandSeed } from '~/composables/useCommandsPage'
import { useSidecar } from '~/composables/useSidecar'
import { useCommandsStore } from '~/stores/commands'
import Button from '~/components/ui/button/Button.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    // Tier preselected when opening from a per-group "+" ('global' or a projectId).
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{
  close: []
  save: [payload: { seed: CommandSeed; scope: string }]
  'edit-details': [seed: CommandSeed]
}>()

const { t } = useI18n()
const sc = useSidecar()
const store = useCommandsStore()

const scope = ref('global')
const prompt = ref('')
const draft = ref<CommandSeed | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-command'

// Reset prompt + draft each time the panel opens.
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
    // No engine / no account: say so rather than passing a locally-derived draft
    // off as the model's output.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    draft.value = await store.generateCommand(text, props.accountId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onSave = () => {
  if (!draft.value) return
  emit('save', { seed: draft.value, scope: scope.value })
}

const onEditDetails = () => {
  if (!draft.value) return
  emit('edit-details', draft.value)
}
</script>
