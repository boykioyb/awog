<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronRight, Circle, CircleDot } from 'lucide-vue-next'
import { current, cycleTodo } from '../store'

// Pinned session checklist (ADR 0069). Same contract as the desktop: the list is
// shared state — the model writes it through TodoWrite, a tap here writes it back
// through sessions.updateTodos, and it is re-injected next turn, so a user edit is
// not overwritten. Collapsed it stays as a done/total strip; it never auto-hides.

const todos = computed(() => current.value?.todos ?? [])
const done = computed(() => todos.value.filter((t) => t.status === 'completed').length)
const active = computed(() => todos.value.find((t) => t.status === 'in_progress'))
const open = ref(false)
</script>

<template>
  <div v-if="todos.length" class="todo">
    <button
      class="strip"
      :aria-expanded="open"
      :aria-label="open ? 'Thu gọn checklist' : 'Mở checklist'"
      @click="open = !open"
    >
      <ChevronRight class="icn-sm chev" :class="{ open }" />
      <span class="count">{{ done }}/{{ todos.length }}</span>
      <span class="now">{{ active ? active.content : 'Checklist' }}</span>
    </button>

    <ul v-if="open" class="items">
      <li
        v-for="(t, i) in todos"
        :key="i"
        :class="t.status"
        @click="cycleTodo(i)"
      >
        <Check v-if="t.status === 'completed'" class="icn-sm tick" />
        <CircleDot v-else-if="t.status === 'in_progress'" class="icn-sm tick" />
        <Circle v-else class="icn-sm tick" />
        <span class="txt">{{ t.content }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.todo {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--tap);
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.strip:active {
  background: var(--surface-2);
}
.chev {
  color: var(--text-faint);
  transition: transform 0.15s;
}
.chev.open {
  transform: rotate(90deg);
}
.count {
  /* Not mono: it is a count, not code. tabular-nums is what keeps "9/12" from
     jittering as the numbers change. */
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}
.now {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0 14px 10px;
  max-height: 46vh;
  overflow-y: auto;
}
.items li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  /* 11 + 22 (--lh-md) + 11 = exactly --tap, so a one-line row reaches the hit
     box with its text still centred instead of parked at the top. */
  min-height: var(--tap);
  padding: 11px 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text-dim);
  border-top: 1px solid var(--border);
}
.items li:active {
  opacity: 0.6;
}
.items li.in_progress {
  color: var(--text);
}
.items li.completed .txt {
  text-decoration: line-through;
  color: var(--text-faint);
}
.tick {
  color: var(--accent);
  /* Centre on the FIRST line (--lh-md = 22px box, 14px icon). */
  margin-top: 4px;
}
</style>
