<template>
  <div class="todol">
    <button
      v-for="(td, i) in todos"
      :key="i"
      class="tdrow"
      :class="{ done: td.done, ip: td.status === 'in_progress', ro: !editable }"
      :disabled="!editable"
      :title="editable ? t('sessions.todo.cycle') : undefined"
      @click="emit('cycle', i)"
    >
      <span class="tdck">
        <Icon v-if="td.done" name="check" style="width: 12px; height: 12px" />
        <span v-else-if="td.status === 'in_progress'" class="tddot" />
      </span>
      {{ td.t }}
    </button>
  </div>
</template>

<script setup lang="ts">
// Checklist rows shared by the docked banner (SessionTodoPanel), the Plan & Progress
// tab, and the inline transcript step (SessionStepItem) — one source of row markup.
//
// `editable` splits the two roles: the CURRENT checklist is shared state between the
// user and the model, so a click cycles a row pending → in_progress → completed →
// pending and the parent persists it. The inline transcript step is a historical record
// of what the model wrote at that moment, so it stays read-only (the default).
import type { Todo } from '~/composables/useSessionsData'

withDefaults(defineProps<{ todos: Todo[]; editable?: boolean }>(), { editable: false })

const emit = defineEmits<{ (e: 'cycle', index: number): void }>()

const { t } = useI18n()
</script>

<style scoped>
/* Rows are <button> for keyboard access; strip the native chrome so they keep the
   prototype's plain-row look in both the editable and the read-only case. */
.tdrow {
  width: 100%;
  background: none;
  border: 0;
  text-align: left;
  font: inherit;
}
/* Read-only rows (the transcript record) — drop the prototype's pointer cursor. */
.tdrow.ro {
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
