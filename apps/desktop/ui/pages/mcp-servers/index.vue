<template>
  <div />
</template>

<script setup lang="ts">
// Back-compat redirect (ADR 0025): the "MCP Servers" page was reframed to
// "Connections". Keep this route so old links / bookmarks resolve.
definePageMeta({
  middleware: () => navigateTo('/connections', { replace: true }),
})
</script>
