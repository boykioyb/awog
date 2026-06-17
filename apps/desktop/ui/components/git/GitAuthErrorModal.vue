<template>
  <BaseModal :open="error !== null" :title="tr('git.auth.title')" size="sm" @close="emit('close')">
    <div class="p-4 text-[1em] flex flex-col gap-3" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">{{ tr('git.auth.lead', { op: error?.op ?? '' }) }}</div>
      <div :style="{ color: t.textMuted }">{{ hintCopy }}</div>
      <pre
        v-if="error?.message"
        class="text-[1em] font-mono p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        >{{ error.message }}</pre
      >
    </div>
    <template #footer>
      <AppButton @click="emit('close')">
        {{ tr('common.close') }}
      </AppButton>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import type { GitStreamingOp } from '~/composables/useGitApi'

type AuthHint = 'ssh-key' | 'https-token' | 'unknown'
type AuthError = { op: GitStreamingOp; hint: AuthHint; message: string }

const props = defineProps<{ error: AuthError | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

const hintCopy = computed(() => {
  switch (props.error?.hint) {
    case 'ssh-key':
      return tr('git.auth.hint.ssh_key')
    case 'https-token':
      return tr('git.auth.hint.https_token')
    default:
      return tr('git.auth.hint.unknown')
  }
})
</script>
