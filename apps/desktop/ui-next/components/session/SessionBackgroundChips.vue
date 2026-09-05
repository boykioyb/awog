<template>
  <!-- Background work (ADR 0066). Docked above the composer: one chip per task the
       session runs in the background — a `Bash(run_in_background)` shell on the Pi
       path, a CLI-backgrounded shell/subagent on the Claude SDK path. Both arrive
       through the same registry, so the two runtimes look identical here.

       Two rules keep the strip from silting up (it used to grow all session long):
       a finished chip retires once the model has read its result, and anything
       left over collapses behind one summary chip. -->
  <div v-if="visible.length" class="bgsh">
    <button
      v-if="visible.length > 1"
      type="button"
      class="bgsh-chip bgsh-sum"
      :class="[`is-${summaryKind}`, { open: expanded }]"
      :title="expanded ? t('sessions.bg.summary.collapse') : t('sessions.bg.summary.expand')"
      @click="expanded = !expanded"
    >
      <span v-if="runningCount" class="bgsh-dot" />
      <Icon v-else :name="failedCount ? 'alert' : 'check'" style="width: 12px; height: 12px" />
      <span>{{ summaryText }}</span>
      <Icon name="chev" class="bgsh-chev" style="width: 12px; height: 12px" />
    </button>
    <div
      v-for="sh in shown"
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
        <Icon name="x" style="width: 11px; height: 11px" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Background chips for the active session. Reads the store's live map (fed by
// session.background-* events) and hydrates it on open so a reload recovers work
// started before the listener attached.
import type { Session } from '~/composables/useSessionsData'
import type { BgShellState } from '~/stores/sessions'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()

const shells = computed<BgShellState[]>(() =>
  props.session.engineId ? store.bgShellsFor(props.session.engineId) : [],
)

// A finished command whose result the model has already consumed (BashOutput read,
// wake prompt, or the runtime handing it over in-band) has nothing left to tell the
// user — retire it. A FAILED one stays: that's the case worth going back to.
const visible = computed(() => shells.value.filter((sh) => !(sh.read && statusKind(sh) === 'ok')))
const runningCount = computed(() => visible.value.filter((sh) => sh.status === 'running').length)
const failedCount = computed(() => visible.value.filter((sh) => statusKind(sh) === 'fail').length)

const expanded = ref(false)
// One chip is its own summary; from two up, collapse behind the summary row.
const shown = computed(() => (visible.value.length > 1 && !expanded.value ? [] : visible.value))

const summaryKind = computed<'running' | 'ok' | 'fail'>(() => {
  if (runningCount.value) return 'running'
  return failedCount.value ? 'fail' : 'ok'
})
const summaryText = computed(() => {
  const parts: string[] = []
  if (runningCount.value) parts.push(t('sessions.bg.summary.running', { n: runningCount.value }))
  if (failedCount.value) parts.push(t('sessions.bg.summary.failed', { n: failedCount.value }))
  const done = visible.value.length - runningCount.value - failedCount.value
  if (done > 0) parts.push(t('sessions.bg.summary.done', { n: done }))
  return parts.join(' · ')
})

// Collapse again when the strip switches session — expansion is a per-view choice.
watch(
  () => props.session.engineId,
  (eid) => {
    expanded.value = false
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
  border-radius: var(--r-xs);
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
.bgsh-sum {
  font-weight: 600;
}
.bgsh-chev {
  opacity: 0.55;
  transition: transform 0.14s var(--ease, ease);
}
.bgsh-sum.open .bgsh-chev {
  transform: rotate(180deg);
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
  border-radius: var(--r-xs);
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
