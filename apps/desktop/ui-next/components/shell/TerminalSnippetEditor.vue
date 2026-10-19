<template>
  <LibraryEntityModal
    :open="open"
    :title="isExisting ? t('terminalSnippet.editTitle') : t('terminalSnippet.newTitle')"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <Label for="tse-name" class="text-xs">{{ t('terminalSnippet.name') }}</Label>
        <Input id="tse-name" v-model="name" :placeholder="t('terminalSnippet.namePh')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label for="tse-command" class="text-xs">{{ t('terminalSnippet.command') }}</Label>
        <!-- mono-ok: lệnh shell, người dùng copy-paste vào terminal -->
        <Textarea
          id="tse-command"
          v-model="command"
          class="min-h-24 resize-y font-mono"
          rows="5"
          :placeholder="t('terminalSnippet.commandPh')"
          spellcheck="false"
          autocomplete="off"
        />
        <div class="text-xs text-dim">{{ t('terminalSnippet.commandHint') }}</div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-xs">{{ t('terminalSnippet.tier') }}</Label>
        <AppSelect v-model="tier" :options="tierOptions" width="100%" />
        <div class="text-xs text-dim">{{ t('terminalSnippet.tierHint') }}</div>
      </div>
    </div>

    <template #footer>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" @click="onSave">
        {{ t('terminalSnippet.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
