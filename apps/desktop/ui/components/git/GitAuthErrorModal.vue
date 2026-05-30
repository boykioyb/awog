<template>
  <BaseModal :open="error !== null" title="Authentication failed" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-3" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">
        Git
        <span class="font-mono">{{ error?.op }}</span>
        không xác thực được với remote.
      </div>
      <div :style="{ color: t.textMuted }">{{ hintCopy }}</div>
      <pre
        v-if="error?.message"
        class="text-[0.71em] font-mono p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap"
        :style="{ background: t.bgInput, color: t.textDim, border: `1px solid ${t.border}` }"
        >{{ error.message }}</pre
      >
    </div>
    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('close')"
      >
        Đóng
      </button>
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

const hintCopy = computed(() => {
  switch (props.error?.hint) {
    case 'ssh-key':
      return 'Kiểm tra SSH key đã add vào agent. Chạy `ssh-add` trong terminal.'
    case 'https-token':
      return 'Token HTTPS hết hạn hoặc sai. Cập nhật qua git credential helper / Keychain.'
    default:
      return 'Xác thực thất bại — kiểm tra credential cấu hình cho remote.'
  }
})
</script>
