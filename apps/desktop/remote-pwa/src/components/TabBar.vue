<script setup lang="ts">
import { computed } from 'vue'
import { ListTodo, MessagesSquare, Server } from 'lucide-vue-next'
import { awaitingCount, navTab, rootRoute } from '../store'
import { keyboardInset } from '../viewport'
import { buzz } from '../notify'

// Bottom tab bar — the app-level navigation (Sessions | Tasks), iOS-style:
// translucent strip, accent tint on the active tab, badge for gates waiting.
// A pushed view (session) renders above it; the keyboard hides it entirely.
const hidden = computed(() => keyboardInset.value > 0)

function go(r: 'list' | 'tasks' | 'ssh'): void {
  if (rootRoute.value === r) return
  buzz(6)
  navTab(r)
}
</script>

<template>
  <nav v-show="!hidden" class="tabbar">
    <button
      class="tab"
      :class="{ on: rootRoute === 'list' }"
      aria-label="Sessions"
      @click="go('list')"
    >
      <span class="ic">
        <MessagesSquare class="icn-xl" />
        <i v-if="awaitingCount" class="bdg">{{ awaitingCount }}</i>
      </span>
      <span class="lb">Sessions</span>
    </button>
    <button
      class="tab"
      :class="{ on: rootRoute === 'tasks' }"
      aria-label="Tasks"
      @click="go('tasks')"
    >
      <span class="ic"><ListTodo class="icn-xl" /></span>
      <span class="lb">Tasks</span>
    </button>
    <button
      class="tab"
      :class="{ on: rootRoute === 'ssh' }"
      aria-label="SSH"
      @click="go('ssh')"
    >
      <span class="ic"><Server class="icn-xl" /></span>
      <span class="lb">SSH</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  flex: 0 0 auto;
  display: flex;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  /* --sab collapses to 0 while the keyboard is up (viewport.ts); the bar is
     also v-show-hidden then, so this only matters with the keyboard closed. */
  padding-bottom: var(--sab, env(safe-area-inset-bottom));
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  /* 50px is the iOS tab-bar height; the icon+label stack never reaches the
     44px-per-target rule, which exists for rows of buttons side by side — a
     full-width half-bar hit area is the point here. */
  min-height: 50px;
  padding-top: 4px;
  border: none;
  background: transparent;
  color: var(--text-faint);
}
.tab:active {
  opacity: 0.6;
}
.tab.on {
  color: var(--accent);
}
.ic {
  position: relative;
  display: flex;
}
.lb {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.bdg {
  position: absolute;
  top: -5px;
  right: -12px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--warn);
  color: var(--on-warn);
  font-size: var(--fs-xs);
  line-height: 16px;
  font-weight: 700;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
</style>
