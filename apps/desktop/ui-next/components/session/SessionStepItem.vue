<template>
  <div>
    <!-- Hàng step — phẳng, dày (proto `rounded-md px-1.5 py-1 text-xs`, hover wash), không
         khung card: rail của lượt đã gom nhóm. Mặc định ĐÓNG, một dòng truncate. -->
    <!-- raw-ok: hàng step cả dòng là một vùng bấm, bên trong có span role=button lồng -->
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-foreground select-none transition-colors hover:bg-accent motion-reduce:transition-none"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <!-- Running indicator (proto idiom): the tool icon stays put and a thin arc
           ring spins AROUND it — animating the glyph itself reads sloppy. -->
      <span class="relative flex size-3.5 shrink-0 items-center justify-center">
        <Icon
          :name="isTodo ? 'tasks' : stepIcon(block.tool)"
          class="size-3.5 flex-none"
          :class="iconTone"
        />
        <span
          v-if="block.status === 'running'"
          class="absolute -inset-0.75 animate-spin rounded-full border border-transparent border-t-primary border-r-primary/50"
        />
      </span>
      <span
        class="flex-none font-medium"
        :class="block.status === 'error' ? 'text-destructive' : 'text-foreground/90'"
      >
        {{ block.tool }}
      </span>
      <!-- mono-ok: tham số tool — path hoặc lệnh shell. Cặp [dir co được][tên file
           không co] nằm trong; flex-1 đẩy các chip phía sau sang phải. -->
      <span
        class="flex min-w-0 flex-1 overflow-hidden font-mono whitespace-nowrap text-muted-foreground"
        :title="resolvedTarget"
      >
        <!-- dir half ellipsizes, filename stays visible — but a target with no "/"
             (a bare command) must truncate as one span, else the fixed name
             overflows into the result/elapsed chips (reported overflow bug). -->
        <template v-if="shortTarget(resolvedTarget).dir">
          <span class="min-w-0 truncate">{{ shortTarget(resolvedTarget).dir }}</span>
          <span class="shrink-0">{{ shortTarget(resolvedTarget).name }}</span>
        </template>
        <span v-else class="truncate">{{ resolvedTarget }}</span>
      </span>
      <SessionStepResult :text="isTodo ? todoCount : block.result" />
      <!-- Live per-tool elapsed (craft ActivityRow parity): surfaces only once a running
           tool has been going ≥2s, so fast reads/edits stay quiet. -->
      <span v-if="showElapsed" class="flex-none text-muted-foreground/70 tabular-nums">
        {{ elapsedSec }}s
      </span>
      <!-- File-op steps: open the touched file in the shared PreviewModal without
           expanding. span[role=button] — a real button element would nest inside the row
           button. -->
      <span
        v-if="topFileTarget"
        role="button"
        class="inline-flex flex-none cursor-pointer items-center rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
        :title="t('sessions.step.viewFile')"
        @click.stop="viewFile(block.tool, block.target)"
      >
        <Icon name="file" class="size-3" />
      </span>
      <!-- Chevron mở/đóng — xoay -90° khi đóng. -->
      <Icon
        name="chev"
        class="size-3 flex-none text-muted-foreground/50 transition-transform motion-reduce:transition-none"
        :class="[collapsed ? '-rotate-90' : '']"
      />
    </button>
    <Collapse :open="!collapsed">
      <!-- Thân: thụt vào dưới cột icon (proto `ml-6`). Step lỗi: khối OUTPUT trong
           SessionStepBody (`data-sout`) nhuộm destructive. -->
      <div
        class="mt-0.5 mb-1 ml-6 flex flex-col gap-1.5"
        :class="{ '[&_[data-sout]]:text-destructive/90': block.status === 'error' }"
      >
        <!-- todo checklist (a TodoWrite note step rendered inline once the live banner
             has yielded — i.e. all done or the turn ended). Reuses the banner rows. -->
        <SessionTodoList v-if="isTodo" :todos="block.todos ?? []" />

        <!-- subagent (has children) — rail accent gom nhóm lượt chạy lồng. -->
        <div v-else-if="block.sub" class="mt-1 flex flex-col gap-0.5 border-l-2 border-ring pl-2.5">
          <div class="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Icon name="agents" class="size-3" />
            {{ block.sub.agent }}
          </div>
          <div v-for="(sub, i) in block.sub.steps" :key="i">
            <!-- raw-ok: hàng sub-step cả dòng là một vùng bấm, có span role=button lồng -->
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-foreground select-none transition-colors hover:bg-accent motion-reduce:transition-none"
              :aria-expanded="subExpanded.has(i)"
              @click="toggleSub(i)"
            >
              <span class="relative flex size-3.5 shrink-0 items-center justify-center">
                <Icon :name="stepIcon(sub.tool)" class="size-3.5 flex-none text-muted-foreground" />
              </span>
              <span class="flex-none font-medium text-foreground/90">{{ sub.tool }}</span>
              <!-- mono-ok: tham số tool — path hoặc lệnh shell -->
              <span
                class="flex min-w-0 flex-1 overflow-hidden font-mono whitespace-nowrap text-muted-foreground"
                :title="subTarget(sub)"
              >
                <template v-if="shortTarget(subTarget(sub)).dir">
                  <span class="min-w-0 truncate">{{ shortTarget(subTarget(sub)).dir }}</span>
                  <span class="shrink-0">{{ shortTarget(subTarget(sub)).name }}</span>
                </template>
                <span v-else class="truncate">{{ subTarget(sub) }}</span>
              </span>
              <SessionStepResult :text="sub.result" />
              <span
                v-if="fileTargetOf(sub.tool, subTarget(sub))"
                role="button"
                class="inline-flex flex-none cursor-pointer items-center rounded-sm p-0.5 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
                :title="t('sessions.step.viewFile')"
                @click.stop="viewFile(sub.tool, subTarget(sub))"
              >
                <Icon name="file" class="size-3" />
              </span>
              <Icon
                name="chev"
                class="size-3 flex-none text-muted-foreground/50 transition-transform motion-reduce:transition-none"
                :class="[subExpanded.has(i) ? '' : '-rotate-90']"
              />
            </button>
            <Collapse :open="subExpanded.has(i)">
              <div class="mt-0.5 mb-1 ml-6 flex flex-col gap-1.5">
                <SessionStepBody
                  :tool="sub.tool"
                  :target="subTarget(sub)"
                  :detail="subDetail(sub)"
                  :detail-kind="subDetailKind(sub)"
                  :pending="subDetailPending(sub) || subTargetPending(sub)"
                />
              </div>
            </Collapse>
          </div>
          <!-- The subagent's final report — the summary it returns to the main agent
               (Task tool result). Without this the nested timeline ends at the last
               tool call and the handed-back summary is invisible. -->
          <div v-if="summaryText" class="mt-1 flex flex-col gap-1 border-t pt-2">
            <div class="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Icon name="check" class="size-3" />
              {{ t('sessions.step.subagentSummary') }}
              <!-- "Xem đủ báo cáo" — đẩy sang phải, mở báo cáo trong PreviewModal chung. -->
              <Button
                v-if="summaryTruncated"
                type="button"
                variant="ghost"
                size="iconSm"
                class="ml-auto size-5 text-muted-foreground/60 hover:text-foreground [&_svg]:size-3"
                :title="t('sessions.step.viewSummary')"
                @click.stop="openSummary"
              >
                <Icon name="maximize" />
              </Button>
            </div>
            <SessionTextBlock :text="summaryPreview" />
            <Button
              v-if="summaryTruncated"
              type="button"
              variant="link"
              size="xs"
              class="h-auto self-start px-0 py-px font-normal hover:no-underline hover:opacity-75"
              @click.stop="openSummary"
            >
              {{ t('sessions.step.viewSummary') }}
            </Button>
          </div>
        </div>

        <!-- skill — một dòng mô tả -->
        <div v-else-if="isSkill" class="text-xs leading-(--lh-md) text-muted-foreground">
          {{ block.detail || t('sessions.step.skillRunning') }}
        </div>

        <!-- diff / file / output — real detail only; empty when none was captured -->
        <SessionStepBody
          v-else
          :tool="block.tool"
          :target="resolvedTarget"
          :detail="resolvedDetail"
          :detail-kind="resolvedDetailKind"
          :pending="detailPending || resolvedTargetPending"
        />
      </div>
    </Collapse>
  </div>
</template>

<script setup lang="ts">
// A single tool step (blockHtml step branch ~1461 + stepInner ~1479 + subHtml ~1486).
// Collapsed-by-default: the header toggles the body, matching the transcript-wide
// fold broadcast. shadcn re-skin (proto ProtoStepGroup parity): flat rows on
// hover-wash, ring-spinner while running, destructive tint on failure.
import type { StepBlock, SubStep } from '~/composables/useSessionsData'

const props = defineProps<{
  block: StepBlock
  // Persisted id (eid, ADR 0074) của message chứa step này — cần để fetch
  // detail deferred qua sessions.stepDetail (sessionId + messageId + stepId).
  msgEid?: string
}>()
const { t } = useI18n()
const scope = useSessionScope()
const store = useSessionsStore()

// A cache row is either `{pending:true}` (fetch in flight — block "no output")
// or the resolved `{detail, detailKind, target}`; narrow before reading fields.
type DetailHit =
  | { detail?: string; detailKind?: StepBlock['detailKind']; target?: string }
  | undefined
function hitOf(stepEid: string | undefined, deferred: boolean | undefined): DetailHit {
  if (!stepEid || !deferred) return undefined
  const engineId = scope.session.value?.engineId
  if (!engineId || !props.msgEid) return undefined
  const row = store.stepDetailOf(engineId, props.msgEid, stepEid)
  return row && 'pending' in row ? undefined : row
}
function hitPending(stepEid: string | undefined, deferred: boolean | undefined): boolean {
  if (!stepEid || !deferred) return false
  const engineId = scope.session.value?.engineId
  if (!engineId || !props.msgEid) return false
  const row = store.stepDetailOf(engineId, props.msgEid, stepEid)
  // Not-yet-fetched also counts as pending — the expand watcher fires the fetch
  // next tick; showing "(no output)" for one frame would flicker.
  return row === undefined || 'pending' in row
}

// Detail payload của block — trực tiếp trên block khi có (live / dưới ngưỡng
// defer), còn detailDeferred thì đọc từ cache reactive của store (transcript
// markRaw ⇒ block.detail không thể mutate có phản ứng, cache là đường duy nhất).
const resolvedDetail = computed<string | undefined>(() => {
  const b = props.block
  if (b.detail !== undefined) return b.detail
  return hitOf(b.eid, b.detailDeferred)?.detail
})
const resolvedDetailKind = computed<StepBlock['detailKind']>(() => {
  const b = props.block
  if (b.detail !== undefined) return b.detailKind
  return hitOf(b.eid, b.detailDeferred)?.detailKind ?? b.detailKind
})
const detailPending = computed<boolean>(() =>
  hitPending(props.block.eid, props.block.detailDeferred),
)

// Substep twins — same deferred contract keyed on the sub-step's own eid.
function subDetail(st: SubStep): string | undefined {
  return st.detail !== undefined ? st.detail : hitOf(st.eid, st.detailDeferred)?.detail
}
function subDetailKind(st: SubStep): StepBlock['detailKind'] {
  return st.detail !== undefined
    ? st.detailKind
    : (hitOf(st.eid, st.detailDeferred)?.detailKind ?? st.detailKind)
}
function subDetailPending(st: SubStep): boolean {
  return hitPending(st.eid, st.detailDeferred)
}

// Lazy fetch: the first expand of a deferred step triggers sessions.stepDetail.
function fetchDetailIfNeeded(stepEid: string | undefined, deferred: boolean | undefined): void {
  if (!deferred || !stepEid) return
  const engineId = scope.session.value?.engineId
  if (!engineId || !props.msgEid) return
  void store.ensureStepDetail(engineId, props.msgEid, stepEid)
}

// Target có thể là preview 512B khi `targetDeferred` (lệnh heredoc dài) — full
// string đi cùng fetch stepDetail. Header/body đọc resolved; khi chưa tới nơi
// hiển thị preview (đuôi "…" báo còn nữa — appended ở đây vì slice thô không
// đánh dấu truncate).
const resolvedTarget = computed<string>(() => {
  const b = props.block
  if (!b.targetDeferred) return b.target
  const hit = hitOf(b.eid, true)
  return hit?.target ?? `${b.target}…`
})
const resolvedTargetPending = computed<boolean>(() =>
  hitPending(props.block.eid, props.block.targetDeferred),
)
function subTarget(st: SubStep): string {
  if (!st.targetDeferred) return st.target
  return hitOf(st.eid, true)?.target ?? `${st.target}…`
}
function subTargetPending(st: SubStep): boolean {
  return hitPending(st.eid, st.targetDeferred)
}

// Live per-tool elapsed (craft ActivityRow parity, ADR 0061 Pha 5). Once a running
// step has been going ≥2s, show a subtle "Xs" ticker so long-running tools read as
// busy; fast tools never surface it. Client-side — timed from when the row first saw
// 'running', which is accurate for a live turn (historical steps are already done).
const running = computed(() => props.block.status === 'running')
const elapsedSec = ref(0)
let startAt = 0
let stepTimer: ReturnType<typeof setInterval> | null = null
function stopStepTimer() {
  if (stepTimer) {
    clearInterval(stepTimer)
    stepTimer = null
  }
}
watch(
  running,
  (on) => {
    if (on) {
      startAt = performance.now()
      elapsedSec.value = 0
      stopStepTimer()
      stepTimer = setInterval(() => {
        elapsedSec.value = Math.floor((performance.now() - startAt) / 1000)
      }, 1000)
    } else {
      stopStepTimer()
    }
  },
  { immediate: true },
)
onBeforeUnmount(stopStepTimer)
const showElapsed = computed(() => running.value && elapsedSec.value >= 2)

// Shared full-window PreviewModal (provided by SessionDetail). Lets a file-op step
// open the file it touched without expanding the step or leaving the transcript.
const filePreview = useFilePreview()

// File-operation tools whose `target` is the file they touched (matches both prototype
// tool names and the engine's human labels: Read/Edit/Write/Update/Create/…).
const FILE_TOOL = /read|edit|write|update|create|notebook/i

// Resolve a step's viewable file path (or null). Reuses filePathOf to clean the
// path (strip ./ and :line, reject URLs / search patterns / quoted args); falls
// back to a path-safe token so extensionless files (Makefile, LICENSE) still get
// a button. Non-file tools (Bash/Grep/Glob…) never surface one.
function fileTargetOf(tool: string, target: string): string | null {
  if (!FILE_TOOL.test(tool)) return null
  const raw = (target || '').trim()
  if (!raw) return null
  const detected = filePathOf(raw)
  if (detected) return detected
  if (!/\s/.test(raw) && /^[\w./#@~+-]+$/.test(raw)) return raw
  return null
}
const topFileTarget = computed(() => fileTargetOf(props.block.tool, props.block.target))

// Write-class tools land on the file's DIFF doc (what the step changed); reads
// open the file itself. Both route through filePreview's tab resolution.
const WRITE_TOOL = /edit|write|update|create|notebook/i

function viewFile(tool: string, target: string): void {
  const path = fileTargetOf(tool, target)
  if (!path) return
  if (WRITE_TOOL.test(tool)) filePreview.openDiff(path)
  else filePreview.open(path)
}

// A TodoWrite note step (carries `todos`) renders its checklist inline; a subagent
// step renders via the sub-step loop (when `block.sub` is set); a Skill step shows
// its description text; everything else delegates to SessionStepBody.
const isTodo = computed(() => props.block.todos !== undefined)
const todoCount = computed(() => {
  const td = props.block.todos
  if (!td || !td.length) return ''
  return `${td.filter((x) => x.done).length}/${td.length}`
})
const isSkill = computed(() => /skill/i.test(props.block.tool))

// A long absolute path used to lose its TAIL to the header's ellipsis — the half that
// says which file this step touched. Show the last two directories plus the filename
// ("…/app/models/order.py"), rendered as [ellipsisable dirs][never-clipped filename];
// the untouched full path stays on `title` and in the expanded body's Path row.
const TARGET_DIRS_SHOWN = 2
function shortTarget(target: string): { dir: string; name: string } {
  const raw = target?.trim() ?? ''
  if (!raw.includes('/')) return { dir: '', name: raw }
  const segments = raw.split('/')
  const name = segments.pop() ?? ''
  const dirs = segments.filter((s) => s.length > 0)
  const kept = dirs.slice(-TARGET_DIRS_SHOWN)
  const prefix = kept.length < dirs.length ? '…/' : raw.startsWith('/') ? '/' : ''
  return { dir: kept.length > 0 ? `${prefix}${kept.join('/')}/` : prefix, name }
}

// A subagent's (Task) final report = the text it returns to the main agent, carried
// on the step's `detail` (the FULL report — step-mapper persists Task results up to
// FILE_DETAIL_MAX) or the truncated `result` chip. Surfaced as a concluding summary
// block under the nested sub-steps; long reports are clipped inline (see below).
const summaryText = computed(() => {
  const b = props.block
  if (!b.sub) return ''
  const detail = resolvedDetail.value
  if (detail && (!b.detailKind || b.detailKind === 'text')) return detail
  return b.result ?? ''
})

// Keep the INLINE report compact so a long subagent report doesn't flood the
// transcript: render a bounded preview here and reveal the full text in the modal.
const SUMMARY_INLINE_MAX = 1200
const summaryTruncated = computed(() => summaryText.value.length > SUMMARY_INLINE_MAX)
const summaryPreview = computed(() =>
  summaryTruncated.value
    ? `${summaryText.value.slice(0, SUMMARY_INLINE_MAX)}\n\n…`
    : summaryText.value,
)

// Open the subagent's FULL report in the shared full-window PreviewModal — a long
// report reads better (and scrolls) in the modal; markdown kind gives the
// render/raw toggle. Named after the agent so the modal title has context.
const { open: openPreview } = usePreview()
function openSummary(): void {
  if (!summaryText.value) return
  openPreview({
    name: props.block.sub?.agent || t('sessions.step.subagentSummary'),
    kind: 'markdown',
    text: summaryText.value,
  })
}

// Per-tool glyph for the step header. Matches both canonical tool names (prototype:
// Read/Edit/Bash/…) and the engine's human labels ("Run", "Search", "Update", …)
// via keyword. Keeps a recognizable icon per step type instead of a bare row.
function stepIcon(tool: string): string {
  const k = (tool || '').toLowerCase()
  if (k.includes('task') || k.includes('agent')) return 'agents'
  if (k.includes('skill')) return 'skills'
  if (k.includes('grep') || k.includes('search')) return 'search'
  if (k.includes('glob') || k.includes('find')) return 'folder'
  if (k.includes('read')) return 'rules'
  if (
    k.includes('edit') ||
    k.includes('write') ||
    k.includes('update') ||
    k.includes('create') ||
    k.includes('notebook')
  )
    return 'edit'
  if (
    k.includes('bash') ||
    k.includes('run') ||
    k.includes('exec') ||
    k.includes('shell') ||
    k.includes('command') ||
    k.includes('kill')
  )
    return 'commands'
  if (k.includes('web') || k.includes('fetch')) return 'search'
  if (k.includes('todo')) return 'check'
  if (k.includes('git')) return 'git'
  if (k.includes('plan')) return 'rules'
  return 'commands'
}

// Màu glyph theo trạng thái: lỗi = destructive, đang chạy = primary (vòng xoay quanh
// nó lo phần chuyển động), còn lại muted.
const iconTone = computed(() => {
  if (props.block.status === 'error') return 'text-destructive'
  if (props.block.status === 'running') return 'text-primary'
  return 'text-muted-foreground'
})

// Collapsed-by-default: header click toggles the step body.
const collapsed = ref(true)

// Nested sub-steps collapse independently; track expanded indices in a reactive Set.
const subExpanded = reactive(new Set<number>())

// Transcript-wide collapse-all / expand-all: follow the broadcast signal, mirroring
// the body's open state across every nested sub-step too. Manual clicks still work
// (they just set local state until the next broadcast).
const fold = useStepFold()
watch(
  () => fold.signal.seq,
  () => {
    const expand = fold.signal.mode === 'expand'
    collapsed.value = !expand
    subExpanded.clear()
    if (expand && props.block.sub) props.block.sub.steps.forEach((_, i) => subExpanded.add(i))
  },
)
const toggleSub = (i: number) => {
  if (subExpanded.has(i)) {
    subExpanded.delete(i)
    return
  }
  subExpanded.add(i)
  const st = props.block.sub?.steps[i]
  if (st) fetchDetailIfNeeded(st.eid, st.detailDeferred || st.targetDeferred)
}

// Deferred detail (sessions.get lite): first expand of THIS step's body fires
// the lazy sessions.stepDetail fetch — covering the own-detail branches
// (SessionStepBody) AND a subagent's deferred final report (summaryText reads
// the same cache). Individual sub-steps fetch on their own expand above.
watch(
  collapsed,
  (isCollapsed) => {
    if (!isCollapsed)
      fetchDetailIfNeeded(props.block.eid, props.block.detailDeferred || props.block.targetDeferred)
  },
  { immediate: true },
)
</script>
