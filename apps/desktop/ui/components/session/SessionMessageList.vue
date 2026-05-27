<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
    <div v-for="msg in messages" :key="msg.id">
      <div
        v-if="msg.role === 'system'"
        class="text-center text-[10px] uppercase tracking-wider"
        :style="{ color: t.textDim }"
      >
        ── {{ msg.text }} · {{ fmt(msg.at) }} ──
      </div>

      <div v-else>
        <div v-if="msg.role === 'user'" class="flex flex-col items-end gap-1.5">
          <div
            v-if="msg.text"
            class="rounded-2xl px-4 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
            :style="{
              background: t.bgElevated,
              color: t.text,
              border: `1px solid ${t.border}`,
              maxWidth: '78%',
            }"
          >
            <template v-for="(seg, i) in tokenizeMessage(msg.text)" :key="i">
              <span
                v-if="seg.kind === 'token'"
                :style="{ color: tokenColor(seg.tokenKind!), fontWeight: 500 }"
              >
                {{ seg.text }}
              </span>
              <template v-else>{{ seg.text }}</template>
            </template>
          </div>
          <div
            v-if="msg.attachments?.length"
            class="flex flex-wrap gap-1.5 justify-end"
            :style="{ maxWidth: '78%' }"
          >
            <template v-for="att in msg.attachments" :key="att.id">
              <button
                v-if="att.type === 'image' && att.url"
                type="button"
                class="rounded-md overflow-hidden relative group transition"
                :style="{
                  width: '160px',
                  height: '100px',
                  border: `1px solid ${t.border}`,
                  background: t.bgSubtle,
                }"
                :title="`View ${att.name}${att.size ? ` · ${att.size}` : ''}`"
                @click="emit('openAttachment', att)"
              >
                <img
                  :src="att.url"
                  :alt="att.name"
                  class="w-full h-full object-cover"
                  draggable="false"
                />
                <div
                  class="absolute inset-x-0 bottom-0 px-2 py-1 flex items-center gap-1"
                  :style="{
                    background: t.overlay,
                    backdropFilter: 'blur(4px)',
                  }"
                >
                  <span
                    class="text-[10px] font-mono truncate flex-1 text-left"
                    :style="{ color: t.onAccent }"
                  >
                    {{ att.name }}
                  </span>
                  <Maximize2 :size="10" :style="{ color: t.onAccent, flexShrink: 0 }" />
                </div>
              </button>
              <button
                v-else
                type="button"
                class="rounded-md flex items-center gap-2.5 px-3 text-left transition"
                :style="{
                  height: '44px',
                  minWidth: '180px',
                  maxWidth: '260px',
                  background: t.bgSubtle,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  cursor: att.preview ? 'pointer' : 'default',
                  opacity: att.preview ? 1 : 0.85,
                }"
                :disabled="!att.preview"
                :title="
                  att.preview
                    ? `View ${att.name}${att.size ? ` · ${att.size}` : ''}`
                    : `${att.name}${att.size ? ` · ${att.size}` : ''}`
                "
                @click="emit('openAttachment', att)"
              >
                <component
                  :is="fileIconFor(att.name).icon"
                  :size="18"
                  class="flex-shrink-0"
                  :style="{ color: fileIconFor(att.name).color }"
                />
                <div class="flex-1 min-w-0">
                  <div class="font-mono text-[12px] truncate" :style="{ color: t.text }">
                    {{ att.name }}
                  </div>
                  <div
                    class="text-[10px] truncate flex items-center gap-1.5"
                    :style="{ color: t.textFaint }"
                  >
                    <span :style="{ color: fileIconFor(att.name).color, fontWeight: 500 }">
                      {{ fileIconFor(att.name).label }}
                    </span>
                    <span v-if="att.size">· {{ att.size }}</span>
                  </div>
                </div>
              </button>
            </template>
          </div>
          <div class="text-[9px] flex items-center gap-1.5" :style="{ color: t.textFaint }">
            <span>{{ fmt(msg.at) }}</span>
            <span v-if="msg.modeAtSend">· sent in {{ msg.modeAtSend }} mode</span>
          </div>
        </div>

        <div
          v-if="msg.role === 'agent'"
          class="rounded-2xl px-4 py-3 text-[13px] leading-relaxed"
          :style="{
            background: t.bgElevated,
            border: `1px solid ${t.border}`,
            maxWidth: '92%',
          }"
        >
          <div
            class="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider"
            :style="{ color: t.textFaint }"
          >
            <Sparkles :size="10" :style="{ color: t.accent }" />
            <span :style="{ color: t.textDim }">Assistant</span>
            <template v-if="msg.modelUsed">
              <span>·</span>
              <span class="font-mono normal-case tracking-normal">{{ msg.modelUsed }}</span>
            </template>
            <template v-if="msg.at">
              <span>·</span>
              <span class="normal-case tracking-normal">{{ fmt(msg.at) }}</span>
            </template>
            <span class="flex-1" />
            <button
              v-if="msg.text"
              type="button"
              class="awog-copy-btn"
              :style="{ color: copiedId === msg.id ? t.success : t.textDim }"
              :title="copiedId === msg.id ? 'Copied' : 'Copy message'"
              @click="copyMessage(msg)"
            >
              <Check v-if="copiedId === msg.id" :size="12" />
              <Copy v-else :size="12" />
            </button>
          </div>

          <div
            v-if="msg.text"
            class="awog-md text-[13px]"
            :style="{ color: t.text }"
            v-html="isStreaming(msg) ? escapeText(msg.text) : renderMarkdown(msg.text)"
          />

          <div v-if="msg.steps?.length" :class="msg.text ? 'mt-2 space-y-1' : 'space-y-1'">
            <StepItem v-for="step in msg.steps" :key="step.id" :step="step" />
          </div>

          <div
            v-if="msg.startedAt"
            class="mt-2 pt-2 text-[10px] flex items-center gap-2"
            :style="{ color: t.textFaint, borderTop: `1px dashed ${t.border}` }"
          >
            <template v-if="msg.completedAt">
              <span>{{ formatElapsed(msg.completedAt - msg.startedAt) }}</span>
              <span v-if="msg.usage">· {{ msg.usage.outputTokens }} tok</span>
            </template>
            <template v-else>
              <Activity :size="10" class="animate-pulse" />
              <span>Streaming… {{ formatElapsed(now - msg.startedAt) }}</span>
            </template>
          </div>

          <div v-if="msg.artifacts?.length" class="mt-2 space-y-1.5">
            <div
              v-for="art in msg.artifacts"
              :key="art.name"
              class="rounded"
              :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
            >
              <div
                class="px-2.5 py-1.5 flex items-center gap-1.5 text-[11px]"
                :style="{ borderBottom: art.preview ? `1px solid ${t.border}` : 'none' }"
              >
                <FileText :size="11" :style="{ color: t.textDim }" />
                <span class="font-mono" :style="{ color: t.text }">{{ art.name }}</span>
              </div>
              <pre
                v-if="art.preview"
                class="text-[11px] px-2.5 py-2 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap"
                :style="{ color: t.textMuted, maxHeight: '160px' }"
                >{{ art.preview }}</pre
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-for="agentId in pendingAgentIds"
      :key="`pending-${agentId}`"
      class="flex gap-1.5 items-center"
    >
      <Activity :size="11" class="animate-pulse" :style="{ color: t.textDim }" />
      <span class="text-[11px]" :style="{ color: t.textDim }">
        {{ agentName(agentId) }} đang phản hồi...
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Activity, Check, Copy, FileText, Maximize2, Sparkles } from 'lucide-vue-next'
import { computed, onUnmounted, ref, watch, nextTick } from 'vue'
import type { SessionAttachment, SessionMessage, SessionTokenKind } from '~/types'
import { fileIconFor } from '~/utils/file-icon'
import { tokenizeMessage } from '~/utils/tokenize'
import { renderMarkdown } from '~/utils/markdown'
import { formatTime } from '~/utils/time'

const settingsStore = useSettingsStore()
const fmt = (at: string | undefined) => formatTime(at, settingsStore.defaults?.timezone)

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeText = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c)

// A message is "streaming" iff we tagged it with startedAt before sending and
// the placeholder has not yet been reconciled (no completedAt). Anything else —
// historical messages from JSONL, finalized turns, mock data — should render
// as markdown.
const isStreaming = (msg: SessionMessage): boolean =>
  msg.startedAt !== undefined && msg.completedAt === undefined

const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
const copyMessage = async (msg: SessionMessage) => {
  try {
    await navigator.clipboard.writeText(msg.text ?? '')
    copiedId.value = msg.id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedId.value = null
    }, 1500)
  } catch {
    // ignore — clipboard may be denied in restricted contexts
  }
}

const props = defineProps<{
  messages: SessionMessage[]
  pendingAgentIds: string[]
}>()

const emit = defineEmits<{
  openAttachment: [attachment: SessionAttachment]
}>()

const { t } = useTheme()
const workspace = useWorkspaceStore()

const scrollRef = ref<HTMLElement | null>(null)

const tokenColor = (kind: SessionTokenKind) => {
  if (kind === 'agent') return t.value.warning
  if (kind === 'skill') return t.value.accent
  if (kind === 'file') return t.value.info
  return t.value.success
}

const agentName = (id: string) => workspace.agentById(id)?.name ?? 'Agent'

const now = ref(Date.now())
const hasStreaming = computed(() => props.messages.some((m) => m.startedAt && !m.completedAt))
let nowTimer: ReturnType<typeof setInterval> | null = null

watch(
  hasStreaming,
  (active) => {
    if (active && !nowTimer) {
      nowTimer = setInterval(() => {
        now.value = Date.now()
      }, 100)
    } else if (!active && nowTimer) {
      clearInterval(nowTimer)
      nowTimer = null
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (nowTimer) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  },
)
</script>

<style>
.awog-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 4px;
  border-radius: 4px;
  transition:
    background 120ms ease,
    color 120ms ease;
}
.awog-copy-btn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.awog-md {
  line-height: 1.6;
}
.awog-md p {
  margin: 0 0 0.6em;
}
.awog-md p:last-child {
  margin-bottom: 0;
}
.awog-md h1,
.awog-md h2,
.awog-md h3,
.awog-md h4 {
  font-weight: 600;
  margin: 0.9em 0 0.4em;
  line-height: 1.3;
}
.awog-md h1 {
  font-size: 1.25em;
}
.awog-md h2 {
  font-size: 1.12em;
}
.awog-md h3 {
  font-size: 1.04em;
}
.awog-md h4 {
  font-size: 1em;
}
.awog-md h1:first-child,
.awog-md h2:first-child,
.awog-md h3:first-child {
  margin-top: 0;
}
.awog-md ul,
.awog-md ol {
  margin: 0.4em 0 0.6em 1.2em;
  padding: 0;
}
.awog-md li {
  margin: 0.15em 0;
}
.awog-md ul {
  list-style: disc;
}
.awog-md ol {
  list-style: decimal;
}
.awog-md code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.07);
}
.awog-md pre {
  margin: 0.6em 0;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.awog-md pre code {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}
.awog-md blockquote {
  margin: 0.6em 0;
  padding: 0.2em 0.8em;
  border-left: 3px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
}
.awog-md hr {
  margin: 0.8em 0;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.awog-md a {
  color: #60a5fa;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.awog-md table {
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 0.95em;
}
.awog-md th,
.awog-md td {
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 4px 8px;
}
.awog-md th {
  background: rgba(255, 255, 255, 0.04);
  font-weight: 600;
}
.awog-md strong {
  font-weight: 600;
}
</style>
