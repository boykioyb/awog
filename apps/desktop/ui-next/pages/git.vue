<template>
  <section class="page on" data-page="git" style="flex-direction: column">
    <GitManager />
  </section>
</template>

<script setup lang="ts">
// Git page — thin route wrapper. All Git Manager UI + state lives in
// components/git/GitManager.vue so the same surface can be reused inside the
// session Git modal (SessionGitModal.vue) without duplicating ~500 lines.
</script>
