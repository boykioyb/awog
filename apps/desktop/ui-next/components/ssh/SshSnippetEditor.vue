<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('ssh.snippet.editTitle') : t('ssh.snippet.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">{{ t('ssh.snippet.name') }}</Label>
        <Input v-model="name" :placeholder="t('ssh.snippet.namePh')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-xs font-semibold text-foreground">{{ t('ssh.snippet.command') }}</Label>
        <Textarea
          v-model="command"
          class="min-h-24 resize-y font-mono"
          rows="5"
          :placeholder="t('ssh.snippet.commandPh')"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="text-xs text-muted-foreground">{{ t('ssh.snippet.commandHint') }}</div>
      </div>
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('ssh.snippet.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
