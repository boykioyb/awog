<template>
  <BaseModal :open="open" title="Push bị từ chối" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">
        Remote có commit mới mà local chưa pull. Git từ chối non-fast-forward push.
      </div>
      <div :style="{ color: t.textMuted }">
        Pull (merge) trước, rồi push lại? Nếu pull thất bại / có conflict, sequence sẽ dừng và bạn
        cần xử lý thủ công.
      </div>
    </div>
    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        Hủy
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('pull-then-push')"
      >
        Pull then push
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'pull-then-push': []
}>()

const { t } = useTheme()
</script>
