<template>
  <section class="page on" data-page="tasks">
    <LibraryView
      :items="TASKS"
      :item-key="(t) => t.id"
      :search-text="(t) => t.title"
      :placeholder="t('tasks.search')"
      show-new
    >
      <template #row="{ item: task }">
        <div class="lrow">
          <span
            class="sdot"
            :class="{ pulse: task.status === 'running' }"
            :style="{ background: dotColor(task.status) }"
          />
          <span class="ttl">{{ task.title }}</span>
        </div>
        <div class="sub">
          <span class="tag" :class="tagClass(task.status)">
            {{ t(`tasks.status.${task.status}`) }}
          </span>
          <span>{{ task.agent }} · {{ task.pct }}%</span>
        </div>
      </template>

      <template #detail="{ item: task }">
        <div class="dh">
          <div>
            <div class="dt">{{ task.title }}</div>
            <div class="dsub">{{ task.sub }}</div>
          </div>
          <span style="flex: 1" />
          <button class="btn sm">{{ t('tasks.discuss') }}</button>
          <button class="btn sm">{{ t('tasks.rerun') }}</button>
          <button v-if="task.status === 'awaiting'" class="btn pri sm">
            <Icon name="check" />
            {{ t('tasks.approve') }}
          </button>
        </div>
        <div class="dscroll">
          <div class="th" style="margin-bottom: 10px">
            <Icon name="workflows" />
            <span class="tt">
              {{ t('tasks.pipeline', { done: doneCount(task), total: task.nodes.length }) }}
            </span>
            <span class="ct">{{ task.pct }}%</span>
          </div>
          <div class="nodes">
            <div v-for="(n, i) in task.nodes" :key="i" class="node">
              <span class="nx" :class="nodeClass(n.s)">
                <Icon v-if="n.s === 'ok'" name="check" style="width: 13px; height: 13px" />
                <span v-else-if="n.s === 'run'" class="pulse" />
                <Icon v-else name="clock" style="width: 13px; height: 13px" />
              </span>
              <div>
                <div class="nn">{{ n.n }}</div>
                <div class="nm2">{{ n.w }}</div>
              </div>
              <span class="ne">{{ n.e }}</span>
            </div>
          </div>
          <div class="sech">{{ t('tasks.trace') }}</div>
          <div class="codeblk">{{ task.trace }}</div>
        </div>
      </template>
    </LibraryView>
  </section>
</template>

<script setup lang="ts">
// Tasks library — faithful port of awog-prototype.html (data-page="tasks").
// Status-dot rows + master-detail pipeline (node list + trace). Static mock; the
// master-detail shell + search/new come from <LibraryView>. Visual only.

const { t } = useI18n()

type TaskStatus = 'running' | 'awaiting' | 'done'
type NodeStatus = 'ok' | 'run' | 'idle'

type TaskNode = {
  n: string
  w: string
  s: NodeStatus
  e: string
}

type TaskItem = {
  id: string
  title: string
  status: TaskStatus
  agent: string
  pct: number
  sub: string
  nodes: TaskNode[]
  trace: string
}

const TASKS: TaskItem[] = [
  {
    id: 't1',
    title: 'Lazy-load transcripts (ADR 0048)',
    status: 'running',
    agent: 'tech-lead',
    pct: 62,
    sub: 'workflow · tech-lead → developer → qa',
    nodes: [
      { n: 'Scope & read codebase', w: 'tech-lead · 12 tool calls', s: 'ok', e: '38s' },
      { n: 'Draft ADR 0048', w: 'tech-lead · committed a1b2c3d', s: 'ok', e: '1m 04s' },
      { n: 'Write IPC contract + types', w: 'developer · đang chạy…', s: 'run', e: 'running' },
      { n: 'Implement lazy loader', w: 'developer · chờ node trước', s: 'idle', e: '—' },
      { n: 'QA + verify AC', w: 'qa-tester', s: 'idle', e: '—' },
    ],
    trace:
      '▸ developer reading methods/sessions.ts\n✓ Read 1 file (214 lines)\n▸ Edit types/index.ts  +12 −0\n▸ git auto-commit "feat(session): lazy-load IPC types"',
  },
  {
    id: 't2',
    title: 'Audit fs.* path sanitize',
    status: 'running',
    agent: 'infosec',
    pct: 28,
    sub: 'single · infosec',
    nodes: [
      { n: 'Scan workspace I/O sinks', w: 'infosec · đang chạy…', s: 'run', e: 'running' },
      { n: 'Verify path traversal', w: 'infosec', s: 'idle', e: '—' },
      { n: 'Report findings', w: 'infosec', s: 'idle', e: '—' },
    ],
    trace: '▸ Grep "path.join" — 18 matches\n▸ Read fs.ts',
  },
  {
    id: 't3',
    title: 'Wire enhance-prompt method',
    status: 'awaiting',
    agent: 'developer',
    pct: 50,
    sub: 'single · developer',
    nodes: [
      { n: 'Đọc composer + store', w: 'developer', s: 'ok', e: '22s' },
      { n: 'Thêm method enhance-prompt', w: 'developer · chờ duyệt', s: 'idle', e: '—' },
    ],
    trace: '⏸ Chờ duyệt: cho phép writeFile methods/sessions.enhance-prompt.ts',
  },
  {
    id: 't4',
    title: 'Redesign Git reference UI',
    status: 'done',
    agent: 'developer',
    pct: 100,
    sub: 'workflow · TL → dev → reviewer',
    nodes: [
      { n: 'Plan', w: 'tech-lead', s: 'ok', e: '40s' },
      { n: 'Implement', w: 'developer', s: 'ok', e: '6m' },
      { n: 'Review', w: 'code-reviewer', s: 'ok', e: '1m' },
    ],
    trace: '✓ Hoàn tất · 3 commit',
  },
]

const dotColor = (status: TaskStatus): string =>
  status === 'running'
    ? 'var(--accent)'
    : status === 'awaiting'
      ? 'var(--amber)'
      : 'var(--textFaint)'

const tagClass = (status: TaskStatus): string =>
  status === 'running' ? 'acc' : status === 'awaiting' ? 'warn' : ''

const nodeClass = (s: NodeStatus): string => (s === 'ok' ? 'ok' : s === 'run' ? 'run' : 'idle')

const doneCount = (t: TaskItem): number => t.nodes.filter((n) => n.s === 'ok').length
</script>
