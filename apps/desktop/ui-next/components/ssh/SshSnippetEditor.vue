<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('ssh.snippet.editTitle') : t('ssh.snippet.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="sne">
      <div class="sne-field">
        <label class="sne-label">{{ t('ssh.snippet.name') }}</label>
        <input v-model="name" class="sne-input" :placeholder="t('ssh.snippet.namePh')" />
      </div>

      <div class="sne-field">
        <label class="sne-label">{{ t('ssh.snippet.command') }}</label>
        <textarea
          v-model="command"
          class="sne-input sne-ta mono"
          rows="5"
          :placeholder="t('ssh.snippet.commandPh')"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="sne-hint">{{ t('ssh.snippet.commandHint') }}</div>
      </div>
    </div>

    <template #footer>
      <span style="flex: 1" />
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('ssh.snippet.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// SSH snippet editor — a name + multi-line command form (mirrors SshIdentityEditor
// in a LibraryEntityModal shell). Emits the raw name/command; the section decides
// add vs update. Nothing here is a secret, so the command round-trips as plaintext.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { SshSnippet } from '~/stores/sshSnippets'

const props = defineProps<{ open: boolean; snippet: SshSnippet | null }>()

const emit = defineEmits<{ save: [name: string, command: string]; cancel: [] }>()

const { t } = useI18n()

const isExisting = computed(() => !!props.snippet)

const name = ref('')
const command = ref('')

watch(
  () => [props.open, props.snippet] as const,
  ([isOpen]) => {
    if (!isOpen) return
    name.value = props.snippet?.name ?? ''
    command.value = props.snippet?.command ?? ''
  },
  { immediate: true },
)

const canSave = computed(() => name.value.trim().length > 0 && command.value.trim().length > 0)

const onSave = () => {
  if (!canSave.value) return
  emit('save', name.value.trim(), command.value)
}
</script>

<style scoped>
.sne {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.sne-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sne-label {
  font-size: 0.8462rem;
  font-weight: 600;
  color: var(--text);
}
.sne-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9231rem;
  font-family: var(--sans);
  outline: none;
}
.sne-input.mono {
  font-family: var(--code);
}
.sne-input:focus {
  border-color: var(--accent);
}
.sne-ta {
  resize: vertical;
  min-height: 6rem;
  line-height: 1.5;
}
.sne-hint {
  font-size: 0.8462rem;
  color: var(--textDim);
}
</style>
