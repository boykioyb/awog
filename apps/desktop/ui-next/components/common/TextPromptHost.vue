<template>
  <!-- shadcn Dialog (role=dialog ⇒ OVERLAYS + NESTED_OVERLAYS của SlackModal đã phủ).
       Esc / bấm ngoài / nút X = huỷ qua `update:open`. z-200: nổi trên Git modal (120)
       và Git prompt (150), cùng bậc LibraryConfirmDelete. -->
  <Dialog :open="state.open" @update:open="(v: boolean) => !v && settle(null)">
    <DialogContent
      class="z-200 flex w-90 max-w-[92vw] flex-col gap-3 bg-card p-4"
      @open-auto-focus.prevent
    >
      <DialogHeader class="pr-8">
        <DialogTitle class="font-semibold">{{ state.title }}</DialogTitle>
      </DialogHeader>
      <Input
        ref="input"
        v-model="draft"
        :placeholder="state.placeholder"
        @keydown.enter.prevent="submit"
      />
      <DialogFooter>
        <Button variant="outline" @click="settle(null)">{{ t('common.cancel') }}</Button>
        <Button :disabled="!draft.trim()" variant="default" @click="submit">
          {{ state.submitLabel || t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// One app-lifetime host (mounted in the layout) bound to the useTextPrompt()
// singleton — the imperative single-line text prompt for New File / New Folder /
// Rename. Mirrors GitPromptModal's markup/styling + ConfirmDialogHost's mount
// pattern. Holds a local `draft` synced from the singleton on open, autofocuses
// + selects the field, and settles the pending promise on submit / cancel / Esc.
import { nextTick, ref, useTemplateRef, watch } from 'vue'

const { state, settle } = useTextPrompt()
const { t } = useI18n()

// Input shadcn expose focus/select (template ref là instance, không phải phần tử input).
const input = useTemplateRef<{ focus: () => void; select: () => void }>('input')
const draft = ref('')

function submit() {
  const v = draft.value.trim()
  if (!v) return
  settle(v)
}

// Sync the local draft from the singleton whenever the prompt opens, then
// autofocus + select the field for quick overwrite (rename) / typing. Focus của reka
// lúc mở bị chặn (`open-auto-focus.prevent`) để không ghi đè lần select này.
watch(
  () => state.open,
  (isOpen) => {
    if (!isOpen) return
    draft.value = state.value
    nextTick(() => {
      const el = input.value
      if (!el) return
      el.focus()
      el.select()
    })
  },
)
</script>
