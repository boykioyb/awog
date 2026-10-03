<template>
  <div class="flex flex-col gap-0.5">
    <button
      v-for="(td, i) in todos"
      :key="i"
      type="button"
      class="tdrow"
      :class="{ done: td.done, ip: td.status === 'in_progress' }"
      :disabled="!editable"
      :title="editable ? t('sessions.todo.cycle') : undefined"
      @click="emit('cycle', i)"
    >
      <span class="tdck">
        <Icon v-if="td.done" name="check" style="width: var(--icon-xs); height: var(--icon-xs)" />
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
/* Checkbox row — rounded-md hover wash (proto list-row idiom). Rows are <button>
   for keyboard access; strip the native chrome so they keep the plain-row look in
   both the editable and the read-only case. */
.tdrow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  text-align: left;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--foreground);
  cursor: pointer;
  transition: background 0.12s ease;
}
.tdrow:hover:not(:disabled) {
  background: var(--accent-wash);
}
/* Read-only rows (the transcript record) — no pointer affordance. */
.tdrow:disabled {
  cursor: default;
}
/* Checkbox box: hairline input border; done = primary fill + tick. */
.tdck {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--input);
  border-radius: var(--r-xs);
  color: var(--primary);
}
.tdrow.done {
  color: var(--muted-foreground);
  text-decoration: line-through;
}
.tdrow.done .tdck {
  border-color: var(--primary);
  background: rgb(from var(--primary) r g b / 14%);
}
/* In-progress marker: primary box + a small live dot (vs. empty pending / ✓ done). */
.tdrow.ip .tdck {
  border-color: var(--primary);
}
.tddot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary);
}
@media (prefers-reduced-motion: reduce) {
  .tdrow {
    transition: none;
  }
}
</style>
