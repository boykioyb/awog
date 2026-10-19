<template>
  <!-- Background work (ADR 0066). Docked above the composer: one chip per task the
       session runs in the background — a `Bash(run_in_background)` shell on the Pi
       path, a CLI-backgrounded shell/subagent on the Claude SDK path. Both arrive
       through the same registry, so the two runtimes look identical here.

       Two rules keep the strip from silting up (it used to grow all session long):
       a finished chip retires once the model has read its result, and anything
       left over collapses behind one summary chip.

       Cùng cấu trúc composer: padding --padX ở ngoài + inner max-w 860px căn giữa —
       dải chip thẳng mép với card composer thay vì trôi về lề chat. Màu trạng thái
       chỉ tô viền/glyph (running → primary, ok → success, fail → destructive). -->
  <div v-if="visible.length" class="px-(--padX) pt-1.5">
    <div class="mx-auto flex max-w-215 flex-wrap gap-1.5">
      <Button
        v-if="visible.length > 1"
        variant="outline"
        size="xs"
        class="h-auto max-w-80 gap-1.5 rounded-md bg-transparent px-2 py-0.5 text-sm leading-4 font-semibold text-foreground"
        :class="
          summaryKind === 'running'
            ? 'border-primary/45'
            : summaryKind === 'fail'
              ? 'border-destructive/45'
              : 'border-border'
        "
        :title="expanded ? t('sessions.bg.summary.collapse') : t('sessions.bg.summary.expand')"
        @click="expanded = !expanded"
      >
        <span v-if="runningCount" class="size-2 animate-pulse rounded-full bg-primary" />
        <Icon
          v-else
          :name="failedCount ? 'alert' : 'check'"
          class="size-3"
          :class="failedCount ? 'text-destructive' : 'text-success'"
        />
        <span>{{ summaryText }}</span>
        <Icon
          name="chev"
          class="size-3 opacity-55 transition-transform"
          :class="expanded && 'rotate-180'"
        />
      </Button>
      <div
        v-for="sh in shown"
        :key="sh.shellId"
        class="inline-flex max-w-80 items-center gap-1.5 rounded-md border bg-muted px-2 py-0.5 text-sm leading-4 text-foreground"
        :class="
          statusKind(sh) === 'running'
            ? 'border-primary/45'
            : statusKind(sh) === 'fail'
              ? 'border-destructive/45'
              : ''
        "
        :title="sh.command"
      >
        <span v-if="sh.status === 'running'" class="size-2 animate-pulse rounded-full bg-primary" />
        <Icon
          v-else
          :name="iconFor(sh)"
          class="size-3"
          :class="statusKind(sh) === 'ok' ? 'text-success' : 'text-destructive'"
        />
        <!-- mono: lệnh shell -->
        <span class="truncate font-mono">{{ shortCmd(sh.command) }}</span>
        <span class="whitespace-nowrap text-muted-foreground">{{ hintFor(sh) }}</span>
        <Button
          variant="ghost"
          size="iconSm"
          class="size-4 rounded-sm text-muted-foreground hover:text-foreground"
          :title="t('sessionsBg.view')"
          :aria-label="t('sessionsBg.view')"
          @click="openOutput(sh.shellId)"
        >
          <Icon name="terminal" class="size-3" />
        </Button>
        <Button
          v-if="sh.status === 'running'"
          variant="ghost"
          size="iconSm"
          class="size-4 rounded-sm text-muted-foreground hover:text-destructive"
          :title="t('sessions.bg.stop')"
          :aria-label="t('sessions.bg.stop')"
          @click="onStop(sh.shellId)"
        >
          <Icon name="x" class="size-3" />
        </Button>
      </div>
    </div>
  </div>

  <SessionBackgroundOutputModal
    v-if="outputShell"
    :shell="outputShell"
    :output="outputText"
    @close="closeOutput"
  />
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

// "View output" modal (one at a time, per strip).
const {
  shell: outputShell,
  output: outputText,
  open: openOutput,
  close: closeOutput,
} = useSessionBackgroundOutput(() => props.session.engineId)

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
