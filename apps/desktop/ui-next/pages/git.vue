<template>
  <section class="flex min-w-0 flex-1 flex-col overflow-hidden" data-page="git">
    <GitManager />
  </section>
</template>

<script setup lang="ts">
// Git page — thin route wrapper. All Git Manager UI + state lives in
// components/git/GitManager.vue so the same surface can be reused inside the
// session Git modal (SessionGitModal.vue) without duplicating ~500 lines.
</script>
