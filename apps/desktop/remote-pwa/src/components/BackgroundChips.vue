<script setup lang="ts">
import { computed } from 'vue'
import { current } from '../store'

// Background shells started by the agent (ADR 0066). The desktop shows these as
// chips above the composer so a long `npm run build &` is visible while the turn
// moves on; the phone mirrors that — read-only (kill lives on the desktop).

const shells = computed(() => current.value?.background ?? [])

function short(command: string): string {
  const one = command.replace(/\s+/g, ' ').trim()
  return one.length > 42 ? `${one.slice(0, 41)}…` : one
}
</script>

<template>
  <div v-if="shells.length" class="chips">
    <span
      v-for="s in shells"
      :key="s.shellId"
      class="chip"
      :class="{
        run: s.status === 'running',
        bad: s.status === 'done' && s.exitCode != null && s.exitCode !== 0,
      }"
      :title="s.command"
    >
      <span class="dot" />
      <span class="cmd">{{ short(s.command) }}</span>
      <span v-if="s.status === 'done'" class="exit">{{ s.exitCode ?? '?' }}</span>
    </span>
  </div>
</template>

<style scoped>
.chips {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
  padding: 6px 12px;
  overflow-x: auto;
  border-top: 1px solid var(--border);
  -webkit-overflow-scrolling: touch;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--surface);
}
.chip.run {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  color: var(--text);
}
.chip.bad {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
  color: var(--danger);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
}
.chip.run .dot {
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}
.chip.bad .dot {
  background: var(--danger);
}
.cmd {
  font-family: var(--mono);
}
.exit {
  font-family: var(--mono);
  color: var(--text-faint);
}
@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}
</style>
