<template>
  <!-- Background shells (ADR 0066). Docked above the composer: one chip per
       Bash(run_in_background) command in this session — running (with a stop
       affordance) or finished (exit code). P1 surfaces state; the reactive wake
       (auto-continue / "Continue" card) lands in P2. -->
  <div v-if="shells.length" class="bgsh">
    <div
      v-for="sh in shells"
      :key="sh.shellId"
      class="bgsh-chip"
      :class="`is-${statusKind(sh)}`"
      :title="sh.command"
    >
      <span v-if="sh.status === 'running'" class="bgsh-dot" />
      <Icon v-else :name="iconFor(sh)" style="width: 12px; height: 12px" />
      <span class="bgsh-cmd">{{ shortCmd(sh.command) }}</span>
      <span class="bgsh-hint">{{ hintFor(sh) }}</span>
      <button
        v-if="sh.status === 'running'"
        type="button"
        class="bgsh-stop"
        :title="t('sessions.bg.stop')"
        @click="onStop(sh.shellId)"
      >
        <Icon name="stop" style="width: 11px; height: 11px" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Background-shell chips for the active session. Reads the store's live bg-shell
// map (fed by session.background-* events) and hydrates it on open so a reload
// recovers shells started before the listener attached.
import type { Session } from '~/composables/useSessionsData'
import type { BgShellState } from '~/stores/sessions'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()

const shells = computed<BgShellState[]>(() =>
  props.session.engineId ? store.bgShellsFor(props.session.engineId) : [],
)

// Hydrate whenever the bound session changes (open / switch tab).
watch(
  () => props.session.engineId,
  (eid) => {
    if (eid) void store.loadBackgroundShells(eid)
  },
  { immediate: true },
)

function statusKind(sh: BgShellState): 'running' | 'ok' | 'fail' {
  if (sh.status === 'running') return 'running'
  if (sh.status === 'exited' && (sh.exitCode ?? 1) === 0) return 'ok'
  return 'fail'
}

function iconFor(sh: BgShellState): string {
  return statusKind(sh) === 'ok' ? 'check' : 'alert'
}

function hintFor(sh: BgShellState): string {
  if (sh.status === 'running') return t('sessions.bg.running')
  if (sh.status === 'exited-unknown') return t('sessions.bg.interrupted')
  return t('sessions.bg.exit', { code: sh.exitCode ?? '?' })
}

function shortCmd(cmd: string): string {
  const oneLine = cmd.replace(/\s+/g, ' ').trim()
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine
}

function onStop(shellId: string): void {
  if (props.session.engineId) void store.killBackgroundShell(props.session.engineId, shellId)
}
</script>

<style scoped>
.bgsh {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px 0;
}
.bgsh-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 320px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  font-size: 12px;
  line-height: 1.2;
  color: var(--text);
}
.bgsh-chip.is-running {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}
.bgsh-chip.is-fail {
  border-color: color-mix(in srgb, var(--amber) 45%, var(--border));
}
.bgsh-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: bgsh-pulse 1.4s ease-in-out infinite;
}
.bgsh-cmd {
  font-family: var(--code, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bgsh-hint {
  opacity: 0.6;
  white-space: nowrap;
}
.bgsh-chip.is-ok .icn {
  color: var(--green, var(--add));
}
.bgsh-chip.is-fail .icn {
  color: var(--amber);
}
.bgsh-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px;
  border-radius: 4px;
  color: var(--text);
  opacity: 0.55;
  transition: opacity 0.12s var(--ease, ease);
}
.bgsh-stop:hover {
  opacity: 1;
  color: var(--danger);
}
@keyframes bgsh-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
