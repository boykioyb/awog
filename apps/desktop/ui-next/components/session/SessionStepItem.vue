<template>
  <div class="step" :class="{ col: collapsed }">
    <div class="steph" @click="collapsed = !collapsed">
      <Icon
        :name="isTodo ? 'tasks' : stepIcon(block.tool)"
        class="stepic"
        style="width: var(--icon-sm); height: var(--icon-sm)"
      />
      <span class="tname">{{ block.tool }}</span>
      <span class="starg flex min-w-0" :title="block.target">
        <span class="min-w-0 truncate">{{ shortTarget(block.target).dir }}</span>
        <span class="shrink-0">{{ shortTarget(block.target).name }}</span>
      </span>
      <SessionStepResult :text="isTodo ? todoCount : block.result" />
      <!-- Live per-tool elapsed (craft ActivityRow parity): surfaces only once a running
           tool has been going ≥2s, so fast reads/edits stay quiet. -->
      <span
        v-if="showElapsed"
        class="stepela"
        style="font-size: 12px; opacity: 0.55; font-variant-numeric: tabular-nums"
      >
        {{ elapsedSec }}s
      </span>
      <button
        v-if="topFileTarget"
        class="stepview"
        :title="t('sessions.step.viewFile')"
        @click.stop="viewFile(block.tool, block.target)"
      >
        <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <Icon name="chev" style="width: var(--icon-sm); height: var(--icon-sm)" />
    </div>
    <Collapse :open="!collapsed">
      <div class="stepd">
        <!-- todo checklist (a TodoWrite note step rendered inline once the live banner
             has yielded — i.e. all done or the turn ended). Reuses the banner rows. -->
        <SessionTodoList v-if="isTodo" :todos="block.todos ?? []" />

        <!-- subagent (has children) -->
        <div v-else-if="block.sub" class="substep">
          <div class="subhd">
            <Icon name="agents" style="width: var(--icon-xs); height: var(--icon-xs)" />
            {{ block.sub.agent }}
          </div>
          <div
            v-for="(st, i) in block.sub.steps"
            :key="i"
            class="step"
            :class="{ col: !subExpanded.has(i) }"
          >
            <div class="steph" @click="toggleSub(i)">
              <Icon
                :name="stepIcon(st.tool)"
                class="stepic"
                style="width: var(--icon-sm); height: var(--icon-sm)"
              />
              <span class="tname">{{ st.tool }}</span>
              <span class="starg flex min-w-0" :title="st.target">
                <span class="min-w-0 truncate">{{ shortTarget(st.target).dir }}</span>
                <span class="shrink-0">{{ shortTarget(st.target).name }}</span>
              </span>
              <SessionStepResult :text="st.result" />
              <button
                v-if="fileTargetOf(st.tool, st.target)"
                class="stepview"
                :title="t('sessions.step.viewFile')"
                @click.stop="viewFile(st.tool, st.target)"
              >
                <Icon name="file" style="width: var(--icon-sm); height: var(--icon-sm)" />
              </button>
              <Icon name="chev" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </div>
            <Collapse :open="subExpanded.has(i)">
              <div class="stepd">
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
                class="stepview subview"
                :title="t('sessions.step.viewSummary')"
                @click.stop="openSummary"
              >
                <Icon name="maximize" style="width: var(--icon-xs); height: var(--icon-xs)" />
              </button>
            </div>
            <SessionTextBlock :text="summaryPreview" />
            <button v-if="summaryTruncated" class="submore" @click.stop="openSummary">
              {{ t('sessions.step.viewSummary') }}
            </button>
          </div>
        </div>

        <!-- skill -->
        <div
          v-else-if="isSkill"
          style="font-size: var(--fs-sm); color: var(--textMuted); line-height: var(--lh-md)"
        >
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
// Collapsed-by-default styling comes from .step.col in the prototype CSS.
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

// Collapsed-by-default: header click toggles the step body (.step.col hides .stepd).
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
/* Flat steps: drop the grey fill (prototype .step uses var(--bgSubtle)); keep the
   hairline border so the row still reads as a discrete unit on the message bg. */
.step {
  background: transparent;
}
/* Per-tool step glyph — subtle, consistent with the row's muted chrome. */
.stepic {
  flex: 0 0 auto;
  color: var(--textDim);
}
/* "View file" button — icon-only, sits between the result chip and the chevron.
   Muted by default; accents on hover. @click.stop keeps it from toggling collapse. */
.stepview {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: var(--r-xs);
  color: var(--textFaint);
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.stepview:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* The <Collapse> wrapper now owns the body's reveal; neutralize the prototype's
   `.step.col .stepd{display:none}` snap (scoped → higher specificity wins). Applies
   to the top-level body and every nested sub-step body rendered by this component. */
.step.col .stepd {
  display: block;
}
/* Sharper, more interactive step cards: hover feedback on the header (the whole
   row is the clickable expand toggle), with a tidy accent on the open state. */
.step > .steph {
  transition: background 0.12s ease;
}
.step > .steph:hover {
  background: var(--bgHover);
}
/* Subagent summary: the report handed back to the main agent, under the nested
   steps. Compact (step-context) markdown with a small top divider. */
.subsum {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
/* "View full summary" button — trails the accent header row, opens the report in
   the shared PreviewModal. Reuses .stepview chrome; pushed to the far right. */
.subview {
  margin-left: auto;
}
/* Text affordance under a clipped preview: opens the same full-report modal. */
.submore {
  align-self: flex-start;
  padding: 1px 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--accent);
  transition: opacity 0.12s ease;
}
.submore:hover {
  opacity: 0.75;
}
</style>
