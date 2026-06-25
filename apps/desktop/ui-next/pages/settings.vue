<template>
  <div />
</template>

<script setup lang="ts">
// Settings is a modal overlay (useSettingsModal), not a page — opened from the
// NavRail. A direct /settings visit (deep link / old bookmark) opens the modal
// over Home instead of showing an empty route.
const { openSettings } = useSettingsModal()
onMounted(() => {
  openSettings()
  navigateTo('/')
})
</script>
