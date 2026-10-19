<template>
  <div class="flex flex-col items-center text-center">
    <div class="mb-3.5 grid size-14 place-items-center rounded-xl bg-selected text-primary">
      <Icon name="sparkles" class="size-7" />
    </div>
    <p class="mb-4.5 text-lg text-muted-foreground">{{ t('onboarding.welcome.subtitle') }}</p>
    <ul class="m-0 flex w-full max-w-95 list-none flex-col gap-3 p-0 text-left">
      <li v-for="p in points" :key="p" class="flex items-start gap-2.5 text-foreground">
        <Icon name="check" class="mt-0.5 shrink-0 text-primary" />
        <span>{{ p }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// Welcome step — pure value-prop intro. Advancing is driven by the wizard footer
// ("Get started"), so this carries no controls of its own.
const { t } = useI18n()
const points = computed(() => [
  t('onboarding.welcome.point1'),
  t('onboarding.welcome.point2'),
  t('onboarding.welcome.point3'),
])
</script>
