<template>
  <div class="todol">
    <div
      v-for="(td, i) in todos"
      :key="i"
      class="tdrow"
      :class="{ done: td.done, ip: td.status === 'in_progress' }"
    >
      <span class="tdck">
        <Icon v-if="td.done" name="check" style="width: 12px; height: 12px" />
        <span v-else-if="td.status === 'in_progress'" class="tddot" />
      </span>
      {{ td.t }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Read-only checklist rows shared by the docked banner (SessionTodoPanel) and the
// inline transcript step (SessionStepItem) — one source of row markup. The model owns
// the list, so the rows are non-interactive.
import type { Todo } from '~/composables/useSessionsData'

defineProps<{ todos: Todo[] }>()
</script>

<style scoped>
/* Read-only rows (model owns the list) — drop the prototype's pointer cursor. */
.tdrow {
  cursor: default;
}
/* In-progress marker: accent box + a small live dot (vs. empty pending / ✓ done). */
.tdrow.ip .tdck {
  border-color: var(--accent);
}
.tddot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
}
</style>
