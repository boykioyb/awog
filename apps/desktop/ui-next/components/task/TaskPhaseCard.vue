<template>
  <div class="tpc" :class="{ active: isActive }">
    <button class="tpc-head" :class="{ click: isInteractive }" @click="onToggle">
      <span class="tpc-idx tnum">{{ String(index).padStart(2, '0') }}</span>
      <span class="tpc-box" :class="boxClass">
        <Icon :name="statusIcon" class="tpc-boxi" :class="{ spin: phase.status === 'running' }" />
      </span>
      <div class="tpc-main">
        <div class="tpc-agent">{{ agentName }}</div>
        <div class="tpc-skill mono">{{ phase.skillName }}</div>
      </div>
      <span v-if="phase.runs.length > 1 && latestRun" class="chip tnum tpc-ver">
        {{ t('tasks.phase.version', { v: latestRun.version, n: phase.runs.length }) }}
      </span>
      <span
        v-if="latestVerdict"
        class="tag tpc-verdict"
        :class="latestVerdict === 'pass' ? 'ok' : 'fail'"
      >
        {{ latestVerdict === 'pass' ? t('tasks.phase.verdictPass') : t('tasks.phase.verdictFail') }}
      </span>
      <span v-if="gate && failCount > 0" class="chip tnum tpc-loop">
        {{ t('tasks.phase.loop', { n: failCount, max: gate.maxIterations }) }}
      </span>
      <span v-if="phase.status === 'waiting_approval'" class="tag warn tpc-flag">
        {{ t('tasks.phase.approvalNeeded') }}
      </span>
      <span v-if="phase.status === 'running'" class="tpc-live">
        <Icon name="act" class="tpc-livei" />
        {{ t('tasks.phase.live') }}
      </span>
      <span v-else-if="currentRun?.duration" class="tpc-dur tnum">{{ currentRun.duration }}</span>
      <Icon v-if="isInteractive" name="chev" class="tpc-chv" :class="{ open: expanded }" />
    </button>

    <div v-if="expanded && currentRun" class="tpc-body">
      <!-- run history -->
      <div v-if="phase.runs.length > 1" class="tpc-history">
        <span class="tpc-history-label">{{ t('tasks.phase.history') }}</span>
        <button
          v-for="r in phase.runs"
          :key="r.version"
          class="chip tnum tpc-runchip"
          :class="{ on: shownVersion === r.version, dead: r.status === 'superseded' }"
          :title="r.triggeredBy === 'auto-loop' ? t('tasks.phase.autoLoopRun') : undefined"
          @click.stop="selectedVersion = r.version"
        >
          <Icon v-if="r.triggeredBy === 'auto-loop'" name="refresh" class="tpc-rc-loop" />
          v{{ r.version }}
          <span v-if="r.verdict === 'pass'" class="tpc-rc-ok">✓</span>
          <span v-else-if="r.verdict === 'fail'" class="tpc-rc-fail">✗</span>
        </button>
      </div>

      <!-- tabs + actions -->
      <div class="tpc-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="tpc-tab"
          :class="{ on: activeTab === tab.id }"
          @click.stop="activeTab = tab.id"
        >
          {{ tab.label }}
          <span v-if="tab.badge != null" class="chip tnum tpc-tabbadge">{{ tab.badge }}</span>
        </button>
        <span class="tpc-tabsp" />
        <button
          v-if="phase.status === 'waiting_approval'"
          class="btn pri sm"
          @click.stop="emit('approve')"
        >
          <Icon name="check" />
          {{ t('tasks.approve') }}
        </button>
        <button v-if="canRerun" class="btn sm" @click.stop="rerunOpen = true">
          <Icon name="refresh" />
          {{ t('tasks.phase.rerunFromHere') }}
        </button>
      </div>

      <!-- tab body -->
      <div class="tpc-tabbody">
        <div v-if="activeTab === 'output'" class="codeblk">
          {{ currentRun.output || t('tasks.phase.noOutput') }}
        </div>
        <div v-else-if="activeTab === 'trace'" class="tpc-trace">
          <TaskTraceNode v-for="node in currentRun.trace" :key="node.id" :item="node" :depth="0" />
          <div v-if="!currentRun.trace.length" class="tpc-empty">
            {{ t('tasks.phase.noTrace') }}
          </div>
        </div>
        <div v-else class="tpc-discuss">
          <div v-if="currentRun.messages.length" class="tpc-msgs">
            <div v-for="(m, i) in currentRun.messages" :key="i" class="tpc-msg" :class="m.role">
              <span class="tpc-msg-role">{{ t(`tasks.phase.role.${m.role}`) }}</span>
              <span class="tpc-msg-text">{{ m.text }}</span>
            </div>
          </div>
          <div v-else class="tpc-empty">{{ t('tasks.phase.noDiscuss') }}</div>
          <div class="tpc-composer">
            <input
              v-model="draft"
              class="tpc-input"
              :placeholder="t('tasks.phase.discussPh')"
              @keydown.enter="sendDiscuss"
            />
            <button class="btn sm" :disabled="!draft.trim()" @click="sendDiscuss">
              <Icon name="send" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- rerun instruction modal -->
    <LibraryEntityModal
      :open="rerunOpen"
      :title="t('tasks.rerun.title', { agent: agentName })"
      :width="460"
      @close="rerunOpen = false"
    >
      <div class="tpc-rerun">
        <p class="tpc-rerun-hint">{{ t('tasks.rerun.hint') }}</p>
        <textarea
          v-model="rerunInstruction"
          class="tpc-rerun-ta"
          rows="4"
          :placeholder="t('tasks.rerun.ph')"
        />
      </div>
      <template #footer>
        <button class="btn" @click="rerunOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn pri" @click="confirmRerun">{{ t('tasks.rerun.confirm') }}</button>
      </template>
    </LibraryEntityModal>
  </div>
</template>

<script setup lang="ts">
// One pipeline phase — expandable card with status, run-version history, and
// Output / Execution / Discussion tabs (plus approve + rerun actions). Port of
// the old UI PhaseCard, condensed to the ui-next surface in prototype CSS.
// Expand/tab state is component-local (ui-next has no fullscreen editor round-trip
// that would unmount this).
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import TaskTraceNode from '~/components/task/TaskTraceNode.vue'
import { useI18n } from '~/composables/useI18n'
import type { TaskPhase, TaskStatus } from '~/stores/tasks'

const props = defineProps<{
  taskId: string
  phase: TaskPhase
  agentName: string
  index: number
  taskStatus: TaskStatus
  // Gate config (ADR 0056) when this phase is a quality gate — drives the loop
  // counter ceiling display.
  gate?: { onFailTarget: string; maxIterations: number; auto: boolean }
}>()

const emit = defineEmits<{
  approve: []
  rerun: [instruction: string]
  discuss: [runVersion: number, text: string]
}>()

const { t } = useI18n()

type Tab = 'output' | 'trace' | 'discuss'

const defaultExpanded = computed(
  () => props.phase.status === 'running' || props.phase.status === 'waiting_approval',
)
const expandedManual = ref<boolean | null>(null)
const expanded = computed(() => expandedManual.value ?? defaultExpanded.value)
const activeTab = ref<Tab>('output')
const selectedVersion = ref<number | null>(null)
const rerunOpen = ref(false)
const rerunInstruction = ref('')
const draft = ref('')

const isInteractive = computed(() => props.phase.runs.length > 0)
const onToggle = () => {
  if (isInteractive.value) expandedManual.value = !expanded.value
}

const latestRun = computed(() => props.phase.runs[props.phase.runs.length - 1])
const shownVersion = computed(() => selectedVersion.value ?? latestRun.value?.version ?? 0)
const currentRun = computed(
  () => props.phase.runs.find((r) => r.version === shownVersion.value) ?? latestRun.value,
)

const isActive = computed(
  () => props.phase.status === 'running' || props.phase.status === 'waiting_approval',
)

// Gate verdict UI (ADR 0056). verdict lives on the run; the loop counter is this
// gate's own fail-verdict count vs its iteration ceiling — self-contained.
const latestVerdict = computed(() => latestRun.value?.verdict)
const failCount = computed(() => props.phase.runs.filter((r) => r.verdict === 'fail').length)
const canRerun = computed(
  () =>
    props.phase.runs.length > 0 &&
    (props.phase.status === 'completed' ||
      props.phase.status === 'waiting_approval' ||
      props.taskStatus === 'completed'),
)

const STATUS_ICON: Record<TaskPhase['status'], string> = {
  completed: 'check',
  running: 'act',
  waiting_approval: 'clock',
  waiting_connection: 'clock',
  failed: 'alert',
  pending: 'clock',
}
const statusIcon = computed(() => STATUS_ICON[props.phase.status])
const boxClass = computed(() => {
  if (props.phase.status === 'completed' || props.phase.status === 'running') return 'ok'
  if (props.phase.status === 'waiting_approval') return 'warn'
  if (props.phase.status === 'failed') return 'fail'
  return 'idle'
})

const countTrace = (run = currentRun.value): number => {
  if (!run) return 0
  let n = 0
  const walk = (nodes: typeof run.trace) => {
    for (const node of nodes) {
      n += 1
      if (node.children) walk(node.children)
    }
  }
  walk(run.trace)
  return n
}

const tabs = computed<{ id: Tab; label: string; badge: number | null }[]>(() => [
  { id: 'output', label: t('tasks.phase.tab.output'), badge: null },
  { id: 'trace', label: t('tasks.phase.tab.execution'), badge: countTrace() },
  {
    id: 'discuss',
    label: t('tasks.phase.tab.discussion'),
    badge: currentRun.value?.messages.length || null,
  },
])

const sendDiscuss = () => {
  const text = draft.value.trim()
  if (!text || !currentRun.value) return
  emit('discuss', currentRun.value.version, text)
  draft.value = ''
}

const confirmRerun = () => {
  emit('rerun', rerunInstruction.value.trim())
  rerunInstruction.value = ''
  rerunOpen.value = false
}
</script>

<style scoped>
.tpc {
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
  overflow: hidden;
}
.tpc.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.tpc-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: 0;
  text-align: left;
  cursor: default;
}
.tpc-head.click {
  cursor: pointer;
}
.tpc-head.click:hover {
  background: var(--bgHover);
}
.tpc-idx {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  flex: 0 0 auto;
  min-width: 16px;
}
.tpc-box {
  width: 24px;
  height: 24px;
  border-radius: var(--r-xs);
  flex: 0 0 auto;
  display: grid;
  place-items: center;
}
.tpc-box.ok {
  background: var(--accentDim);
  color: var(--accent);
}
.tpc-box.warn {
  background: var(--amberDim);
  color: var(--amber);
}
.tpc-box.fail {
  background: var(--dangerDim);
  color: var(--danger);
}
.tpc-box.idle {
  background: var(--bgActive);
  color: var(--textDim);
}
.tpc-boxi {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.tpc-boxi.spin {
  animation: tpc-pulse 1.4s ease-in-out infinite;
}
@keyframes tpc-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.tpc-main {
  flex: 1;
  min-width: 0;
}
.tpc-agent {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpc-skill {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpc-ver,
.tpc-flag,
.tpc-verdict,
.tpc-loop {
  flex: 0 0 auto;
}
.tpc-verdict.ok {
  color: var(--green);
  border-color: var(--green);
}
.tpc-verdict.fail {
  color: var(--danger);
  border-color: var(--dangerBorder);
}
.tpc-loop {
  color: var(--amber);
  border-color: var(--amberBorder);
}
.tpc-rc-loop {
  width: 10px;
  height: 10px;
  margin-right: 2px;
  vertical-align: -1px;
}
.tpc-rc-ok {
  color: var(--green);
  margin-left: 2px;
}
.tpc-rc-fail {
  color: var(--danger);
  margin-left: 2px;
}
.tpc-live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  flex: 0 0 auto;
}
.tpc-livei {
  width: 10px;
  height: 10px;
  animation: tpc-pulse 1.4s ease-in-out infinite;
}
.tpc-dur {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  flex: 0 0 auto;
}
.tpc-chv {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textDim);
  flex: 0 0 auto;
  transition: transform 0.15s;
}
.tpc-chv.open {
  transform: rotate(180deg);
}
.tpc-body {
  border-top: 1px solid var(--border);
}
.tpc-history {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bgSubtle);
}
.tpc-history-label {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.tpc-runchip {
  cursor: pointer;
}
.tpc-runchip.on {
  color: var(--text);
  border-color: var(--borderStrong);
  background: var(--bgActive);
}
.tpc-runchip.dead {
  text-decoration: line-through;
  color: var(--textFaint);
}
.tpc-tabs {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bgSubtle);
}
.tpc-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  background: transparent;
  border: 0;
  border-bottom: 1.5px solid transparent;
  margin-bottom: -1px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 500;
  cursor: pointer;
}
.tpc-tab.on {
  color: var(--text);
  border-bottom-color: var(--accent);
}
.tpc-tabbadge {
  padding: 1px 6px;
}
.tpc-tabsp {
  flex: 1;
}
.tpc-tabbody {
  padding: 12px;
}
.tpc-trace {
  /* mono-ok: phase trace output */
  font-family: var(--code);
}
.tpc-empty {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
  padding: 8px 0;
}
.tpc-msgs {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.tpc-msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tpc-msg-role {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.tpc-msg-text {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.tpc-msg.user .tpc-msg-role {
  color: var(--accent);
}
.tpc-composer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tpc-input {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  border-radius: var(--r-sm);
  padding: 6px 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.tpc-input:focus {
  border-color: var(--accent);
}
.tpc-rerun {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tpc-rerun-hint {
  font-size: var(--fs-sm);
  color: var(--textMuted);
  line-height: 1.55;
}
.tpc-rerun-ta {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  font-size: var(--fs-sm);
  font-family: var(--sans);
  resize: vertical;
  min-height: 4rem;
  outline: none;
  line-height: 1.5;
}
.tpc-rerun-ta:focus {
  border-color: var(--accent);
}
</style>
