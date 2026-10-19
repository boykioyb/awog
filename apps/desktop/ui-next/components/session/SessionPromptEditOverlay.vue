<template>
  <!-- Click ra ngoài KHÔNG đóng (giữ như overlay cũ — bấm trượt không được làm mất
       bản đang sửa); ESC / nút × / Huỷ mới đóng. Focus do watch bên dưới tự đặt
       (con trỏ về cuối), nên chặn auto-focus của Dialog. -->
  <Dialog :open="!!state" @update:open="(v: boolean) => !v && cancel()">
    <DialogContent
      class="max-w-xl gap-0 overflow-hidden bg-popover p-0 text-popover-foreground"
      @open-auto-focus.prevent
      @interact-outside.prevent
    >
      <div class="flex items-center gap-2 border-b px-3.5 py-2.5 pr-10">
        <Pencil class="size-3.5 text-muted-foreground" />
        <DialogTitle class="text-base font-semibold">{{ t('palette.edit.title') }}</DialogTitle>
      </div>

      <!-- Ô sửa prompt dài — kéo giãn theo chiều dọc. -->
      <Textarea
        ref="taRef"
        v-model="draft"
        class="mx-3.5 my-3 min-h-36 w-auto resize-y px-3 py-2.5 font-sans text-base leading-(--lh-prose)"
        :placeholder="t('palette.edit.placeholder')"
        @keydown.meta.enter.prevent="confirm"
        @keydown.ctrl.enter.prevent="confirm"
      />

      <div class="flex justify-end gap-2 px-3.5 pb-3.5">
        <Button variant="ghost" size="sm" class="text-base" @click="cancel">
          {{ t('palette.edit.cancel') }}
        </Button>
        <Button size="sm" class="text-base" :disabled="!draft.trim()" @click="confirm">
          {{ t('palette.edit.confirm') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Pencil } from 'lucide-vue-next'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useCommandPalette } from '~/composables/useCommandPalette'

// Focused prompt-edit overlay (§9 globals). Driven by the useCommandPalette
// singleton's `promptEdit` state: a caller does `await openPromptEdit(seed)` and
// this overlay resolves the promise with the edited text (confirm) or null
// (cancel). Decoupled from the sessions store so any component can use it without
// this overlay knowing the resend flow.

const { t } = useI18n()
const { promptEdit, confirmPromptEdit, cancelPromptEdit } = useCommandPalette()

const state = computed(() => promptEdit.value)
const draft = ref('')
// `Textarea` là component ⇒ template ref trả instance, phần tử thật ở `$el`.
const taRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('taRef')

function confirm() {
  const next = draft.value.trim()
  if (!next) return
  confirmPromptEdit(next)
}
function cancel() {
  cancelPromptEdit()
}

// ESC closes the overlay even when focus isn't inside the textarea (e.g. tabbed to
// a button); gated on the open `state`.
useEscToClose(() => !!state.value, cancel)

// Seed the draft + focus whenever a new edit request opens.
watch(
  state,
  (s) => {
    if (!s) return
    draft.value = s.text
    nextTick(() => {
      const el = taRef.value?.$el
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  },
  { immediate: true },
)
</script>
