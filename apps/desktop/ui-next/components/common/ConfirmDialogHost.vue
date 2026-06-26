<template>
  <!-- One app-lifetime host (mounted in the layout) bound to the useConfirm()
       singleton. Reuses the shared LibraryConfirmDelete visual so every confirm —
       library deletes AND imperative confirm() callers — looks identical. -->
  <LibraryConfirmDelete
    :open="state.open"
    :title="state.title"
    :description="state.description"
    :kind="state.kind"
    :confirm-label="state.confirmLabel"
    :cancel-label="state.cancelLabel"
    @confirm="settle(true)"
    @cancel="settle(false)"
  />
</template>

<script setup lang="ts">
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'

const { state, settle } = useConfirm()
</script>
