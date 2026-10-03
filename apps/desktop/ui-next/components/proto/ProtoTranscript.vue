<template>
  <ScrollArea class="min-h-0 flex-1">
    <div class="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-5 py-4">
      <div
        v-for="m in messages"
        :key="m.id"
        class="group/msg flex gap-3"
        :class="bubble && m.role === 'user' && 'flex-row-reverse'"
      >
        <!-- Avatar — hidden for user bubbles in bubble mode -->
        <span
          v-if="!(bubble && m.role === 'user')"
          :class="[
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
            m.role === 'user'
              ? 'border-border bg-muted text-muted-foreground'
              : m.role === 'agent'
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground',
          ]"
        >
          <User v-if="m.role === 'user'" class="size-3.5" />
          <Bot v-else-if="m.role === 'agent'" class="size-3.5" />
          <Wrench v-else class="size-3.5" />
        </span>

        <div
          class="flex min-w-0 flex-1 flex-col gap-1.5"
          :class="bubble && m.role === 'user' && 'items-end'"
        >
          <!-- Byline (flat) / hidden on user bubble -->
          <div
            v-if="!(bubble && m.role === 'user')"
            class="flex items-baseline gap-2"
            :class="bubble && m.role === 'user' && 'flex-row-reverse'"
          >
            <span class="text-sm font-medium text-foreground">{{ m.author }}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{{ m.time }}</span>
          </div>

          <!-- Message body: plain flow vs bubble card -->
          <div
            :class="[
              'flex min-w-0 flex-col gap-1.5',
              bubble &&
                m.role === 'agent' &&
                'rounded-xl border border-border bg-card p-3.5 shadow-sm',
              bubble &&
                m.role === 'user' &&
                'max-w-[75%] rounded-2xl rounded-tr-md bg-accent px-3.5 py-2 text-accent-foreground',
            ]"
          >
            <!-- Turn activity stream — "N steps · M failed" collapsible group
                 (SessionTurnActivities): Run/Thinking/Search/Write/subagent
                 rows, rendered BEFORE the final answer. -->
            <ProtoStepGroup v-if="m.activities?.length" :entries="m.activities" />

            <p
              v-if="m.text"
              class="text-sm leading-relaxed"
              :class="bubble && m.role === 'user' ? 'text-accent-foreground' : 'text-foreground/90'"
              @mouseup="onSelectInMsg"
            >
              {{ m.text }}
            </p>

            <!-- Rendered markdown body — the real useMarkdown pipeline -->
            <div v-if="m.md" @mouseup="onSelectInMsg">
              <ProtoMarkdown :src="m.md" />
            </div>

            <!-- Attachment chips in the bubble — click opens the shared
                 PreviewModal (same flow as SessionAttachmentChip) -->
            <div v-if="m.attachments?.length" class="flex flex-wrap gap-1.5">
              <button
                v-for="(a, ai) in m.attachments"
                :key="ai"
                :class="[
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
                  bubble && m.role === 'user'
                    ? 'border-accent-foreground/20 bg-accent-foreground/10 text-accent-foreground hover:bg-accent-foreground/20'
                    : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground',
                ]"
                :title="`Preview ${a.name}`"
                @click="preview.open(a)"
              >
                <img
                  v-if="a.kind === 'image' && a.src"
                  :src="a.src"
                  class="size-4 rounded"
                  :alt="a.name"
                />
                <component :is="attIcon(a.kind)" v-else class="size-3.5" />
                <span class="max-w-40 truncate">{{ a.name }}</span>
                <span v-if="a.size" class="opacity-60 tabular-nums">{{ a.size }}</span>
              </button>
            </div>

            <!-- TodoWrite checklist block -->
            <div
              v-if="m.todo"
              class="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-2.5"
            >
              <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ListTodo class="size-3" />
                Plan
              </div>
              <div v-for="(t, i) in m.todo" :key="i" class="flex items-center gap-2 text-sm">
                <CheckCircle2 v-if="t.done" class="size-3.5 shrink-0 text-success" />
                <Circle v-else class="size-3.5 shrink-0 text-muted-foreground" />
                <span :class="t.done ? 'text-muted-foreground line-through' : 'text-foreground'">
                  {{ t.text }}
                </span>
              </div>
            </div>

            <!-- Tool call card -->
            <div
              v-if="m.tool"
              class="overflow-hidden rounded-lg border border-border bg-muted/50 shadow-sm"
            >
              <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <component
                  :is="toolIcon[m.tool.status]"
                  :class="['size-3.5 shrink-0', toolCls[m.tool.status]]"
                />
                <span class="text-xs font-medium text-foreground">{{ m.tool.name }}</span>
                <span v-if="m.tool.cmd" class="truncate font-mono text-xs text-muted-foreground">
                  {{ m.tool.cmd }}
                </span>
                <!-- Step elapsed — surfaces ≥2s like SessionStepItem's stepela -->
                <span
                  v-if="m.tool.elapsed != null && m.tool.elapsed >= 2"
                  class="ml-auto shrink-0 text-xs text-muted-foreground/70 tabular-nums"
                >
                  {{ m.tool.elapsed }}s
                </span>
              </div>
              <pre
                v-if="m.tool.output"
                class="max-h-40 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground"
                >{{ m.tool.output }}</pre
              >
            </div>

            <!-- Code block -->
            <div v-if="m.code" class="overflow-hidden rounded-lg border border-border bg-muted">
              <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
                <Terminal class="size-3 text-muted-foreground" />
                <span class="text-xs text-muted-foreground">{{ m.code.lang }}</span>
                <span class="flex-1" />
                <Button
                  variant="ghost"
                  size="iconSm"
                  class="size-6"
                  aria-label="Copy code"
                  @click="copy(m.code.body, m.id + '-code')"
                >
                  <Check v-if="copiedId === m.id + '-code'" class="text-success" />
                  <Copy v-else />
                </Button>
              </div>
              <pre
                class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90"
                >{{ m.code.body }}</pre
              >
            </div>

            <!-- Mermaid diagram -->
            <ProtoMermaid v-if="m.mermaid" :code="m.mermaid" />
          </div>

          <!-- Action footer — SessionMsgActions shape: primary icons + ⋯ overflow,
               revealed on hover (always visible for the streaming last turn). -->
          <div
            class="flex items-center gap-0.5 text-muted-foreground"
            :class="bubble && m.role === 'user' && 'flex-row-reverse'"
          >
            <!-- Turn meta — mirrors SessionMessageItem's byline footer:
                 "{at} · {tok} tok · {elapsed}" (elapsed only once the turn ends) -->
            <span class="mr-1 text-xs tabular-nums">
              {{ m.time }} · {{ tokLabel(m) }} tok
              <template v-if="m.elapsedSec">· {{ elapsedLabel(m.elapsedSec) }}</template>
            </span>
            <div
              class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100"
              :class="bubble && m.role === 'user' && 'flex-row-reverse'"
            >
              <template v-for="a in primaryFor(m)" :key="a.icon">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      class="size-6 text-muted-foreground hover:text-foreground"
                      :aria-label="a.title"
                      @click="a.run(m)"
                    >
                      <component :is="a.icon" class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ a.title }}</TooltipContent>
                </Tooltip>
              </template>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    class="size-6 text-muted-foreground hover:text-foreground"
                    aria-label="More actions"
                  >
                    <MoreHorizontal class="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" class="w-48">
                  <template v-for="(a, i) in overflowFor(m)" :key="i">
                    <DropdownMenuSeparator v-if="a.sep" />
                    <DropdownMenuItem
                      v-else
                      :class="
                        a.danger &&
                        'text-destructive focus:bg-destructive/10 focus:text-destructive'
                      "
                      @click="a.run?.(m)"
                    >
                      <component :is="a.icon" />
                      {{ a.label }}
                    </DropdownMenuItem>
                  </template>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      <!-- Thinking indicator -->
      <div class="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
        <Loader2 class="size-3 animate-spin" />
        <span>Composing…</span>
      </div>
    </div>
  </ScrollArea>

  <!-- Selection toolbar — bôi đen text trong message → Quote / Translate / Copy
       (mirrors the selection-quote + SelectionTranslatePopover surfaces) -->
  <Teleport to="body">
    <template v-if="sel">
      <div class="fixed inset-0 z-[70]" @mousedown="sel = null" />
      <div
        class="fixed z-[71] flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        :style="{ left: sel.x + 'px', top: sel.y + 'px', transform: 'translate(-50%, -100%)' }"
        @mousedown.stop
      >
        <Button
          variant="ghost"
          class="h-auto p-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
          @click="quoteSelection"
        >
          <MessageSquareQuote class="size-3.5" />
          Quote
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
          @click="translateSelection"
        >
          <Languages class="size-3.5" />
          Translate
        </Button>
        <Button
          variant="ghost"
          class="h-auto p-0 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent"
          @click="copySelection"
        >
          <Copy class="size-3.5" />
          Copy
        </Button>
      </div>
    </template>

    <!-- Translate result card — mirrors SelectionTranslatePopover: lang pills,
         source → result, copy. -->
    <template v-if="trans">
      <div class="fixed inset-0 z-[72]" @mousedown="trans = null" />
      <div
        class="fixed z-[73] flex max-h-[44vh] w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
        :style="{ left: trans.x + 'px', top: trans.y + 'px', transform: 'translate(-50%, 8px)' }"
        @mousedown.stop
      >
        <div class="flex items-center gap-2 border-b border-border px-3 py-2">
          <Languages class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium">Translate</span>
          <div class="ml-auto flex gap-1">
            <button
              v-for="l in transLangs"
              :key="l"
              :class="[
                'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase transition-colors',
                transLang === l
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              ]"
              @click="transLang = l"
            >
              {{ l }}
            </button>
          </div>
          <Button
            variant="ghost"
            class="h-auto p-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Close translate"
            @click="trans = null"
          >
            <X class="size-3.5" />
          </Button>
        </div>
        <div class="overflow-y-auto px-3 py-2 text-xs leading-relaxed">
          <p class="mb-2 border-l-2 border-border pl-2 text-muted-foreground">{{ trans.src }}</p>
          <p class="text-foreground">{{ translated }}</p>
        </div>
        <div class="flex justify-end border-t border-border px-2 py-1.5">
          <Button
            variant="outline"
            class="h-auto p-0 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            @click="copyTranslation"
          >
            <component :is="transCopied ? Check : Copy" class="size-3" />
            {{ transCopied ? 'Copied' : 'Copy' }}
          </Button>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
// Transcript: flat mode + bubble mode (Settings → Sessions "assistant bubble"
// equivalent). Action footers mirror SessionMsgActions: assistant gets
// copy · quote · bookmark inline + ⋯ overflow; user gets copy · expand ·
// bookmark + ⋯. Rare/destructive actions never sit unlabelled next to copy.
import { computed, ref, toRef } from 'vue'
import {
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleX,
  Copy,
  Eye,
  File,
  FileText,
  Flag,
  GitBranch,
  GitFork,
  Image as ImageIcon,
  Languages,
  Layers,
  ListTodo,
  Loader2,
  Maximize2,
  MessageSquareQuote,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  RotateCcw,
  Terminal,
  Trash2,
  User,
  Video,
  Wrench,
  X,
} from 'lucide-vue-next'
import { useProtoSession, type ProtoMessage } from '~/composables/useProtoSession'
import { useProtoPreview } from '~/composables/useProtoPreview'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{ messages: ProtoMessage[]; bubble?: boolean }>()
const bubble = toRef(props, 'bubble')
const preview = useProtoPreview()
const { quoteDraft } = useProtoSession()

const attIcon = (kind: string) =>
  (
    ({ image: ImageIcon, video: Video, markdown: Eye, text: FileText }) as Record<
      string,
      typeof File
    >
  )[kind] ?? File

const toolIcon = { ok: CircleCheck, running: Loader2, fail: CircleX }
const toolCls = {
  ok: 'text-success',
  running: 'text-primary animate-spin',
  fail: 'text-destructive',
}

const copiedId = ref<string | null>(null)
const bookmarked = ref<Set<string>>(new Set())

// Same rough estimate as SessionMessageItem.tokLabel — chars/3, "k" past 999.
function tokLabel(m: ProtoMessage): string {
  const chars =
    (m.text?.length ?? 0) +
    (m.md?.length ?? 0) +
    (m.activities?.reduce(
      (n, a) =>
        n +
        (a.kind === 'step'
          ? (a.step.target?.length ?? 0) + (a.step.output?.length ?? 0)
          : a.text.length),
      0,
    ) ?? 0) +
    (m.code?.body.length ?? 0) +
    (m.tool?.output?.length ?? 0) +
    (m.mermaid?.length ?? 0) +
    (m.todo?.reduce((n, t) => n + t.text.length, 0) ?? 0)
  const n = Math.round((chars || 1) / 3)
  return n > 999 ? (n / 1000).toFixed(1) + 'k' : String(n)
}

// Same shape as formatElapsed(startedAt → completedAt): "42s" / "1m 16s".
function elapsedLabel(sec: number): string {
  const s = Math.floor(sec)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

async function copy(text: string | undefined, id: string) {
  if (!text) return
  await navigator.clipboard.writeText(text).catch(() => {})
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1200)
}

function toggleBookmark(m: ProtoMessage) {
  const s = new Set(bookmarked.value)
  if (s.has(m.id)) s.delete(m.id)
  else s.add(m.id)
  bookmarked.value = s
}

type Primary = { icon: typeof Copy; title: string; run: (m: ProtoMessage) => void }
type Overflow = {
  sep?: boolean
  icon?: typeof Copy
  label?: string
  danger?: boolean
  run?: (m: ProtoMessage) => void
}

function primaryFor(m: ProtoMessage): Primary[] {
  const base: Primary[] = [
    { icon: Copy, title: 'Copy', run: (mm) => copy(mm.md ?? mm.text, mm.id) },
  ]
  if (m.role === 'agent') {
    base.push(
      {
        icon: MessageSquareQuote,
        title: 'Quote reply',
        run: (mm) => quoteDraft.value.push(mm.md ?? mm.text ?? ''),
      },
      {
        icon: Bookmark,
        title: bookmarked.value.has(m.id) ? 'Remove bookmark' : 'Bookmark',
        run: toggleBookmark,
      },
    )
  } else if (m.role === 'user') {
    base.push(
      { icon: Maximize2, title: 'Fullscreen', run: openPreviewMd },
      { icon: Bookmark, title: 'Bookmark', run: toggleBookmark },
    )
  }
  return base
}

// Full turn as markdown inside the shared PreviewModal — proto stand-in for
// SessionTurnFullscreen / the message Fullscreen action.
function openPreviewMd(m: ProtoMessage) {
  preview.open({
    name: `${m.author} · ${m.time}`,
    kind: 'markdown',
    text: m.md ?? m.text ?? '',
    size: `${tokLabel(m)} tok`,
  })
}

function overflowFor(m: ProtoMessage): Overflow[] {
  if (m.role === 'agent') {
    // Mirrors SessionMsgActions: rare/destructive actions live in the ⋯ menu.
    return [
      { icon: Maximize2, label: 'Fullscreen', run: openPreviewMd },
      {
        icon: FileText,
        label: 'Copy markdown',
        run: (mm) => copy(mm.md ?? mm.text, `${mm.id}-md`),
      },
      { icon: Layers, label: 'Fullscreen turn', run: openPreviewMd },
      { sep: true },
      { icon: Flag, label: 'Report' },
      { icon: GitBranch, label: 'Branch from here' },
      { icon: GitFork, label: 'Fork session' },
      { sep: true },
      { icon: RefreshCw, label: 'Regenerate' },
      { icon: RotateCcw, label: 'Retry model' },
      { icon: Trash2, label: 'Delete turn', danger: true },
    ]
  }
  return [
    { icon: PenLine, label: 'Edit & resend' },
    { icon: RefreshCw, label: 'Resend' },
    { icon: GitFork, label: 'Fork from here' },
    { sep: true },
    { icon: Trash2, label: 'Delete message', danger: true },
  ]
}

// ── Text selection → floating toolbar (Quote / Translate / Copy) ─────────────
// Same UX as the production selection hook: mouseup over a message body reads
// window.getSelection and anchors a popover at the range rect.
const sel = ref<{ x: number; y: number; text: string } | null>(null)

function onSelectInMsg() {
  const s = window.getSelection()
  if (!s || s.isCollapsed) {
    sel.value = null
    return
  }
  const text = s.toString().trim()
  if (!text) {
    sel.value = null
    return
  }
  const r = s.getRangeAt(0).getBoundingClientRect()
  sel.value = { x: r.left + r.width / 2, y: r.top - 8, text }
}

function quoteSelection() {
  if (!sel.value) return
  quoteDraft.value.push(sel.value.text)
  window.getSelection()?.removeAllRanges()
  sel.value = null
}

async function copySelection() {
  if (!sel.value) return
  await navigator.clipboard.writeText(sel.value.text).catch(() => {})
  sel.value = null
}

// ── Translate popover (mock engine — real one streams through the session
// runtime; SelectionTranslatePopover.vue is the production reference) ───────
const trans = ref<{ x: number; y: number; src: string } | null>(null)
const transLang = ref<'en' | 'vi' | 'ja'>('vi')
const transLangs = ['en', 'vi', 'ja'] as const
const transCopied = ref(false)

function translateSelection() {
  if (!sel.value) return
  trans.value = { x: sel.value.x, y: sel.value.y, src: sel.value.text }
  transCopied.value = false
  window.getSelection()?.removeAllRanges()
  sel.value = null
}

const translated = computed(() => {
  if (!trans.value) return ''
  const src = trans.value.src
  const short = src.length > 90 ? src.slice(0, 90) + '…' : src
  return {
    en: `EN demo translation — "${short}". The real popover streams this from the session runtime.`,
    vi: `Bản dịch demo — "${short}". Bản thật stream kết quả qua SelectionTranslatePopover.`,
    ja: `JA デモ翻訳 —「${short}」。本実装ではランタイム経由でストリームします。`,
  }[transLang.value]
})

async function copyTranslation() {
  await navigator.clipboard.writeText(translated.value).catch(() => {})
  transCopied.value = true
  setTimeout(() => (transCopied.value = false), 1200)
}
</script>
