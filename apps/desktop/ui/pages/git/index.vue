<template>
  <GitManager />
</template>

<script setup lang="ts">
// The full Git manager lives in `components/git/GitManager.vue` so it can be
// reused inside a Session via SessionGitModal. This page is a thin host.
definePageMeta({ title: 'Git' })
</script>
