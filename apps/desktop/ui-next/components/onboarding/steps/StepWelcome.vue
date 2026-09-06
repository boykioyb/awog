<template>
  <div class="obw">
    <div class="obw-hero">
      <Icon name="sparkles" />
    </div>
    <p class="obw-sub">{{ t('onboarding.welcome.subtitle') }}</p>
    <ul class="obw-points">
      <li v-for="p in points" :key="p">
        <Icon name="check" class="obw-tick" />
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

<style scoped>
.obw {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.obw-hero {
  width: 56px;
  height: 56px;
  border-radius: var(--r-card);
  display: grid;
  place-items: center;
  background: var(--accentDim);
  color: var(--accent);
  margin-bottom: 14px;
}
.obw-hero :deep(svg) {
  width: 28px;
  height: 28px;
}
.obw-sub {
  font-size: 1.05em;
  color: var(--textMuted);
  margin-bottom: 18px;
}
.obw-points {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
  width: 100%;
  max-width: 380px;
}
.obw-points li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: var(--text);
}
.obw-tick {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--accent);
}
</style>
