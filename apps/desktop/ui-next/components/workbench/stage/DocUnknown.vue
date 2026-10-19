<template>
  <!-- Fallback surface cho doc kind chưa có renderer (task, …). -->
  <div class="flex h-full flex-col items-center justify-center gap-3 text-base text-dim">
    <Icon name="file-question" class="size-6 icn opacity-50" />
    <p>{{ t('workbench.unknown', { kind: doc.kind }) }}</p>
    <code v-if="doc.id">{{ doc.id }}</code>
  </div>
</template>

<script setup lang="ts">
import type { WorkbenchDoc } from '~/types/workbench'

defineProps<{ doc: WorkbenchDoc }>()
const { t } = useI18n()
</script>
