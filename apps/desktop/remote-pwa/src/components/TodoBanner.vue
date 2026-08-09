<script setup lang="ts">
import { computed, ref } from 'vue'
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
    <button class="strip" @click="open = !open">
      <span class="chev" :class="{ open }">›</span>
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
        <span class="tick">{{
          t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'
        }}</span>
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
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text);
  text-align: left;
}
.chev {
  color: var(--text-faint);
  transition: transform 0.15s;
  flex-shrink: 0;
}
.chev.open {
  transform: rotate(90deg);
}
.count {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}
.now {
  font-size: 13px;
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
  padding: 7px 0;
  font-size: 14px;
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
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}
</style>
