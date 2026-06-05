<template>
  <section class="px-4 py-3" :style="{ borderBottom: `1px solid ${t.border}` }">
    <h3 class="flex items-center gap-1.5 mb-2.5">
      <span
        class="text-[1em] font-semibold uppercase"
        :style="{ color: t.textFaint, letterSpacing: '0.05em' }"
      >
        {{ label }}
      </span>
      <span
        v-if="count !== undefined"
        class="font-mono text-[12px] leading-none"
        :style="{ color: t.textFaint }"
      >
        ({{ count }})
      </span>
    </h3>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  // Optional count chip rendered after the label (e.g. number of files).
  count?: number
}>()

const { t } = useTheme()
</script>
