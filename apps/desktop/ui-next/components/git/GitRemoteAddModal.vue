<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('git.remote.addTitle') }}</DialogTitle>
      </DialogHeader>
      <div class="grid gap-3">
        <label class="grid grid-cols-[52px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">{{ t('git.remote.name') }}</span>
          <Input
            ref="nameInput"
            v-model="name"
            :placeholder="t('git.remote.namePlaceholder')"
            @keydown.enter.prevent="focusUrl"
          />
        </label>
        <label class="grid grid-cols-[52px_1fr] items-center gap-3">
          <span class="text-sm font-medium text-muted-foreground">{{ t('git.remote.url') }}</span>
          <Input
            ref="urlInput"
            v-model="url"
            class="font-mono"
            :placeholder="t('git.remote.urlPlaceholder')"
            @keydown.enter.prevent="submit"
          />
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button :disabled="!canSubmit" @click="submit">{{ t('git.remote.add') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Add-remote modal — collects a remote name + URL (`git remote add`). Two fields,
// so it can't reuse the single-line GitPromptModal.
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'submit', payload: { name: string; url: string }): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const name = ref('')
const url = ref('')
const nameInput = useTemplateRef<{ $el?: HTMLInputElement } | HTMLInputElement>('nameInput')
const urlInput = useTemplateRef<{ $el?: HTMLInputElement } | HTMLInputElement>('urlInput')

const canSubmit = computed(() => !!name.value.trim() && !!url.value.trim())

const el = (r: { $el?: HTMLInputElement } | HTMLInputElement | null) =>
  r instanceof HTMLInputElement ? r : (r?.$el ?? null)

function focusUrl() {
  el(urlInput.value)?.focus()
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', { name: name.value.trim(), url: url.value.trim() })
}

// Reset + focus the first field on each open.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    name.value = 'origin'
    url.value = ''
    void nextTick(() => {
      const e = el(nameInput.value)
      e?.focus()
      e?.select()
    })
  },
)
</script>
