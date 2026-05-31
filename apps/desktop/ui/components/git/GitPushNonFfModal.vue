<template>
  <BaseModal :open="open" :title="tr('git.push_nonff.title')" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">{{ tr('git.push_nonff.lead') }}</div>
      <div :style="{ color: t.textMuted }">{{ tr('git.push_nonff.sub') }}</div>
    </div>
    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="emit('close')"
      >
        {{ tr('common.cancel') }}
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('pull-then-push')"
      >
        {{ tr('git.push_nonff.confirm') }}
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
const { t: tr } = useI18n()
</script>
