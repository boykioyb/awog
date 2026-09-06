<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('terminalSnippet.editTitle') : t('terminalSnippet.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="tse">
      <div class="tse-field">
        <label class="tse-label">{{ t('terminalSnippet.name') }}</label>
        <input v-model="name" class="tse-input" :placeholder="t('terminalSnippet.namePh')" />
      </div>

      <div class="tse-field">
        <label class="tse-label">{{ t('terminalSnippet.command') }}</label>
        <textarea
          v-model="command"
          class="tse-input tse-ta mono"
          rows="5"
          :placeholder="t('terminalSnippet.commandPh')"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="tse-hint">{{ t('terminalSnippet.commandHint') }}</div>
      </div>

      <div class="tse-field">
        <label class="tse-label">{{ t('terminalSnippet.tier') }}</label>
        <AppSelect v-model="tier" :options="tierOptions" width="100%" />
        <div class="tse-hint">{{ t('terminalSnippet.tierHint') }}</div>
      </div>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('terminalSnippet.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Terminal snippet editor — name + multi-line command + a tier selector (this
// project vs Global). Mirrors SshSnippetEditor's LibraryEntityModal shell. Emits
// the raw name/command + the resolved project key (null = Global); the rail
// decides add vs update. Nothing here is a secret → plaintext round-trip.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { TerminalSnippet } from '~/stores/terminalSnippets'

const props = defineProps<{
  open: boolean
  snippet: TerminalSnippet | null
  // Active project key (null = no project → only the Global tier is available).
  project: string | null
  // Human label for the active project (shown in the "This project" option).
  projectLabel?: string
}>()

const emit = defineEmits<{
  save: [name: string, command: string, project: string | null]
  cancel: []
}>()

const { t } = useI18n()

const isExisting = computed(() => !!props.snippet)

const name = ref('')
const command = ref('')
const tier = ref<'project' | 'global'>('global')

// The tier options: "This project" only when a project is active, else Global only.
const tierOptions = computed<AppSelectOption[]>(() => {
  const opts: AppSelectOption[] = []
  if (props.project) {
    opts.push({
      label: t('terminalSnippet.tierProject', { name: props.projectLabel ?? props.project }),
      value: 'project',
    })
  }
  opts.push({ label: t('terminalSnippet.tierGlobal'), value: 'global' })
  return opts
})

watch(
  () => [props.open, props.snippet] as const,
  ([isOpen]) => {
    if (!isOpen) return
    name.value = props.snippet?.name ?? ''
    command.value = props.snippet?.command ?? ''
    // Editing → derive tier from the snippet; new → default to the active project
    // (if any), else Global. No project available → force Global.
    if (props.snippet) tier.value = props.snippet.project === null ? 'global' : 'project'
    else tier.value = props.project ? 'project' : 'global'
  },
  { immediate: true },
)

const canSave = computed(() => name.value.trim().length > 0 && command.value.trim().length > 0)

const onSave = (): void => {
  if (!canSave.value) return
  const project = tier.value === 'global' ? null : props.project
  emit('save', name.value.trim(), command.value, project)
}
</script>

<style scoped>
.tse {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tse-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tse-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--text);
}
.tse-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.tse-input.mono {
  font-family: var(--code);
}
.tse-input:focus {
  border-color: var(--accent);
}
.tse-ta {
  resize: vertical;
  min-height: 6rem;
  line-height: 1.5;
}
.tse-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
</style>
