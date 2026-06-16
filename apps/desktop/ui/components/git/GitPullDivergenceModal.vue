<template>
  <BaseModal :open="open" :title="tr('git.pull_divergence.title')" size="sm" @close="emit('close')">
    <div class="p-4 text-[1em] flex flex-col gap-2" :style="{ color: t.textMuted }">
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
      <AppButton variant="ghost" @click="emit('close')">
        {{ tr('common.cancel') }}
      </AppButton>
      <AppButton variant="secondary" @click="emit('choose-rebase')">
        {{ tr('git.pull_divergence.rebase_btn') }}
      </AppButton>
      <AppButton @click="emit('choose-merge')">
        {{ tr('git.pull_divergence.merge_btn') }}
      </AppButton>
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
