<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>
      <Input
        ref="input"
        :model-value="modelValue"
        :placeholder="placeholder"
        @update:model-value="(v) => emit('update:modelValue', String(v))"
        @keydown.enter.prevent="submit"
      />
      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button :disabled="!modelValue.trim()" @click="submit">
          {{ submitLabel ?? t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Small reusable prompt modal for single-line git input (new branch name, rename
// branch, tag name…). Caller owns the value via v-model + supplies the labels;
// this component only renders the dialog + wires keyboard/focus behaviour.
import { nextTick, useTemplateRef, watch } from 'vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogFooter from '~/components/ui/dialog/DialogFooter.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  open: boolean
  title: string
  modelValue: string
  placeholder?: string
  submitLabel?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit', v: string): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const input = useTemplateRef<{ $el?: HTMLInputElement } | HTMLInputElement>('input')

// Reka manages Esc/outside-close centrally; map both to the one `close` event.
function onOpenChange(v: boolean) {
  if (!v) emit('close')
}

function submit() {
  const v = props.modelValue.trim()
  if (!v) return
  emit('submit', v)
}

// Autofocus + select the field whenever the modal opens.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    nextTick(() => {
      const el = input.value instanceof HTMLInputElement ? input.value : input.value?.$el
      if (!el) return
      el.focus()
      el.select()
    })
  },
)
</script>
