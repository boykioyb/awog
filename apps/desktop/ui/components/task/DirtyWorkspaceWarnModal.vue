<template>
  <BaseModal :open="open" title="Workspace có change uncommitted" size="md" @close="emit('close')">
    <div class="p-4 space-y-3 text-[0.86em]" :style="{ color: t.text }">
      <p>
        Workspace có change uncommitted. Recommend commit hoặc stash trước khi chạy task để tránh
        trộn change của user với change của agent.
      </p>
      <label class="flex items-center gap-2 text-[0.79em]" :style="{ color: t.textMuted }">
        <input
          type="checkbox"
          :checked="suppress"
          @change="suppress = ($event.target as HTMLInputElement).checked"
        />
        <span>Đừng hỏi lại trong session này</span>
      </label>
    </div>

    <template #footer>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{ color: t.textMuted }"
        @click="onContinueAnyway"
      >
        Continue anyway
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{
          background: 'transparent',
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="onStashAndContinue"
      >
        Stash &amp; continue
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="onCommitNow"
      >
        Commit changes
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()

const emit = defineEmits<{
  close: []
  'commit-now': [suppress: boolean]
  'stash-and-continue': [suppress: boolean]
  'continue-anyway': [suppress: boolean]
}>()

const { t } = useTheme()
const suppress = ref(false)

const onCommitNow = () => emit('commit-now', suppress.value)
const onStashAndContinue = () => emit('stash-and-continue', suppress.value)
const onContinueAnyway = () => emit('continue-anyway', suppress.value)
</script>
