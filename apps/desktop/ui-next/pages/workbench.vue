<template>
  <!-- Session Workbench (ADR 0098) — replaces /sessions once slices B–G land.
       Route kept separate during the port so /sessions stays untouched. -->
  <section class="page on wbpage" data-page="workbench">
    <WorkbenchView />
    <WorkbenchStatusBar />
  </section>
</template>

<script setup lang="ts">
definePageMeta({ keepalive: true })
</script>

<style scoped>
.wbpage {
  flex-direction: column;
  min-height: 0;
}
</style>
