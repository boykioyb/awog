<template>
  <Card
    class="gap-0 overflow-hidden rounded-lg py-0"
    :class="{ 'border-primary ring-1 ring-primary': isActive }"
  >
    <!-- raw-ok: tiêu đề card cả dòng là vùng bấm mở/đóng, chứa nhiều cột nội dung -->
    <button
      class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      :class="isInteractive ? 'cursor-pointer hover:bg-accent' : 'cursor-default'"
      @click="onToggle"
    >
      <span class="min-w-4 shrink-0 text-xs tabular-nums text-faint">
        {{ String(index).padStart(2, '0') }}
      </span>
      <span class="grid size-6 shrink-0 place-items-center rounded-sm" :class="boxClass">
        <Icon
          :name="statusIcon"
          class="size-3.5"
          :class="{ 'animate-pulse': phase.status === 'running' }"
        />
      </span>
      <div class="min-w-0 flex-1">
        <div class="truncate text-base font-medium text-foreground">{{ agentName }}</div>
        <div class="truncate font-mono text-xs text-dim">{{ phase.skillName }}</div>
      </div>
      <Badge
        v-if="phase.runs.length > 1 && latestRun"
        variant="outline"
        class="shrink-0 rounded-sm tabular-nums text-muted-foreground"
      >
        {{ t('tasks.phase.version', { v: latestRun.version, n: phase.runs.length }) }}
      </Badge>
      <Badge
        v-if="latestVerdict"
        variant="outline"
        class="shrink-0 rounded-sm"
        :class="
          latestVerdict === 'pass'
            ? 'border-success text-success'
            : 'border-destructive/40 text-destructive'
        "
      >
        {{ latestVerdict === 'pass' ? t('tasks.phase.verdictPass') : t('tasks.phase.verdictFail') }}
      </Badge>
      <Badge
        v-if="gate && failCount > 0"
        variant="outline"
        class="shrink-0 rounded-sm border-warning/40 tabular-nums text-warning"
      >
        {{ t('tasks.phase.loop', { n: failCount, max: gate.maxIterations }) }}
      </Badge>
      <Badge
        v-if="phase.status === 'waiting_approval'"
        variant="outline"
        class="shrink-0 rounded-sm border-warning/40 text-warning"
      >
        {{ t('tasks.phase.approvalNeeded') }}
      </Badge>
      <span
        v-if="phase.status === 'running'"
        class="inline-flex shrink-0 items-center gap-1 text-xs text-dim"
      >
        <Icon name="act" class="size-2.5 animate-pulse" />
        {{ t('tasks.phase.live') }}
      </span>
      <span v-else-if="currentRun?.duration" class="shrink-0 text-xs tabular-nums text-dim">
        {{ currentRun.duration }}
      </span>
      <Icon
        v-if="isInteractive"
        name="chev"
        class="size-3.5 shrink-0 text-dim transition-transform"
        :class="{ 'rotate-180': expanded }"
      />
    </button>

    <div v-if="expanded && currentRun" class="border-t">
      <!-- run history -->
      <div
        v-if="phase.runs.length > 1"
        class="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2"
      >
        <span class="text-xs text-dim">{{ t('tasks.phase.history') }}</span>
        <Button
          v-for="r in phase.runs"
          :key="r.version"
          variant="outline"
          size="xs"
          class="gap-1 tabular-nums"
          :class="[
            shownVersion === r.version ? 'bg-accent text-foreground' : 'text-muted-foreground',
            { 'text-faint line-through': r.status === 'superseded' },
          ]"
          :title="r.triggeredBy === 'auto-loop' ? t('tasks.phase.autoLoopRun') : undefined"
          @click.stop="selectedVersion = r.version"
        >
          <Icon v-if="r.triggeredBy === 'auto-loop'" name="refresh" />
          v{{ r.version }}
          <span v-if="r.verdict === 'pass'" class="text-success">✓</span>
          <span v-else-if="r.verdict === 'fail'" class="text-destructive">✗</span>
        </Button>
      </div>

      <!-- tabs + actions -->
      <div class="flex items-center gap-3 border-b bg-muted px-3">
        <Tabs :model-value="activeTab" @update:model-value="(v) => (activeTab = v as Tab)">
          <TabsList class="h-9 justify-start gap-3 rounded-none bg-transparent p-0">
            <TabsTrigger
              v-for="tab in tabs"
              :key="tab.id"
              :value="tab.id"
              class="h-9 gap-1.5 rounded-none border-b-2 border-transparent px-0 text-sm text-dim data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              @click.stop
            >
              {{ tab.label }}
              <Badge
                v-if="tab.badge != null"
                variant="outline"
                class="rounded-sm px-1.5 py-0 tabular-nums text-muted-foreground"
              >
                {{ tab.badge }}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span class="flex-1" />
        <Button
          v-if="phase.status === 'waiting_approval'"
          variant="default"
          size="sm"
          @click.stop="emit('approve')"
        >
          <Icon name="check" />
          {{ t('tasks.approve') }}
        </Button>
        <Button v-if="canRerun" variant="outline" size="sm" @click.stop="rerunOpen = true">
          <Icon name="refresh" />
          {{ t('tasks.phase.rerunFromHere') }}
        </Button>
      </div>

      <!-- tab body -->
      <div class="p-3">
        <div
          v-if="activeTab === 'output'"
          class="rounded-lg border bg-muted p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {{ currentRun.output || t('tasks.phase.noOutput') }}
        </div>
        <div v-else-if="activeTab === 'trace'" class="font-mono">
          <TaskTraceNode v-for="node in currentRun.trace" :key="node.id" :item="node" :depth="0" />
          <div v-if="!currentRun.trace.length" class="py-2 text-sm text-dim">
            {{ t('tasks.phase.noTrace') }}
          </div>
        </div>
        <div v-else>
          <div v-if="currentRun.messages.length" class="mb-3 flex flex-col gap-2">
            <div v-for="(m, i) in currentRun.messages" :key="i" class="flex flex-col gap-1">
              <span class="text-xs" :class="m.role === 'user' ? 'text-primary' : 'text-dim'">
                {{ t(`tasks.phase.role.${m.role}`) }}
              </span>
              <span class="text-sm break-words whitespace-pre-wrap text-foreground">
                {{ m.text }}
              </span>
            </div>
          </div>
          <div v-else class="py-2 text-sm text-dim">{{ t('tasks.phase.noDiscuss') }}</div>
          <div class="flex items-center gap-2">
            <Input
              v-model="draft"
              :placeholder="t('tasks.phase.discussPh')"
              @keydown.enter="sendDiscuss"
            />
            <Button :disabled="!draft.trim()" variant="outline" size="sm" @click="sendDiscuss">
              <Icon name="send" />
            </Button>
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
      <div class="flex flex-col gap-2.5">
        <p class="text-sm text-muted-foreground">{{ t('tasks.rerun.hint') }}</p>
        <Textarea
          v-model="rerunInstruction"
          class="min-h-16 resize-y"
          rows="4"
          :placeholder="t('tasks.rerun.ph')"
        />
      </div>
      <template #footer>
        <Button variant="outline" @click="rerunOpen = false">{{ t('common.cancel') }}</Button>
        <Button variant="default" @click="confirmRerun">{{ t('tasks.rerun.confirm') }}</Button>
      </template>
    </LibraryEntityModal>
  </Card>
</template>

<script setup lang="ts">
// One pipeline phase — expandable card with status, run-version history, and
// Output / Execution / Discussion tabs (plus approve + rerun actions).
// Expand/tab state is component-local (ui-next has no fullscreen editor round-trip
// that would unmount this).
import { computed, ref } from 'vue'
import Icon from '~/components/Icon.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import TaskTraceNode from '~/components/task/TaskTraceNode.vue'
import { useI18n } from '~/composables/useI18n'
import type { TaskPhase, TaskStatus } from '~/stores/tasks'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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
  if (props.phase.status === 'completed' || props.phase.status === 'running')
    return 'bg-selected text-primary'
  if (props.phase.status === 'waiting_approval') return 'bg-warning/15 text-warning'
  if (props.phase.status === 'failed') return 'bg-destructive/15 text-destructive'
  return 'bg-muted text-dim'
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
