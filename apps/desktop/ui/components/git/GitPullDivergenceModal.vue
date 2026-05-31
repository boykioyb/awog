<template>
  <BaseModal :open="open" :title="tr('git.pull_divergence.title')" size="sm" @close="emit('close')">
    <div class="p-4 text-xs flex flex-col gap-2" :style="{ color: t.textMuted }">
      <div :style="{ color: t.text }">{{ tr('git.pull_divergence.lead') }}</div>
      <div :style="{ color: t.textMuted }">{{ tr('git.pull_divergence.sub') }}</div>
      <ul class="list-disc pl-5 mt-1 space-y-1" :style="{ color: t.textFaint }">
        <li>
          <span class="font-medium" :style="{ color: t.textMuted }">
            {{ tr('git.pull_divergence.merge_label') }}
          </span>
          {{ tr('git.pull_divergence.merge_hint') }}
        </li>
        <li>
          <span class="font-medium" :style="{ color: t.textMuted }">
            {{ tr('git.pull_divergence.rebase_label') }}
          </span>
          {{ tr('git.pull_divergence.rebase_hint') }}
        </li>
      </ul>
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
        class="px-3 py-1.5 text-xs rounded transition"
        :style="{
          background: t.bgInput,
          color: t.text,
          border: `1px solid ${t.border}`,
        }"
        @click="emit('choose-rebase')"
      >
        {{ tr('git.pull_divergence.rebase_btn') }}
      </button>
      <button
        class="px-3 py-1.5 text-xs rounded font-medium transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="emit('choose-merge')"
      >
        {{ tr('git.pull_divergence.merge_btn') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  'choose-merge': []
  'choose-rebase': []
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
</script>
