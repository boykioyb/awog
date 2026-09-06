<template>
  <Teleport to="body">
    <div v-if="clientId != null" class="ovl on forkovl" @click.self="close">
      <div class="forkmodal">
        <div class="forkmodal-head">
          <Icon name="fork" style="width: 14px; height: 14px; color: var(--accent)" />
          <span class="forkmodal-title">{{ t('sessions.fork.treeTitle') }}</span>
          <span style="flex: 1" />
          <button class="forkmodal-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="forkmodal-body">
          <SessionForkGraph v-if="hasLineage" :client-id="clientId" @navigate="onNavigate" />
          <div v-else class="forkempty">
            <span class="ei"><Icon name="fork" style="width: 20px; height: 20px" /></span>
            <div class="et">{{ t('sessions.fork.empty') }}</div>
            <div class="es">{{ t('sessions.fork.emptyHint') }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
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

<style scoped>
.forkovl {
  align-items: center;
  padding: 24px;
  z-index: 130;
}
.forkmodal {
  width: min(1000px, 92vw);
  height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.forkmodal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bgEl);
}
.forkmodal-title {
  font-weight: 600;
}
.forkmodal-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--r-xs);
  display: inline-flex;
}
.forkmodal-x:hover {
  color: var(--text);
  background: var(--bgHover);
}
.forkmodal-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.forkempty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--textDim);
}
.forkempty .ei {
  width: 48px;
  height: 48px;
  border-radius: var(--r-card);
  background: var(--bgEl);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
}
.forkempty .et {
  color: var(--textMuted);
}
.forkempty .es {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
</style>
