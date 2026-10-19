<template>
  <!-- Session Workbench (ADR 0098) — replaces /sessions once slices B–G land.
       Route kept separate during the port so /sessions stays untouched. -->
  <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-page="workbench">
    <WorkbenchView />
    <WorkbenchStatusBar />
  </section>
</template>

<script setup lang="ts">
definePageMeta({ keepalive: true })
</script>
