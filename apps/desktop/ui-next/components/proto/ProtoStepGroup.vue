<template>
  <div>
    <!-- Group header — chevron + count pill + "Steps completed · N failed" +
         live preview, same shape as SessionTurnActivities -->
    <Button
      variant="ghost"
      class="h-auto p-0 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
      :aria-expanded="open"
      @click="open = !open"
    >
      <ChevronDown
        class="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150"
        :class="!open && '-rotate-90'"
      />
      <span
        class="inline-flex h-4 min-w-[18px] items-center justify-center rounded border border-border px-1 font-mono text-[11px] leading-none"
      >
        {{ entries.length }}
      </span>
      <span>Steps completed</span>
      <span v-if="failed > 0" class="text-destructive">· {{ failed }} failed</span>
      <span v-if="running > 0" class="flex items-center gap-1 text-primary">
        <Loader2 class="size-3 animate-spin" />
        {{ running }} running
      </span>
      <span class="min-w-0 flex-1 truncate text-left text-muted-foreground/60">
        {{ headerPreview }}
      </span>
    </Button>

    <!-- Body: tree indent — left hairline rail groups the run as one unit -->
    <div v-if="open" class="mt-0.5 ml-[11px] flex flex-col gap-0.5 border-l border-border pl-3">
      <template v-for="(e, i) in entries" :key="i">
        <!-- Tool step: icon + name + …dir/target + result + Ns + chev, body on expand -->
        <div v-if="e.kind === 'step'" class="rounded-md">
          <Button
            variant="ghost"
            class="h-auto p-0 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent"
            :aria-expanded="expanded.has(i)"
            @click="toggle(i)"
          >
            <!-- Running: icon stays put, a thin ring spins AROUND it
                 (rotating the glyph itself reads sloppy) -->
            <span class="relative flex size-3.5 shrink-0 items-center justify-center">
              <component :is="stepIcon(e.step.tool)" class="size-3.5" :class="iconCls(e.step)" />
              <span
                v-if="e.step.status === 'running'"
                class="absolute -inset-[3px] animate-spin rounded-full border border-transparent border-t-primary border-r-primary/50"
              />
            </span>
            <span
              class="shrink-0 font-medium"
              :class="e.step.status === 'fail' ? 'text-destructive' : 'text-foreground/90'"
            >
              {{ e.step.tool }}
            </span>
            <span
              v-if="e.step.target"
              class="flex min-w-0 font-mono text-muted-foreground"
              :title="e.step.target"
            >
              <!-- dir half ellipsizes, filename stays visible — but a target
                   with no "/" (a bare command) must truncate as one span,
                   else the fixed name overflows into the result/elapsed chips -->
              <template v-if="shortTarget(e.step.target).dir">
                <span class="min-w-0 truncate">{{ shortTarget(e.step.target).dir }}</span>
                <span class="shrink-0">{{ shortTarget(e.step.target).name }}</span>
              </template>
              <span v-else class="truncate">{{ e.step.target }}</span>
            </span>
            <!-- SessionStepResult parity — "+N −M" tokens tint add/del -->
            <span
              v-if="e.step.result"
              class="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground"
            >
              <span
                v-for="(t, ti) in resultTokens(e.step.result)"
                :key="ti"
                :class="
                  t.startsWith('+')
                    ? 'text-success'
                    : t.startsWith('−') || t.startsWith('-')
                      ? 'text-destructive'
                      : ''
                "
              >
                {{ t }}
              </span>
            </span>
            <span class="flex-1" />
            <span v-if="e.step.elapsed" class="shrink-0 text-muted-foreground/70 tabular-nums">
              {{ e.step.elapsed }}s
            </span>
            <!-- File-op steps: open the touched file in the shared PreviewModal
                 without expanding (SessionStepItem.viewFile parity) -->
            <span
              v-if="fileTarget(e.step)"
              role="button"
              class="flex shrink-0 items-center rounded p-0.5 text-muted-foreground/60 hover:bg-accent-foreground/10 hover:text-foreground"
              :title="`View ${e.step.target}`"
              @click.stop="viewFile(e.step)"
            >
              <FileText class="size-3" />
            </span>
            <ChevronDown
              class="size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150"
              :class="!expanded.has(i) && '-rotate-90'"
            />
          </Button>

          <!-- Step body — SessionStepBody parity: diff | file | input/output -->
          <div v-if="expanded.has(i)" class="mt-0.5 mb-1 ml-6 flex flex-col gap-1.5">
            <!-- Full path row for file payloads (header only shows the tail) -->
            <template v-if="isFileView(e.step)">
              <span class="text-[10px] font-semibold text-muted-foreground uppercase">Path</span>
              <pre
                class="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground"
                >{{ e.step.target }}</pre
              >
            </template>

            <!-- Unified diff → colored +/- rows with new-side line numbers -->
            <div
              v-if="diffLines(e.step).length"
              class="overflow-x-auto rounded-md border border-border font-mono text-[11px] leading-relaxed"
            >
              <div
                v-for="(l, li) in diffLines(e.step)"
                :key="li"
                class="flex min-w-max"
                :class="
                  l.t === '+'
                    ? 'bg-success/10 text-success'
                    : l.t === '-'
                      ? 'bg-destructive/10 text-destructive'
                      : l.t === '@'
                        ? 'bg-muted/60 text-muted-foreground italic'
                        : 'text-muted-foreground'
                "
              >
                <span
                  class="w-8 shrink-0 border-r border-border/50 px-1.5 text-right select-none opacity-50"
                >
                  {{ l.n ?? '' }}
                </span>
                <span class="w-4 shrink-0 text-center select-none">
                  {{ l.t === '+' ? '+' : l.t === '-' ? '−' : l.t === '@' ? '' : '' }}
                </span>
                <span class="pr-3 whitespace-pre">{{ l.s }}</span>
              </div>
            </div>

            <!-- File content (Write/Read) -->
            <pre
              v-else-if="e.step.detailKind === 'file' && e.step.detail"
              class="overflow-x-auto rounded-md border border-border bg-muted/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90"
              >{{ e.step.detail }}</pre
            >

            <!-- Raw: Input (full untruncated target) + Output -->
            <template v-else>
              <template v-if="e.step.target">
                <span class="text-[10px] font-semibold text-muted-foreground uppercase">Input</span>
                <pre
                  class="font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground/85"
                  >{{ e.step.target }}</pre
                >
              </template>
              <span
                class="text-[10px] font-semibold text-muted-foreground uppercase"
                :class="e.step.target && 'border-t border-border/60 pt-1.5'"
              >
                Output
              </span>
              <pre
                class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
                :class="e.step.status === 'fail' ? 'text-destructive/90' : 'text-muted-foreground'"
                >{{ e.step.output ?? e.step.detail ?? 'No output captured' }}</pre
              >
            </template>
          </div>
        </div>

        <!-- Extended-thinking block — collapsible reasoning -->
        <div v-else-if="e.kind === 'think'" class="rounded-md">
          <Button
            variant="ghost"
            class="h-auto p-0 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
            :aria-expanded="expanded.has(i)"
            @click="toggle(i)"
          >
            <ChevronDown
              class="size-3 shrink-0 transition-transform duration-150"
              :class="!expanded.has(i) && '-rotate-90'"
            />
            <Brain class="size-3.5 shrink-0" />
            <span class="italic">Thinking</span>
          </Button>
          <div
            v-if="expanded.has(i)"
            class="mt-0.5 mb-1 ml-6 border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground italic"
          >
            {{ e.text }}
          </div>
        </div>

        <!-- Intermediate commentary — dimmed so it reads as activity, not answer -->
        <p v-else class="px-1.5 py-1 text-xs leading-relaxed text-muted-foreground/80">
          {{ e.text }}
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Turn activity group — SessionTurnActivities parity: one collapsible unit
// holding tool steps + thinking + commentary, rail-indented like craft's
// TurnCard tree. Step rows are collapsed by default (AWOG convention).
import { computed, reactive, ref } from 'vue'
import {
  Bot,
  Brain,
  ChevronDown,
  FileText,
  FolderSearch,
  GitBranch,
  Globe,
  ListTodo,
  Loader2,
  PenLine,
  Search,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import type { ProtoActivity, ProtoStep } from '~/composables/useProtoSession'
import { useProtoPreview } from '~/composables/useProtoPreview'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ entries: ProtoActivity[] }>()
const preview = useProtoPreview()

const open = ref(false)
const expanded = reactive(new Set<number>())
function toggle(i: number) {
  if (expanded.has(i)) expanded.delete(i)
  else expanded.add(i)
}

const failed = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'fail').length,
)
const running = computed(
  () => props.entries.filter((e) => e.kind === 'step' && e.step.status === 'running').length,
)
// One-line live preview of what the turn is doing (last step's target).
const headerPreview = computed(() => {
  const last = [...props.entries].reverse().find((e) => e.kind === 'step')
  return last?.kind === 'step' ? (last.step.target ?? last.step.tool) : ''
})

// Same mapping as SessionStepItem.stepIcon — keyword over canonical + human
// labels ("Run", "Update", "Background agent", …).
function stepIcon(tool: string) {
  const k = tool.toLowerCase()
  if (k.includes('agent') || k.includes('task')) return Bot
  if (k.includes('grep') || k.includes('search')) return Search
  if (k.includes('glob') || k.includes('find')) return FolderSearch
  if (k.includes('read')) return FileText
  if (/edit|write|update|create|notebook/.test(k)) return PenLine
  if (/bash|run|exec|shell|command|kill/.test(k)) return Terminal
  if (k.includes('web') || k.includes('fetch')) return Globe
  if (k.includes('todo')) return ListTodo
  if (k.includes('git')) return GitBranch
  return Wrench
}

function iconCls(s: ProtoStep) {
  return s.status === 'fail'
    ? 'text-destructive'
    : s.status === 'running'
      ? 'text-primary'
      : 'text-muted-foreground'
}

// Production keeps the filename visible and ellipsizes the dir half
// ("…/app/models/order.py").
function shortTarget(target: string): { dir: string; name: string } {
  const raw = target.trim()
  if (!raw.includes('/')) return { dir: '', name: raw }
  const segs = raw.split('/')
  const name = segs.pop() ?? ''
  const dirs = segs.filter((s) => s.length > 0)
  const kept = dirs.slice(-2)
  const prefix = kept.length < dirs.length ? '…/' : raw.startsWith('/') ? '/' : ''
  return { dir: kept.length ? `${prefix}${kept.join('/')}/` : prefix, name }
}

// SessionStepResult: split the header result string into whitespace-kept
// tokens so "+N" tints add and "−N" tints del (spacing tokens pass through).
function resultTokens(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean)
}

// ── Step body: diff | file | input/output (SessionStepBody parity) ───────────
// File-op tools whose target is the touched file — same regex as production.
const FILE_TOOL = /read|edit|write|update|create|notebook/i
const isFileView = (s: ProtoStep) =>
  (s.detailKind === 'diff' || s.detailKind === 'file') && !!s.detail
const fileTarget = (s: ProtoStep) =>
  FILE_TOOL.test(s.tool) && s.target && s.target.includes('/') ? s.target : null

function viewFile(s: ProtoStep) {
  const t = fileTarget(s)
  if (!t) return
  preview.open({
    name: t.split('/').pop() ?? t,
    kind: s.detailKind === 'file' ? 'markdown' : 'text',
    text: s.detail ?? s.output ?? '',
    size: s.result,
  })
}

// Minimal unified-diff parser — production shape: track the new-side line
// number from @@ hunk headers, skip git file headers.
type DiffLine = { t: '+' | '-' | ' ' | '@'; n?: number; s: string }
function diffLines(s: ProtoStep): DiffLine[] {
  if (s.detailKind !== 'diff' || !s.detail) return []
  const out: DiffLine[] = []
  let n = 0
  for (const raw of s.detail.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw)
      n = m?.[1] ? parseInt(m[1], 10) : n
      out.push({ t: '@', s: raw })
      continue
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(raw)) continue
    if (raw.startsWith('+')) out.push({ t: '+', n: n++, s: raw.slice(1) })
    else if (raw.startsWith('-')) out.push({ t: '-', s: raw.slice(1) })
    else out.push({ t: ' ', n: n++, s: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  return out
}
</script>
