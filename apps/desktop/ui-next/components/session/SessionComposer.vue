<template>
  <div class="composer">
    <div
      class="cresize"
      :class="{ drag: resizing }"
      :title="t('sessions.composer.resize')"
      @pointerdown="onResize"
    />
    <div class="cbox">
      <!-- follow-up quote cards (carried into the next turn) -->
      <div v-if="followups.length" class="sfollow">
        <div v-for="(q, i) in followups" :key="i" class="fwcard">
          <div class="fwh">
            <span class="fwn">{{ CIRCLED[i] }}</span>
            <span
              class="fwq fwlink"
              :title="t('sessions.message.quote')"
              @click="scrollToMessage(q.src)"
            >
              {{ q.excerpt }}
            </span>
            <span class="fwx" :title="t('sessions.quote.remove')" @click="removeQuote(i)">×</span>
          </div>
          <input
            class="fwnote"
            :value="q.note"
            :placeholder="t('sessions.quote.notePlaceholder')"
            @input="onNote(i, $event)"
          />
        </div>
      </div>

      <!-- queued messages (gửi sau) — shown while the active turn is busy -->
      <div v-if="queued.length" class="attc qattc">
        <span
          v-for="(q, i) in queued"
          :key="i"
          class="att qatt"
          :title="t('sessions.composer.queued')"
        >
          <Icon name="clock" style="width: 11px; height: 11px" />
          <span class="attn">
            {{ q.text || t('sessions.attachment.allTitle', { n: q.att?.length ?? 0 }) }}
          </span>
          <span class="x" :title="t('sessions.composer.queuedRemove')" @click.stop="dequeue(i)">
            ×
          </span>
        </span>
      </div>

      <!-- slash `/` + `@`-mention autocomplete (mock-sourced) -->
      <SessionSlashMenu
        v-if="autocomplete === 'slash'"
        :items="slashMatches"
        :active="acIndex"
        @select="applySlash"
        @hover="(i) => (acIndex = i)"
      />
      <SessionMentionMenu
        v-else-if="autocomplete === 'mention'"
        :items="mentionMatches"
        :active="acIndex"
        @select="applyMention"
        @hover="(i) => (acIndex = i)"
      />

      <!-- textarea is single-purpose composer input → resize handled by .cresize handle -->
      <textarea
        ref="ta"
        v-model="draft"
        class="ci"
        rows="1"
        :placeholder="t('sessions.composer.placeholder')"
        @input="onInput"
        @keydown.down="onAcArrow($event, 1)"
        @keydown.up="onAcArrow($event, -1)"
        @keydown.esc="closeAutocomplete"
        @keydown.enter="onEnter"
        @paste="onPaste"
      />
      <div class="attc">
        <span
          v-for="(a, i) in visibleAtt"
          :key="i"
          class="att"
          :title="t('sessions.attachment.preview')"
          :style="{ cursor: 'pointer', paddingLeft: a.img ? '5px' : undefined }"
          @click="emit('preview', i)"
        >
          <img v-if="a.img && a.src" :src="a.src" class="attthumb" :alt="a.name" />
          <span v-else-if="a.img" class="thumb" />
          <Icon v-else name="rules" style="width: 11px; height: 11px" />
          <span class="attn">{{ a.name }}</span>
          <span
            class="x"
            :title="t('sessions.attachment.remove')"
            @click.stop="emit('remove-att', i)"
          >
            ×
          </span>
        </span>
        <span
          v-if="overflowCount"
          class="att attmore"
          :title="t('sessions.attachment.allTitle', { n: attachments.length })"
          @click="emit('open-more')"
        >
          {{ t('sessions.attachment.more', { n: overflowCount }) }}
        </span>
      </div>
      <div class="cbar">
        <span
          class="chip sm chipbtn"
          :class="`mode-${selectedMode}`"
          :title="t('sessions.composer.modeTooltip')"
          style="position: relative"
          @click.stop="toggle('mode')"
        >
          <Icon :name="modeIcon" style="width: 12px; height: 12px" />
          {{ t(`sessions.mode.${selectedMode}`) }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="open === 'mode'"
            class="smenu"
            style="position: absolute; bottom: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <div v-for="m in MODES_UI" :key="m.id" class="mi" @click="selectMode(m.id)">
              <Icon :name="m.icon" style="width: 13px; height: 13px" />
              {{ t(`sessions.mode.${m.id}`) }}
              <Icon
                v-if="m.id === selectedMode"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </span>
        <span
          class="chip sm chipbtn"
          :title="t('sessions.composer.modelTooltip')"
          style="position: relative"
          @click.stop="toggle('model')"
        >
          <Icon name="settings" style="width: 12px; height: 12px" />
          {{ selectedModel }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="open === 'model'"
            class="smenu"
            style="
              position: absolute;
              bottom: 130%;
              left: 0;
              z-index: 50;
              max-height: 320px;
              overflow-y: auto;
            "
            @click.stop
          >
            <div v-for="m in availableModels" :key="m" class="mi" @click="selectModel(m)">
              {{ m }}
              <Icon
                v-if="m === selectedModel"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
            <!-- Thinking selector folded under the model list -->
            <div class="palg">
              {{ t('sessions.config.thinking') }}
              <span v-if="!thinkSupported">{{ t('sessions.config.thinkingUnsupported') }}</span>
            </div>
            <div
              v-for="[v, l] in THINK"
              :key="v"
              class="mi"
              :class="{ mdisabled: !thinkSupported }"
              @click="selectThink(v)"
            >
              {{ l }}
              <Icon
                v-if="thinking === v"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </span>
        <span
          class="chip sm chipbtn"
          :title="t('sessions.composer.accountTooltip')"
          style="position: relative"
          @click.stop="toggle('account')"
        >
          <Icon name="agents" style="width: 12px; height: 12px" />
          {{ accountShort }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="open === 'account'"
            class="smenu"
            style="position: absolute; bottom: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <div v-for="a in accounts" :key="a.id" class="mi" @click="selectAccount(a)">
              {{ a.display }}
              <Icon
                v-if="a.id === selectedAccountId"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
          </div>
        </span>
        <span
          class="chip sm chipbtn"
          :title="t('sessions.composer.styleTooltip')"
          style="position: relative"
          @click.stop="toggle('style')"
        >
          <Icon name="skills" style="width: 12px; height: 12px" />
          {{ styleName }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="open === 'style'"
            class="smenu stylemenu"
            style="position: absolute; bottom: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <template v-for="[group, arr] in RESPONSE_STYLES" :key="group">
              <div class="palg">{{ group }}</div>
              <div
                v-for="[sid, name, hint] in arr"
                :key="sid"
                class="mi sty"
                @click="selectStyle(sid)"
              >
                <div class="nm2">{{ name }}</div>
                <div class="sd2">{{ hint }}</div>
              </div>
            </template>
            <label class="nmk" style="padding: 0 11px 9px" @click.stop="toggleNoMd">
              <span class="tog2 sm" :class="{ off: !noMd }" />
              {{ t('sessions.config.noMarkdown') }}
            </label>
          </div>
        </span>
        <span class="grow1" />
        <button
          class="iconbtn"
          :title="enhancing ? t('sessions.composer.enhancing') : t('sessions.composer.enhance')"
          :disabled="enhancing"
          style="width: 28px; height: 28px"
          @click="onEnhance"
        >
          <Icon
            name="skills"
            class="enhicon"
            :class="{ enhspin: enhancing }"
            style="width: 14px; height: 14px"
          />
        </button>
        <button
          class="iconbtn"
          :title="t('sessions.composer.attach')"
          style="width: 28px; height: 28px"
          @click="emit('pick')"
        >
          <Icon name="clip" style="width: 14px; height: 14px" />
        </button>
        <span>
          <button
            class="btn pri sm"
            :class="{ stop: primaryAction === 'stop' }"
            :title="primaryTitle"
            @click="onPrimary"
          >
            <Icon :name="primaryIcon" />
            {{ primaryLabel }}
          </button>
        </span>
      </div>
    </div>
    <div v-if="open" style="position: fixed; inset: 0; z-index: 40" @click="open = null" />
  </div>
</template>

<script setup lang="ts">
// Composer (renderDetail composer block ~1358 + renderSendArea ~1659). Four chips
// (mode → model → account → style) each open a `.smenu` popover (upward), textarea
// with Enter-to-send / Shift+Enter newline, enhance (one-shot rewrite via the store)
// and slash `/` + `@`-mention autocomplete (mock sources). When the active session
// is busy the Send action queues (gửi sau) instead of sending. Chip selections drive
// the STORE (read `store.active`, write via store actions) so they persist + take
// effect on the next turn. The model chip popover also folds the Thinking selector;
// the style chip carries the response-style catalog + the no-markdown toggle.
import type { AccountOption } from '~/composables/useAccounts'
import type { SessionAttachment, ThinkingLevel } from '~/composables/useSessionsMock'
import { SLASH_COMMANDS, MENTION_SOURCE } from './session-composer-mocks'

const props = withDefaults(
  defineProps<{
    attachments?: SessionAttachment[]
  }>(),
  { attachments: () => [] },
)
const emit = defineEmits<{
  send: [text: string]
  pick: []
  'remove-att': [i: number]
  // A pasted clipboard image → a pending attachment for the parent to track
  // (mirrors the drag-drop / file-picker path). The parent owns `pendingAtt`.
  'add-att': [att: SessionAttachment]
  preview: [i: number]
  'open-more': []
}>()
const { t } = useI18n()
const { providerOf, CIRCLED } = useSessionsMock()
const { accounts, accountById, modelsForAccount } = useAccounts()
const { scrollToMessage } = useSessionScroll()

// Cap inline chips; the rest collapse into a "+N more" chip that opens the list modal.
const MAX_INLINE = 6
const visibleAtt = computed(() => props.attachments.slice(0, MAX_INLINE))
const overflowCount = computed(() => Math.max(0, props.attachments.length - MAX_INLINE))

// Composer modes + their icon (adds "Accept Edits" beyond the mock's three).
const MODES_UI = [
  { id: 'Ask', icon: 'sessions' },
  { id: 'Plan', icon: 'rules' },
  { id: 'AcceptEdits', icon: 'edit' },
  { id: 'Execute', icon: 'play' },
] as const

// Thinking levels + the models that don't support reasoning effort (mirrors the
// config popover). The model chip popover folds this selector.
const THINK: [ThinkingLevel, string][] = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['extra-high', 'Extra high'],
  ['max', 'Max'],
]
const NO_THINK = new Set(['Haiku 4.5', 'GPT-4.1'])

// Response-style catalog (VN labels, ported from SessionConfigPopover). Each row is
// [id, display name, hint]; the style chip popover renders these grouped.
const RESPONSE_STYLES: [string, [string, string, string][]][] = [
  ['Mặc định', [['Normal', 'Normal', 'Có markdown, mặc định']]],
  [
    '⚡ Nhanh & gọn',
    [
      ['Military', '🪖 Military', 'Fix ngay, không giải thích'],
      ['Caveman', '🪨 Caveman', 'Code nhanh, trao đổi liên tục'],
      ['Reality Check', '🔍 Reality Check', 'Ý tưởng có đáng làm?'],
      ['git log', '📋 git log', 'Từng bước paste vào ticket'],
      ['Socratic', '❓ Socratic', 'Hiểu sâu, không chỉ copy'],
      ['BLUF', '📌 BLUF', 'So sánh — kết luận trước'],
    ],
  ],
  [
    '😄 Cho vui',
    [
      ['Yoda', '🧙 Yoda', 'Thêm năng lượng khi debug'],
      ['Pirate', '🏴‍☠️ Pirate', 'Demo cho team, cần meme'],
      ['80s Hacker', '💾 80s Hacker', 'Screencast, kịch tính'],
      ['Dad Joke', '👨 Dad Joke', 'Dạy junior cho nhớ'],
    ],
  ],
  [
    '🧠 Hiểu sâu',
    [
      ['Rubber Duck', '🦆 Rubber Duck', 'Khái niệm mới, từ số 0'],
      ['Feynman', '🔬 Feynman', 'Onboard junior / tự học'],
      ['First Principles', '🧱 First Principles', 'Chọn stack / kiến trúc'],
    ],
  ],
]

const draft = ref('')
const store = useSessionsStore()
const ta = useTemplateRef<HTMLTextAreaElement>('ta')

// Composer height: `composerH` is the floor the user drags to; `grow` auto-sizes the
// textarea to its content between that floor and a max (mirrors the prototype handle).
const composerH = ref(40)
const resizing = ref(false)
function grow() {
  const el = ta.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(composerH.value, Math.min(el.scrollHeight, 640))}px`
}
function onResize(e: PointerEvent) {
  e.preventDefault()
  resizing.value = true
  const startY = e.clientY
  const startH = composerH.value
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const move = (ev: PointerEvent) => {
    // Drag up → taller.
    composerH.value = Math.max(40, Math.min(560, startH - (ev.clientY - startY)))
    grow()
  }
  const up = () => {
    resizing.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
onMounted(grow)

// Quote / edit on a message seeds the composer draft (store.seedComposer reassigns a
// new object so this fires every time, even for identical text).
watch(
  () => store.draftSeed,
  (seed) => {
    draft.value = seed.text
    // Grow + focus so a seeded draft (welcome starter / quote / edit) lands ready
    // to type/send, cursor at the end.
    nextTick(() => {
      grow()
      const el = ta.value
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  },
)

// Follow-up quote cards for the active session (rendered above the input).
const followups = computed(() => store.active?.followups ?? [])
function removeQuote(i: number) {
  if (store.activeId != null) store.removeQuote(store.activeId, i)
}
function onNote(i: number, e: Event) {
  if (store.activeId != null)
    store.setQuoteNote(store.activeId, i, (e.target as HTMLInputElement).value)
}

// Chip state reads straight off the active session (store-driven). Selections call
// store actions so they persist + drive engineSettings on the next turn.
const selectedMode = computed(() => store.active?.mode || 'Ask')
const selectedModel = computed(() => store.active?.model || 'Opus 4.8')
const selectedAccountDisplay = computed(() => store.active?.account || '')
const selectedAccountId = computed(() => store.active?.accountId ?? '')

type MenuKind = 'mode' | 'model' | 'account' | 'style'
const open = ref<MenuKind | null>(null)
function toggle(kind: MenuKind) {
  open.value = open.value === kind ? null : kind
}

// Models for the currently-selected account (prefer its engine modelIds), with a
// fallback to the display-string provider catalog (mock / unresolved account).
const availableModels = computed(() => {
  const opt = selectedAccountId.value ? accountById(selectedAccountId.value) : undefined
  if (opt) return modelsForAccount(opt)
  return modelsForAccount({
    id: '',
    label: '',
    provider: providerOf(selectedAccountDisplay.value),
    providerDisplay: providerOf(selectedAccountDisplay.value),
    display: selectedAccountDisplay.value,
  })
})

function selectMode(m: string) {
  if (store.activeId != null) store.setMode(store.activeId, m)
  open.value = null
}
function selectModel(m: string) {
  if (store.activeId != null) store.setModel(store.activeId, m)
  open.value = null
}
function selectAccount(a: AccountOption) {
  if (store.activeId != null) store.selectAccount(store.activeId, { id: a.id, display: a.display })
  open.value = null
}

const modeIcon = computed(
  () => MODES_UI.find((m) => m.id === selectedMode.value)?.icon ?? 'sessions',
)
const accountShort = computed(() => providerOf(selectedAccountDisplay.value))

// ── Thinking (folded under the model chip) ─────────────────────────────────────
const thinkSupported = computed(() => !NO_THINK.has(selectedModel.value))
const thinking = computed<ThinkingLevel>(() => store.active?.thinkingLevel ?? 'high')
function selectThink(v: ThinkingLevel) {
  if (!thinkSupported.value || store.activeId == null) return
  store.setThinking(store.activeId, v)
  open.value = null
}

// ── Response style (style chip) ────────────────────────────────────────────────
const styleName = computed(() => {
  const st = store.active?.style
  return st && st !== 'Default' ? st : 'Normal'
})
const noMd = computed(() => store.active?.noMarkdown ?? false)
function selectStyle(id: string) {
  if (store.activeId != null) store.setStyle(store.activeId, id === 'Normal' ? 'Default' : id)
  open.value = null
}
function toggleNoMd() {
  if (store.activeId != null) store.setNoMarkdown(store.activeId, !noMd.value)
}

// ── Queue (gửi sau) ──────────────────────────────────────────────────────────
// While the active turn is busy, Send enqueues instead of sending; the queued
// messages render as chips above the input (the store auto-drains them FIFO when
// the turn settles — we only enqueue / display / remove).
const busy = computed(
  () => store.active?.status === 'streaming' || store.active?.status === 'awaiting',
)
const queued = computed(() => store.active?.queue ?? [])
function dequeue(i: number) {
  if (store.activeId != null) store.dequeue(store.activeId, i)
}

// Primary button state. Idle → Send. While a turn runs (busy): with something
// typed → Queue (gửi sau); with nothing typed → Stop (cancel the running turn).
const hasContent = computed(
  () => !!draft.value.trim() || props.attachments.length > 0 || followups.value.length > 0,
)
const primaryAction = computed<'send' | 'queue' | 'stop'>(() =>
  !busy.value ? 'send' : hasContent.value ? 'queue' : 'stop',
)
const primaryIcon = computed(() =>
  primaryAction.value === 'stop' ? 'stop' : primaryAction.value === 'queue' ? 'clock' : 'send',
)
const primaryLabel = computed(() =>
  primaryAction.value === 'stop'
    ? t('sessions.composer.stop')
    : primaryAction.value === 'queue'
      ? t('sessions.composer.queued')
      : t('sessions.composer.send'),
)
const primaryTitle = computed(() =>
  primaryAction.value === 'stop'
    ? t('sessions.composer.stopTooltip')
    : primaryAction.value === 'queue'
      ? t('sessions.composer.queueSend')
      : t('sessions.composer.send'),
)
function onPrimary() {
  if (primaryAction.value === 'stop') {
    if (store.activeId != null) void store.cancel(store.activeId)
    return
  }
  send()
}

function send() {
  const text = draft.value.trim()
  const hasAtt = props.attachments.length > 0
  const hasQuotes = followups.value.length > 0
  if (!text && !hasAtt && !hasQuotes) return
  closeAutocomplete()
  // Busy → queue (gửi sau) instead of sending. We snapshot the current attachments
  // into the store, then clear the parent's pendingAtt via `remove-att` (descending
  // so indices don't shift). We deliberately do NOT emit `send` here: the parent's
  // onSend always calls store.sendMessage, which has no busy-guard — emitting it
  // would start a second concurrent turn instead of queueing.
  if (busy.value && store.activeId != null) {
    store.enqueue(store.activeId, draft.value, props.attachments)
    for (let i = props.attachments.length - 1; i >= 0; i--) emit('remove-att', i)
    draft.value = ''
    nextTick(grow)
    return
  }
  emit('send', draft.value)
  draft.value = ''
  nextTick(grow)
}
function onEnter(e: KeyboardEvent) {
  if (e.shiftKey) return // Shift+Enter → newline
  // An open autocomplete steals Enter to accept the highlighted item.
  if (autocomplete.value) {
    e.preventDefault()
    acceptActive()
    return
  }
  e.preventDefault()
  send()
}

// ── Enhance ✨ (one-shot rewrite) ──────────────────────────────────────────────
const enhancing = ref(false)
async function onEnhance() {
  const text = draft.value.trim()
  if (!text || enhancing.value) return
  enhancing.value = true
  try {
    const enhanced = await store.enhancePrompt(text)
    if (enhanced) {
      draft.value = enhanced
      nextTick(grow)
    }
  } catch (err) {
    // Leave the draft unchanged on failure (network / model error).
    console.warn('[composer] enhance failed', err)
  } finally {
    enhancing.value = false
  }
}

// ── Autocomplete: slash `/` + `@`-mention (mock-sourced) ───────────────────────
type Autocomplete = 'slash' | 'mention' | null
const autocomplete = ref<Autocomplete>(null)
const acIndex = ref(0)
// The caret-anchored query token (the word the user is typing) for `@`-mentions.
const mentionQuery = ref('')

function caretText(): string {
  const el = ta.value
  const v = draft.value
  if (!el) return v
  const pos = el.selectionStart ?? v.length
  return v.slice(0, pos)
}

const slashMatches = computed(() => {
  if (autocomplete.value !== 'slash') return []
  const q = draft.value.slice(1).toLowerCase().split(/\s/)[0] ?? ''
  return SLASH_COMMANDS.filter((c) => c.name.slice(1).startsWith(q))
})
const mentionMatches = computed(() => {
  if (autocomplete.value !== 'mention') return []
  const q = mentionQuery.value.toLowerCase()
  return MENTION_SOURCE.filter((m) => m.value.toLowerCase().includes(q)).slice(0, 6)
})

function refreshAutocomplete() {
  const v = draft.value
  // Slash: only when the whole draft starts with `/` (a leading command token).
  if (v.startsWith('/')) {
    autocomplete.value = 'slash'
    if (acIndex.value >= slashMatches.value.length) acIndex.value = 0
    if (!slashMatches.value.length) autocomplete.value = null
    return
  }
  // Mention: the caret word starts with `@` (preceded by start-of-line or space).
  const m = /(^|\s)@([\w./-]*)$/.exec(caretText())
  if (m) {
    mentionQuery.value = m[2] ?? ''
    autocomplete.value = 'mention'
    if (acIndex.value >= mentionMatches.value.length) acIndex.value = 0
    if (!mentionMatches.value.length) autocomplete.value = null
    return
  }
  autocomplete.value = null
}
function closeAutocomplete() {
  autocomplete.value = null
  acIndex.value = 0
}

function onInput() {
  grow()
  acIndex.value = 0
  refreshAutocomplete()
}

// Arrow keys cycle the highlighted item while a menu is open (else fall through to
// default textarea caret movement).
function onAcArrow(e: KeyboardEvent, dir: 1 | -1) {
  if (!autocomplete.value) return
  const len =
    autocomplete.value === 'slash' ? slashMatches.value.length : mentionMatches.value.length
  if (!len) return
  e.preventDefault()
  acIndex.value = (acIndex.value + dir + len) % len
}
function acceptActive() {
  if (autocomplete.value === 'slash') {
    const c = slashMatches.value[acIndex.value]
    if (c) applySlash(c.name)
  } else if (autocomplete.value === 'mention') {
    const m = mentionMatches.value[acIndex.value]
    if (m) applyMention(m.value)
  }
}
function applySlash(name: string) {
  // A leading command token replaces the whole draft prefix; keep any trailing args.
  const rest = draft.value.replace(/^\/\S*\s?/, '')
  draft.value = `${name} ${rest}`.trimEnd() + (rest ? '' : ' ')
  closeAutocomplete()
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}
function applyMention(value: string) {
  // Replace the caret's `@query` word with the full `@value` token + a trailing space.
  draft.value = draft.value.replace(/(^|\s)@([\w./-]*)$/, (_m, pre: string) => `${pre}@${value} `)
  closeAutocomplete()
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}

// ── Paste image from clipboard → attachment ───────────────────────────────────
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    e.preventDefault() // keep the data URL out of the textarea text
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) return
      const ext = file.type.split('/')[1] || 'png'
      const att: SessionAttachment = {
        name: file.name || `pasted-${Date.now()}.${ext}`,
        img: true,
        dataUrl,
        src: dataUrl,
        mime: file.type,
        size: file.size,
      }
      emit('add-att', att)
    }
    reader.readAsDataURL(file)
  }
}
</script>

<style scoped>
/* Composer attachment thumbnail (image chips) — matches SessionAttachmentChip's
   inline gradient swatch from the prototype. */
.thumb {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  flex: 0 0 auto;
  background: linear-gradient(135deg, var(--blue), var(--violet));
}
/* Real image thumbnail when a dropped/picked file has an object URL. */
.attthumb {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  object-fit: cover;
  flex: 0 0 auto;
}
/* Bound the filename so one long name can't blow out the chip row. */
.attn {
  max-width: 168px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attmore {
  cursor: pointer;
  font-weight: 600;
  color: var(--accent);
}
/* follow-up quote container (cards use prototype .fwcard/.fwh/.fwn/.fwq/.fwx/.fwnote) */
.sfollow {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 9px;
}
/* Clickable follow-up excerpt → jump to the quoted message (§8). */
.fwlink {
  cursor: pointer;
}
.fwlink:hover {
  color: var(--accent);
  text-decoration: underline;
}
/* Queued (gửi sau) chip row sits above the input; chips reuse .att with an accent
   tint so they read as pending-send rather than attachments. */
.qattc {
  margin-bottom: 9px;
}
.qatt {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
/* Enhance spinner while the one-shot rewrite is in flight (local rotation — the
   prototype `.spin` is a pulsing dot scoped under .steph, not a rotator). */
.enhicon {
  transition: opacity 0.15s ease;
}
.enhicon.enhspin {
  animation: enhspin 0.9s linear infinite;
}
@keyframes enhspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enhicon.enhspin {
    animation: none;
  }
}
.iconbtn:disabled {
  cursor: default;
  opacity: 0.6;
}
/* Stop state: the primary button turns danger-tinted while a turn is running and
   nothing is queued (click cancels the turn). */
.btn.pri.stop {
  background: var(--danger);
}
.btn.pri.stop:hover {
  background: color-mix(in srgb, var(--danger) 88%, black);
}
</style>
