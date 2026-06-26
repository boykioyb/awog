<template>
  <div ref="composerEl" class="composer">
    <div
      class="cresize"
      :class="{ drag: resizing }"
      :title="t('sessions.composer.resize')"
      @pointerdown="onResize"
    />
    <div class="cbox">
      <!-- follow-up quote cards (carried into the next turn) -->
      <div v-if="followups.length" class="sfollow" :class="{ scroll: followups.length > 3 }">
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

      <!-- slash `/` (commands + skills) + `@`-mention (agents + files) autocomplete -->
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

      <!-- transient feedback for a dispatched built-in command (mode / compact) -->
      <div v-if="commandNotice" class="cmdnotice">{{ commandNotice }}</div>

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
        <!-- Wide: inline mode/model/account/style chips. Narrow (compact) → they
             fold into the single "Config" dropdown (below) so the toolbar never
             overflows / truncates a chip label. -->
        <template v-if="!compact">
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
            class="chip sm chipbtn acct"
            :title="selectedAccountDisplay || t('sessions.composer.accountTooltip')"
            style="position: relative"
            @click.stop="toggle('account')"
          >
            <Icon name="agents" style="width: 12px; height: 12px" />
            <span class="chiplbl">{{ accountShort }}</span>
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
              <template v-for="(grp, gi) in RESPONSE_STYLES" :key="grp.key">
                <div class="palg" :class="{ first: gi === 0 }">
                  {{ t(`sessions.style.group.${grp.key}`) }}
                </div>
                <div
                  v-for="row in grp.rows"
                  :key="row.id"
                  class="mi sty"
                  :class="{ cur: row.id === activeStyleId }"
                  @click="selectStyle(row.id)"
                >
                  <Icon :name="row.icon" class="styicon" />
                  <div class="stytext">
                    <div class="nm2">{{ t(`sessions.style.${row.slug}.name`) }}</div>
                    <div class="sd2">{{ t(`sessions.style.${row.slug}.hint`) }}</div>
                  </div>
                  <Icon v-if="row.id === activeStyleId" name="check" class="styck" />
                </div>
              </template>
              <label class="nmk" style="padding: 0 11px 9px" @click.stop="toggleNoMd">
                <span class="tog2 sm" :class="{ off: !noMd }" />
                {{ t('sessions.config.noMarkdown') }}
              </label>
            </div>
          </span>
        </template>
        <!-- Compact: one chip standing in for all four selectors; opens a single
             scrollable dropdown with Mode / Model / Account / Style sections. -->
        <span
          v-else
          class="chip sm chipbtn cfgchip"
          :title="t('sessions.composer.configTooltip')"
          style="position: relative"
          @click.stop="toggle('config')"
        >
          <Icon name="settings" style="width: 12px; height: 12px" />
          {{ t('sessions.composer.config') }}
          <Icon name="chev" style="width: 11px; height: 11px" />
          <div
            v-if="open === 'config'"
            class="smenu stylemenu cfgmenu"
            style="position: absolute; bottom: 130%; left: 0; z-index: 50"
            @click.stop
          >
            <div class="palg first">{{ t('sessions.composer.section.mode') }}</div>
            <div v-for="m in MODES_UI" :key="m.id" class="mi" @click="selectMode(m.id, true)">
              <Icon :name="m.icon" style="width: 13px; height: 13px" />
              {{ t(`sessions.mode.${m.id}`) }}
              <Icon
                v-if="m.id === selectedMode"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>

            <div class="palg">{{ t('sessions.composer.section.model') }}</div>
            <div v-for="m in availableModels" :key="m" class="mi" @click="selectModel(m, true)">
              {{ m }}
              <Icon
                v-if="m === selectedModel"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>
            <div class="palg">
              {{ t('sessions.config.thinking') }}
              <span v-if="!thinkSupported">{{ t('sessions.config.thinkingUnsupported') }}</span>
            </div>
            <div
              v-for="[v, l] in THINK"
              :key="v"
              class="mi"
              :class="{ mdisabled: !thinkSupported }"
              @click="selectThink(v, true)"
            >
              {{ l }}
              <Icon
                v-if="thinking === v"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>

            <div class="palg">{{ t('sessions.composer.section.account') }}</div>
            <div v-for="a in accounts" :key="a.id" class="mi" @click="selectAccount(a, true)">
              {{ a.display }}
              <Icon
                v-if="a.id === selectedAccountId"
                name="check"
                class="ck"
                style="width: 13px; height: 13px"
              />
            </div>

            <div class="palg">{{ t('sessions.composer.section.style') }}</div>
            <div
              v-for="row in allStyles"
              :key="row.id"
              class="mi sty"
              :class="{ cur: row.id === activeStyleId }"
              @click="selectStyle(row.id, true)"
            >
              <Icon :name="row.icon" class="styicon" />
              <div class="stytext">
                <div class="nm2">{{ t(`sessions.style.${row.slug}.name`) }}</div>
                <div class="sd2">{{ t(`sessions.style.${row.slug}.hint`) }}</div>
              </div>
              <Icon v-if="row.id === activeStyleId" name="check" class="styck" />
            </div>
            <label class="nmk" style="padding: 0 11px 9px" @click.stop="toggleNoMd">
              <span class="tog2 sm" :class="{ off: !noMd }" />
              {{ t('sessions.config.noMarkdown') }}
            </label>
          </div>
        </span>
        <span class="grow1" />
        <button
          class="iconbtn"
          :title="t('sessions.composer.runAsTask')"
          style="width: 28px; height: 28px"
          @click="emit('run-as-task')"
        >
          <Icon name="workflows" style="width: 14px; height: 14px" />
        </button>
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
// and slash `/` + `@`-mention autocomplete (real engine sources via useComposerData:
// commands/skills/agents/files). When the active session
// is busy the Send action queues (gửi sau) instead of sending. Chip selections drive
// the STORE (read `store.active`, write via store actions) so they persist + take
// effect on the next turn. The model chip popover also folds the Thinking selector;
// the style chip carries the response-style catalog + the no-markdown toggle.
import type { AccountOption } from '~/composables/useAccounts'
import type { SessionAttachment, ThinkingLevel } from '~/composables/useSessionsMock'
import { useComposerData } from '~/composables/useComposerData'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import {
  BUILTIN_COMMANDS,
  findBuiltin,
  type SlashItem,
  type MentionRow,
} from './session-composer-commands'
import {
  parseSlashInvocation,
  findInvocableCommand,
  expandCommandBody,
} from '~/utils/slash-command'

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
  // Open the New Task modal seeded with this session as the task origin (ADR 0055).
  'run-as-task': []
}>()
const { t } = useI18n()
const settings = useSettingsStore()
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

// Response-style catalog. `id` is the engine contract (sent via store.setStyle —
// never translate it); `slug` derives the i18n name/hint keys; `icon` is a lucide
// sprite glyph (no emoji — AWOG renders icons as SVG). Group titles + names + hints
// resolve through i18n at render (see `styleGroupTitle` / `styleName` / template).
type StyleRow = { id: string; slug: string; icon: string }
type StyleGroup = { key: string; rows: StyleRow[] }
const RESPONSE_STYLES: StyleGroup[] = [
  { key: 'default', rows: [{ id: 'Normal', slug: 'normal', icon: 'text' }] },
  {
    key: 'fast',
    rows: [
      { id: 'Military', slug: 'military', icon: 'shield' },
      { id: 'Caveman', slug: 'caveman', icon: 'zap' },
      { id: 'Reality Check', slug: 'reality-check', icon: 'search' },
      { id: 'git log', slug: 'git-log', icon: 'git' },
      { id: 'Socratic', slug: 'socratic', icon: 'help' },
      { id: 'BLUF', slug: 'bluf', icon: 'pin' },
    ],
  },
  {
    key: 'fun',
    rows: [
      { id: 'Yoda', slug: 'yoda', icon: 'sparkles' },
      { id: 'Pirate', slug: 'pirate', icon: 'flag' },
      { id: '80s Hacker', slug: 'hacker-80s', icon: 'save' },
      { id: 'Dad Joke', slug: 'dad-joke', icon: 'smile' },
    ],
  },
  {
    key: 'deep',
    rows: [
      { id: 'Rubber Duck', slug: 'rubber-duck', icon: 'message' },
      { id: 'Feynman', slug: 'feynman', icon: 'bulb' },
      { id: 'First Principles', slug: 'first-principles', icon: 'layers' },
    ],
  },
]
// id → slug lookup so the chip label can resolve the localized name of the active
// style (store holds the id; 'Default' maps back to the Normal row).
const STYLE_SLUG = new Map(RESPONSE_STYLES.flatMap((g) => g.rows).map((r) => [r.id, r.slug]))

const store = useSessionsStore()
const ta = useTemplateRef<HTMLTextAreaElement>('ta')

// Draft text is held PER SESSION in the store (not a local ref): SessionDetail is
// keyed by session id, so without this a half-typed message would die when the
// user switches sessions. Reads/writes go through the active session's `draft`.
const draft = computed<string>({
  get: () => store.active?.draft ?? '',
  set: (v) => {
    if (store.activeId != null) store.setDraft(store.activeId, v)
  },
})

// Real autocomplete sources — agents/files/user-commands/skills for the active
// session's project (lazy-loaded + cached, see useComposerData). Built-in slash
// commands (mode/compact/style) come from the static BUILTIN_COMMANDS catalog.
const projectIdRef = computed(() => store.active?.project ?? null)
const data = useComposerData(projectIdRef)
const agentHandle = (name: string) => name.toLowerCase().replace(/\s+/g, '-')

// Transient command feedback line (e.g. "/compact running…", "Mode → Plan") shown
// above the textarea — built-in commands are actions with no chat bubble.
const commandNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
function showNotice(msg: string) {
  commandNotice.value = msg
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    commandNotice.value = null
  }, 4000)
}
onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer)
})

// Dispatch a built-in `/command` picked from the menu. Mode flips the session's
// permission mode; compact summarises older turns (real RPC, applies next turn);
// style opens the response-style popover. These are ACTIONS — never sent as text.
function onCommand(builtinId: string) {
  const cmd = findBuiltin(builtinId)
  if (!cmd || store.activeId == null) return
  if (cmd.action.type === 'mode') {
    store.setMode(store.activeId, cmd.action.mode)
    showNotice(t('sessions.command.notice.mode', { mode: t(`sessions.mode.${cmd.action.mode}`) }))
  } else if (cmd.action.type === 'compact') {
    showNotice(t('sessions.command.notice.compacting'))
    void store.compactSession(store.activeId).then((ok) => {
      showNotice(
        ok ? t('sessions.command.notice.compacted') : t('sessions.command.notice.compactFailed'),
      )
    })
  } else if (cmd.action.type === 'style') {
    open.value = 'style'
  }
}

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

// 'config' is the consolidated popover shown when the toolbar is too narrow for the
// four inline chips — it folds mode/model/account/style into one dropdown.
type MenuKind = 'mode' | 'model' | 'account' | 'style' | 'config'
const open = ref<MenuKind | null>(null)
function toggle(kind: MenuKind) {
  open.value = open.value === kind ? null : kind
}

// Below this toolbar width the four selector chips would overflow / truncate, so
// they collapse into a single "Config" dropdown (the consolidated popover). Observed
// on the composer root; flips live as the workspace panel opens/closes.
const COMPACT_W = 560
const composerEl = useTemplateRef<HTMLDivElement>('composerEl')
const compact = ref(false)
let ro: ResizeObserver | null = null
onMounted(() => {
  const el = composerEl.value
  if (!el || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver((entries) => {
    compact.value = (entries[0]?.contentRect.width ?? el.clientWidth) < COMPACT_W
  })
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())
// Flipping layouts removes the inline chips (or the config chip) from the DOM, so
// drop any open menu to avoid a dangling popover + scrim.
watch(compact, () => {
  open.value = null
})

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

// `keepOpen` lets the consolidated config dropdown stay open across several picks
// (mode + model + style in one go); the inline chips call without it → close on pick.
function selectMode(m: string, keepOpen = false) {
  if (store.activeId != null) store.setMode(store.activeId, m)
  if (!keepOpen) open.value = null
}
function selectModel(m: string, keepOpen = false) {
  if (store.activeId != null) store.setModel(store.activeId, m)
  if (!keepOpen) open.value = null
}
function selectAccount(a: AccountOption, keepOpen = false) {
  if (store.activeId != null) store.selectAccount(store.activeId, { id: a.id, display: a.display })
  if (!keepOpen) open.value = null
}

const modeIcon = computed(
  () => MODES_UI.find((m) => m.id === selectedMode.value)?.icon ?? 'sessions',
)
// Account chip shows the concise account LABEL (e.g. "Malme Co (tran.quang_hoa)")
// rather than the provider — with several accounts on the same provider, the
// provider name alone can't tell you which one is active. Prefer the resolved
// account's label; fall back to the part of the display string before " · Provider".
const accountShort = computed(() => {
  const opt = selectedAccountId.value ? accountById(selectedAccountId.value) : undefined
  if (opt?.label) return opt.label
  const disp = selectedAccountDisplay.value
  const idx = disp.lastIndexOf(' · ')
  return (idx > 0 ? disp.slice(0, idx) : disp) || providerOf(disp)
})

// ── Thinking (folded under the model chip) ─────────────────────────────────────
const thinkSupported = computed(() => !NO_THINK.has(selectedModel.value))
const thinking = computed<ThinkingLevel>(() => store.active?.thinkingLevel ?? 'high')
function selectThink(v: ThinkingLevel, keepOpen = false) {
  if (!thinkSupported.value || store.activeId == null) return
  store.setThinking(store.activeId, v)
  if (!keepOpen) open.value = null
}

// ── Response style (style chip) ────────────────────────────────────────────────
const styleName = computed(() => {
  const st = store.active?.style
  const slug = st && st !== 'Default' ? (STYLE_SLUG.get(st) ?? null) : 'normal'
  // Unknown/legacy id → show it raw rather than a missing-key string.
  return slug ? t(`sessions.style.${slug}.name`) : (st ?? t('sessions.style.normal.name'))
})
// The currently-selected style id ('Default' in the store ↔ 'Normal' row).
const activeStyleId = computed(() => {
  const st = store.active?.style
  return st && st !== 'Default' ? st : 'Normal'
})
const noMd = computed(() => store.active?.noMarkdown ?? false)
// Flat style list (groups folded away) for the consolidated config dropdown, which
// already carries its own section header — nested group headers would over-nest it.
const allStyles = computed(() => RESPONSE_STYLES.flatMap((g) => g.rows))
function selectStyle(id: string, keepOpen = false) {
  if (store.activeId != null) store.setStyle(store.activeId, id === 'Normal' ? 'Default' : id)
  if (!keepOpen) open.value = null
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
  // Expand a `/command` invocation into its body before sending/queueing so the
  // model receives the prompt template, not the literal `/name`.
  const outgoing = outgoingText(draft.value)
  if (busy.value && store.activeId != null) {
    store.enqueue(store.activeId, outgoing, props.attachments)
    for (let i = props.attachments.length - 1; i >= 0; i--) emit('remove-att', i)
    draft.value = ''
    nextTick(grow)
    return
  }
  emit('send', outgoing)
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

// ── Autocomplete: slash `/` (commands + skills) + `@`-mention (agents + files) ──
type Autocomplete = 'slash' | 'mention' | null
const autocomplete = ref<Autocomplete>(null)
const acIndex = ref(0)
// The caret-anchored query token (the word the user is typing) for `@`-mentions.
const mentionQuery = ref('')
const RESULT_CAP = 50

function caretText(): string {
  const el = ta.value
  const v = draft.value
  if (!el) return v
  const pos = el.selectionStart ?? v.length
  return v.slice(0, pos)
}

// In-scope check: global always; project entries only when bound to that project.
function inScope(source: 'global' | 'project' | undefined, projId: string | undefined): boolean {
  if ((source ?? 'global') === 'global') return true
  return !!projectIdRef.value && projId === projectIdRef.value
}

// `/` results: built-in commands (dispatched) + user commands + skills (inserted).
const slashMatches = computed<SlashItem[]>(() => {
  if (autocomplete.value !== 'slash') return []
  const q = draft.value.slice(1).toLowerCase().split(/\s/)[0] ?? ''
  const builtins: SlashItem[] = BUILTIN_COMMANDS.filter(
    (c) => q === '' || c.name.startsWith(q),
  ).map((c) => ({
    key: `b:${c.id}`,
    label: c.name,
    desc: t(c.descKey),
    kind: 'builtin',
    builtinId: c.id,
  }))
  const cmds: SlashItem[] = data.userCommands.value
    .filter(
      (c) =>
        c.enabled !== false &&
        inScope(c.source, c.projectId) &&
        (q === '' || c.id.toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q)),
    )
    .map((c) => ({ key: `c:${c.id}`, label: c.id, desc: c.description, kind: 'command' }))
  const sk: SlashItem[] = data.skills.value
    .filter(
      (s) =>
        inScope(s.source, s.projectId) &&
        (q === '' || s.id.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q)),
    )
    .map((s) => ({ key: `s:${s.id}`, label: s.id, desc: s.description, kind: 'skill' }))
  return [...builtins, ...cmds, ...sk].slice(0, RESULT_CAP)
})

// `@` results: enabled agents (by handle) first, then workspace files (filename
// matches ranked above path-only matches). Capped — the list scrolls + user narrows.
const mentionMatches = computed<MentionRow[]>(() => {
  if (autocomplete.value !== 'mention') return []
  const q = mentionQuery.value.toLowerCase()
  const agents: MentionRow[] = data.agents.value
    .filter(
      (a) => q === '' || agentHandle(a.name).startsWith(q) || a.name.toLowerCase().includes(q),
    )
    .map((a) => ({
      key: `a:${a.id}`,
      kind: 'agent',
      insert: agentHandle(a.name),
      label: a.name,
      hint: a.source === 'project' ? t('sessions.composer.kind.project') : undefined,
    }))
  const matched = data.files.value.filter(
    (f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q),
  )
  const ranked = q
    ? [...matched].sort((a, b) => {
        const an = a.name.toLowerCase().includes(q) ? 0 : 1
        const bn = b.name.toLowerCase().includes(q) ? 0 : 1
        return an - bn || a.path.localeCompare(b.path)
      })
    : matched
  const files: MentionRow[] = ranked.map((f) => ({
    key: `f:${f.path}`,
    kind: 'file',
    insert: f.path,
    label: f.name,
    hint: f.path,
  }))
  return [...agents, ...files].slice(0, RESULT_CAP)
})

function refreshAutocomplete() {
  const v = draft.value
  // Slash: only when the whole draft starts with `/` (a leading command token).
  if (v.startsWith('/')) {
    data.ensureCatalogs() // lazy-load user commands + skills on first `/`
    autocomplete.value = 'slash'
    if (acIndex.value >= slashMatches.value.length) acIndex.value = 0
    if (!slashMatches.value.length) autocomplete.value = null
    return
  }
  // Mention: the caret word starts with `@` (preceded by start-of-line or space).
  const m = /(^|\s)@([\w./-]*)$/.exec(caretText())
  if (m) {
    data.ensureCatalogs() // agents
    data.ensureFiles() // workspace file index
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
  if (autocomplete.value === 'slash') applySlash(acIndex.value)
  else if (autocomplete.value === 'mention') applyMention(acIndex.value)
}
function applySlash(i: number) {
  const item = slashMatches.value[i]
  if (!item) return
  const rest = draft.value.replace(/^\/\S*\s?/, '')
  if (item.kind === 'builtin' && item.builtinId) {
    // Built-ins are actions: strip the typed token and dispatch (no text insert).
    draft.value = rest
    closeAutocomplete()
    onCommand(item.builtinId)
  } else {
    // User command / skill → insert `/id ` (expanded into the prompt on send).
    draft.value = `/${item.label} ${rest}`.trimEnd() + (rest ? '' : ' ')
    closeAutocomplete()
  }
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}
function applyMention(i: number) {
  const item = mentionMatches.value[i]
  if (!item) return
  // Replace the caret's `@query` word with the full `@insert` token + trailing space.
  draft.value = draft.value.replace(
    /(^|\s)@([\w./-]*)$/,
    (_m, pre: string) => `${pre}@${item.insert} `,
  )
  closeAutocomplete()
  nextTick(() => {
    ta.value?.focus()
    grow()
  })
}

// Expand a `/command args` draft into the user command's body on send (built-ins
// are dispatched via the menu, never sent as text). Non-invocations pass through.
function outgoingText(raw: string): string {
  const inv = parseSlashInvocation(raw)
  if (!inv) return raw
  const cmd = findInvocableCommand(data.userCommands.value, inv.name, projectIdRef.value)
  return cmd ? expandCommandBody(cmd.body, inv.args) : raw
}

// Byte length of a string (chip size meta) — mirrors the dropped/picked file path.
const byteLen = (s: string): number => new TextEncoder().encode(s).length

// ── Clipboard paste → attachment ──────────────────────────────────────────────
// Two cases beyond plain text (small pastes fall through to the textarea insert):
//   1) clipboard images (screenshots, copied image files) → inline image
//      attachment (data URL, re-fed each turn — see memory image-attachments).
//   2) a large plain-text paste (≥ threshold, when "paste as file" is enabled) →
//      a `pasted-text-N.txt` attachment instead of dumping it inline, keeping the
//      input clean. Capped to ATTACHMENT_TEXT_MAX like dropped/picked text files.
function onPaste(e: ClipboardEvent) {
  const data = e.clipboardData
  if (!data) return

  // (1) Images on the clipboard.
  let handledImage = false
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (!file) continue
    handledImage = true
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
  if (handledImage) return

  // (2) Large plain-text paste → a .txt attachment (gated by the user setting).
  if (!settings.sessions.pasteAsFile) return
  const text = data.getData('text/plain')
  if (!text || text.length < settings.sessions.pasteThreshold) return
  e.preventDefault()
  const value = text.slice(0, ATTACHMENT_TEXT_MAX)
  const truncated = value.length < text.length
  const index = props.attachments.filter((a) => a.name.startsWith('pasted-text-')).length + 1
  const att: SessionAttachment = {
    name: `pasted-text-${index}.txt`,
    img: false,
    text: value,
    mime: 'text/plain',
    size: byteLen(value),
  }
  emit('add-att', att)
  if (truncated) showNotice(t('sessions.composer.pasteTruncated'))
}
</script>

<style scoped>
/* Keep the composer toolbar on ONE line. The prototype's .cbar sets flex-wrap:wrap
   "for responsiveness", but a long account name then pushed the Send/Stop button
   onto a second row. Disable wrap and make the account chip the single flexible
   item: it shrinks + ellipsises its label while the fixed chips + action buttons
   keep their natural size. */
.cbar {
  flex-wrap: nowrap;
}
.cbar > .chip,
.cbar > .iconbtn,
.cbar > span:last-child {
  flex: 0 0 auto;
}
/* The account chip is the one that flexes (it carries the variable-length label). */
.cbar > .chip.acct {
  flex: 0 1 auto;
  min-width: 0;
}
/* Consolidated config dropdown (compact toolbar) — wider than a plain .smenu so the
   style hints read, and height-capped with its own scroll since it folds all four
   selectors + thinking + the no-markdown toggle into one popover. */
.cfgmenu {
  min-width: 240px;
  max-width: 300px;
  max-height: min(60vh, 460px);
  overflow-y: auto;
}
/* Account chip label: cap width + ellipsis so a long account name (e.g.
   "Malme Co (tran.quang_hoa)") stays a concise chip; the full "label · Provider"
   is in the chip's title. min-width:0 lets it shrink below the cap when the row is
   tight so the chip never forces a wrap/overflow. */
.chiplbl {
  display: inline-block;
  min-width: 0;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
/* Outlined attachment chips: drop the grey fill (prototype .att uses
   var(--bgActive)) to match the transcript chips + flat step rows; keep the border,
   add a subtle hover since the chip opens a preview. Covers pending, queued (.qatt)
   and the "+N more" (.attmore) chips. */
.att {
  background: transparent;
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}
.att:hover {
  background: var(--bgHover);
  border-color: var(--borderStrong);
}
@media (prefers-reduced-motion: reduce) {
  .att {
    transition: none;
  }
}
/* Transient built-in command feedback (Mode → Plan, /compact running…). Sits just
   above the textarea; auto-dismisses (showNotice). */
.cmdnotice {
  margin: 0 2px 6px;
  padding: 5px 10px;
  border-radius: 7px;
  background: var(--bgActive);
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: 0.9231rem;
}
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
/* Drop the grey fill (prototype .fwcard uses var(--bgSubtle)) — the accent left-border
   + outline already mark these as quote cards, matching the flat composer chips. */
.fwcard {
  background: transparent;
}
/* Cap the visible quote stack at ~3 cards; beyond that the box scrolls so a long
   stack of follow-up quotes can't push the textarea + toolbar off-screen. The
   partial 4th card peeks to hint there's more. padding-right keeps the scrollbar
   off the card borders. */
.sfollow.scroll {
  max-height: 210px;
  overflow-y: auto;
  padding-right: 4px;
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
