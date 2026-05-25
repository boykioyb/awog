<template>
  <div
    class="h-screen w-full flex overflow-hidden"
    :style="{ background: t.bg, color: t.text, fontFamily: 'var(--font-sans)' }"
  >
    <NavRail />
    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar />
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useTheme()
</script>
