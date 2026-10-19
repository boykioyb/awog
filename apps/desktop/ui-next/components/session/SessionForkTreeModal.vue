<template>
  <Dialog :open="clientId != null" @update:open="(v) => !v && close()">
    <DialogContent
      class="flex h-[80vh] w-[92vw] max-w-250 flex-col gap-0 overflow-hidden bg-card p-0 text-card-foreground sm:max-w-250"
      :aria-describedby="undefined"
    >
      <div class="flex h-12 shrink-0 items-center gap-2 pr-12 pl-4">
        <Icon name="fork" class="size-3.5 text-primary" />
        <DialogTitle>{{ t('sessions.fork.treeTitle') }}</DialogTitle>
      </div>
      <Separator />
      <div class="flex min-h-0 flex-1">
        <SessionForkGraph
          v-if="hasLineage && clientId != null"
          :client-id="clientId"
          @navigate="onNavigate"
        />
        <div
          v-else
          class="flex flex-1 flex-col items-center justify-center gap-2.5 text-muted-foreground"
        >
          <span class="grid size-12 place-items-center rounded-lg border bg-muted">
            <Icon name="fork" class="size-5" />
          </span>
          <div>{{ t('sessions.fork.empty') }}</div>
          <div class="text-sm text-faint">{{ t('sessions.fork.emptyHint') }}</div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Session fork-tree modal — pops the lineage graph over the current session.
// Single instance, mounted in the default layout; opened via useSessionForkModal().
// Clicking a node navigates to that session and closes the modal.
import { computed } from 'vue'
import { useSessionForkModal } from '~/composables/useSessionForkModal'
import { useSessionForkTree } from '~/composables/useSessionForkTree'
import { useSessionsStore } from '~/stores/sessions'

const { t } = useI18n()
const { clientId, close } = useSessionForkModal()
const store = useSessionsStore()
const { treeFor } = useSessionForkTree()

// Show the graph only when there's real lineage; else an empty state explaining how
// forks appear here (a single standalone session has no tree to draw).
const hasLineage = computed(() =>
  clientId.value != null ? treeFor(clientId.value).hasLineage : false,
)

function onNavigate(id: number) {
  store.setActive(id)
  close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && clientId.value != null) {
    e.preventDefault()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
