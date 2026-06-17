<template>
  <div class="flex-1 overflow-y-auto p-4 md:p-6 w-full">
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-2 min-w-0">
        <div class="text-[1em] font-medium truncate" :style="{ color: t.text }">{{ title }}</div>
        <span
          v-if="dirty"
          class="text-[1em] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
          :style="{
            color: t.statusWarn,
            background: t.warningBg,
            border: `1px solid ${t.warningBorder}`,
          }"
        >
          Modified
        </span>
      </div>
      <div class="flex gap-2 flex-shrink-0 items-center">
        <!-- Extra editor-specific actions go BEFORE the standard Cancel/Save.
             Used by AgentEditor for "Edit agent with LLM" — keeps the LLM
             trigger on the same row as primary actions without each editor
             having to re-implement Cancel + Save itself. -->
        <slot name="header-actions-extra" />
        <slot name="header-actions">
          <AppButton variant="ghost" @click="requestClose">Cancel</AppButton>
          <AppButton :disabled="saveDisabled" @click="onSave">
            <Save :size="11" />
            {{ saving ? 'Saving…' : saveLabel }}
          </AppButton>
        </slot>
      </div>
    </div>

    <slot />

    <div v-if="$slots.footer" class="mt-4">
      <slot name="footer" />
    </div>

    <BaseModal
      :open="showDiscardConfirm"
      title="Discard changes?"
      size="sm"
      @close="showDiscardConfirm = false"
    >
      <div class="p-4 text-[1em] leading-relaxed" :style="{ color: t.textMuted }">
        You have unsaved changes. Discard them and close the editor?
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="showDiscardConfirm = false">Keep editing</AppButton>
        <AppButton variant="danger" @click="confirmDiscard">Discard</AppButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { Save } from 'lucide-vue-next'

/**
 * Full-page editor shell — chrome chung cho 6 Editor (Agent/Skill/Command/Hook/Mcp/Project).
 *
 * Contract ESC + dirty (ADR 0009a §5):
 * - ESC hoặc Cancel button khi `dirty=false` → emit `cancel` (đóng thẳng).
 * - ESC hoặc Cancel button khi `dirty=true`  → mở confirm `BaseModal` "Discard changes?".
 *   Chọn "Discard" → emit `cancel`. Chọn "Keep editing" → đóng modal, editor vẫn mở.
 *
 * Shell cũng emit `request-close` cho parent muốn override flow (vd: auto-save).
 */

type Props = {
  title: string
  dirty: boolean
  saving?: boolean
  canSave?: boolean
  saveLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  saving: false,
  canSave: true,
  saveLabel: 'Save',
})

const emit = defineEmits<{
  save: []
  cancel: []
  'request-close': []
}>()

const { t } = useTheme()

const saveDisabled = computed(() => !props.canSave || props.saving)
const showDiscardConfirm = ref(false)

const onSave = () => {
  if (saveDisabled.value) return
  emit('save')
}

const requestClose = () => {
  emit('request-close')
  if (props.dirty) {
    showDiscardConfirm.value = true
    return
  }
  emit('cancel')
}

const confirmDiscard = () => {
  showDiscardConfirm.value = false
  emit('cancel')
}

// ESC chỉ trigger khi không có discard confirm modal đang mở (BaseModal tự push ESC stack riêng).
useEscape(requestClose)
</script>
