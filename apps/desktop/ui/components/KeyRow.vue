<template>
  <div class="flex items-start gap-2 text-[0.79em]">
    <div
      class="font-medium flex-shrink-0 w-28 truncate"
      :title="label"
      :style="{ color: t.textDim, fontFamily: mono ? 'ui-monospace' : 'inherit' }"
    >
      {{ label }}
    </div>
    <div
      class="flex-1 min-w-0 break-all"
      :title="value || ''"
      :style="{
        color: t.text,
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit',
      }"
    >
      {{ value || '—' }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string; mono?: boolean }>()
const { t } = useTheme()
</script>
