<template>
  <div>
    <button type="button" class="srow" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
      <!-- Running indicator (proto idiom): the tool icon stays put and a thin arc
           ring spins AROUND it — animating the glyph itself reads sloppy. -->
      <span class="relative flex size-3.5 shrink-0 items-center justify-center">
        <Icon
          :name="isTodo ? 'tasks' : stepIcon(block.tool)"
          class="stepic"
          :class="{ err: block.status === 'error', run: block.status === 'running' }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        <span
          v-if="block.status === 'running'"
          class="absolute -inset-[3px] animate-spin rounded-full border border-transparent border-t-primary border-r-primary/50"
        />
      </span>
      <span class="tname" :class="{ err: block.status === 'error' }">{{ block.tool }}</span>
      <span class="starg" :title="block.target">
        <!-- dir half ellipsizes, filename stays visible — but a target with no "/"
             (a bare command) must truncate as one span, else the fixed name
             overflows into the result/elapsed chips (reported overflow bug). -->
        <template v-if="shortTarget(block.target).dir">
          <span class="min-w-0 truncate">{{ shortTarget(block.target).dir }}</span>
          <span class="shrink-0">{{ shortTarget(block.target).name }}</span>
        </template>
        <span v-else class="truncate">{{ block.target }}</span>
      </span>
      <SessionStepResult :text="isTodo ? todoCount : block.result" />
      <!-- Live per-tool elapsed (craft ActivityRow parity): surfaces only once a running
           tool has been going ≥2s, so fast reads/edits stay quiet. -->
      <span v-if="showElapsed" class="sela">{{ elapsedSec }}s</span>
      <!-- File-op steps: open the touched file in the shared PreviewModal without
           expanding. span[role=button] — a real <button> would nest inside the row
           button. -->
      <span
        v-if="topFileTarget"
        role="button"
        class="sview"
        :title="t('sessions.step.viewFile')"
        @click.stop="viewFile(block.tool, block.target)"
      >
        <Icon name="file" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </span>
      <Icon
        name="chev"
        class="schev"
        :class="{ off: collapsed }"
        style="width: var(--icon-xs); height: var(--icon-xs)"
      />
    </button>
    <Collapse :open="!collapsed">
      <div class="sbody" :class="{ fail: block.status === 'error' }">
        <!-- todo checklist (a TodoWrite note step rendered inline once the live banner
             has yielded — i.e. all done or the turn ended). Reuses the banner rows. -->
        <SessionTodoList v-if="isTodo" :todos="block.todos ?? []" />

        <!-- subagent (has children) -->
        <div v-else-if="block.sub" class="substep">
          <div class="subhd">
            <Icon name="agents" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ block.sub.agent }}
          </div>
          <div v-for="(st, i) in block.sub.steps" :key="i">
            <button
              type="button"
              class="srow"
              :aria-expanded="subExpanded.has(i)"
              @click="toggleSub(i)"
            >
              <span class="relative flex size-3.5 shrink-0 items-center justify-center">
                <Icon
                  :name="stepIcon(st.tool)"
                  class="stepic"
                  style="width: var(--icon-sm); height: var(--icon-sm)"
                />
              </span>
              <span class="tname">{{ st.tool }}</span>
              <span class="starg" :title="st.target">
                <template v-if="shortTarget(st.target).dir">
                  <span class="min-w-0 truncate">{{ shortTarget(st.target).dir }}</span>
                  <span class="shrink-0">{{ shortTarget(st.target).name }}</span>
                </template>
                <span v-else class="truncate">{{ st.target }}</span>
              </span>
              <SessionStepResult :text="st.result" />
              <span
                v-if="fileTargetOf(st.tool, st.target)"
                role="button"
                class="sview"
                :title="t('sessions.step.viewFile')"
                @click.stop="viewFile(st.tool, st.target)"
              >
                <Icon name="file" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </span>
              <Icon
                name="chev"
                class="schev"
                :class="{ off: !subExpanded.has(i) }"
                style="width: var(--icon-xs); height: var(--icon-xs)"
              />
            </button>
            <Collapse :open="subExpanded.has(i)">
              <div class="sbody">
                <SessionStepBody
                  :tool="st.tool"
                  :target="st.target"
                  :detail="st.detail"
                  :detail-kind="st.detailKind"
                />
              </div>
            </Collapse>
          </div>
          <!-- The subagent's final report — the summary it returns to the main agent
               (Task tool result). Without this the nested timeline ends at the last
               tool call and the handed-back summary is invisible. -->
          <div v-if="summaryText" class="subsum">
            <div class="subhd">
              <Icon name="check" style="width: var(--icon-xs); height: var(--icon-xs)" />
              {{ t('sessions.step.subagentSummary') }}
              <button
                v-if="summaryTruncated"
                type="button"
                class="sview subview"
                :title="t('sessions.step.viewSummary')"
                @click.stop="openSummary"
              >
                <Icon name="maximize" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </button>
            </div>
            <SessionTextBlock :text="summaryPreview" />
            <button v-if="summaryTruncated" type="button" class="submore" @click.stop="openSummary">
              {{ t('sessions.step.viewSummary') }}
            </button>
          </div>
        </div>

        <!-- skill -->
        <div v-else-if="isSkill" class="skilltxt">
          {{ block.detail || t('sessions.step.skillRunning') }}
        </div>

        <!-- diff / file / output — real detail only; empty when none was captured -->
        <SessionStepBody
          v-else
          :tool="block.tool"
          :target="block.target"
          :detail="block.detail"
          :detail-kind="block.detailKind"
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
import type { StepBlock } from '~/composables/useSessionsData'

const props = defineProps<{ block: StepBlock }>()
const { t } = useI18n()

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

function viewFile(tool: string, target: string): void {
  const path = fileTargetOf(tool, target)
  if (path) filePreview.open(path)
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
  if (b.detail && (!b.detailKind || b.detailKind === 'text')) return b.detail
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
  if (subExpanded.has(i)) subExpanded.delete(i)
  else subExpanded.add(i)
}
</script>

<style scoped>
/* Step row — flat, dense (proto: `rounded-md px-1.5 py-1 text-xs`, hover wash).
   No card chrome: the turn rail already groups the run. */
.srow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  font-family: inherit;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: left;
  color: var(--foreground);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.srow:hover {
  background: var(--accent-wash);
}
/* Per-tool glyph — muted, tinted by state (destructive on error, primary while
   running — the spinning ring around it carries the motion). */
.stepic {
  flex: 0 0 auto;
  color: var(--muted-foreground);
}
.stepic.err {
  color: var(--destructive);
}
.stepic.run {
  color: var(--primary);
}
/* Tool name — medium weight, no chip fill (proto `font-medium`). */
.tname {
  flex: 0 0 auto;
  font-weight: 500;
  color: rgb(from var(--foreground) r g b / 90%);
}
.tname.err {
  color: var(--destructive);
}
/* Mono target: the [ellipsisable dirs][shrink-0 filename] pair lives inside —
   a bare command renders as one truncating span. flex:1 makes it the flex
   space-holder that pushes the trailing chips right. */
.starg {
  display: flex;
  min-width: 0;
  flex: 1;
  font-family: var(--code); /* mono-ok: tool argument — path or shell command */
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
}
/* Live "Ns" while a tool runs — quiet, tabular so it doesn't wobble. */
.sela {
  flex: 0 0 auto;
  color: rgb(from var(--muted-foreground) r g b / 70%);
  font-variant-numeric: tabular-nums;
}
/* "View file" affordance — icon-only, sits between the result chip and the
   chevron; @click.stop keeps it from toggling collapse. */
.sview {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: rgb(from var(--muted-foreground) r g b / 60%);
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.sview:hover {
  background: var(--accent-wash);
  color: var(--foreground);
}
/* Disclosure chevron — rotates 90° when collapsed. */
.schev {
  flex: 0 0 auto;
  color: rgb(from var(--muted-foreground) r g b / 50%);
  transition: transform 0.15s ease;
}
.schev.off {
  transform: rotate(-90deg);
}
/* Body: indented under the icon column (proto `ml-6`), children bring their own
   fonts/chrome. */
.sbody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 4px 24px;
}
/* Failed step: the OUTPUT pre inside SessionStepBody tints destructive. */
.sbody.fail :deep(.sout) {
  color: rgb(from var(--destructive) r g b / 90%);
}
/* Subagent block: accent rail groups the nested run (proto tree idiom). */
.substep {
  margin-top: 4px;
  padding-left: 11px;
  border-left: 2px solid var(--ring);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.subhd {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 500;
  color: var(--primary);
}
/* Subagent summary: the report handed back to the main agent, under the nested
   steps. Compact markdown with a small top divider. */
.subsum {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
/* "View full summary" button — trails the accent header row, opens the report in
   the shared PreviewModal. Reuses .sview chrome; pushed to the far right. */
.subview {
  margin-left: auto;
}
/* Text affordance under a clipped preview: opens the same full-report modal. */
.submore {
  align-self: flex-start;
  padding: 1px 0;
  border: 0;
  background: transparent;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--primary);
  cursor: pointer;
  transition: opacity 0.12s ease;
}
.submore:hover {
  opacity: 0.75;
}
/* Skill step body — one descriptive line. */
.skilltxt {
  font-size: var(--fs-xs);
  line-height: var(--lh-md);
  color: var(--muted-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .srow,
  .sview,
  .schev {
    transition: none;
  }
}
</style>
