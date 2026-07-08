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
          <textarea
            class="fwnote"
            :value="q.note"
            rows="1"
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
          <span class="attn">{{ queuedLabel(q) }}</span>
          <span
            class="qsend"
            :title="t('sessions.composer.queuedSendNow')"
            @click.stop="sendQueuedNow(i)"
          >
            <Icon name="send" style="width: 11px; height: 11px" />
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

      <!-- persistent while /compact runs; else transient built-in command feedback -->
      <div v-if="compacting" class="cmdnotice compacting">
        <Icon name="refresh" class="cmdspin" style="width: 12px; height: 12px" />
        {{ t('sessions.command.notice.compacting') }}
      </div>
      <div v-else-if="commandNotice" class="cmdnotice">{{ commandNotice }}</div>

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
          <Icon v-else-if="a.folder" name="folder" style="width: 11px; height: 11px" />
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
      <!-- Pinned context (session working-set) is managed entirely from the pin button's
           popover below; the button shows a count so the bar stays uncluttered. -->

      <!-- soft budget warning: cumulative cost crossed the limit (no block). -->
      <div v-if="budgetOver" class="budgetwarn">
        <Icon name="alert" style="width: 12px; height: 12px; flex: 0 0 auto" />
        {{ t('sessions.budget.warnBanner', { cost: budgetLabel }) }}
      </div>

      <div class="cbar">
        <!-- Per-turn Mode chip (Ask/Plan/AcceptEdits/Execute). Model / Account /
             Reasoning-effort / Style moved to the global status-bar chips. -->
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
        <span class="grow1" />
        <span style="position: relative">
          <button
            class="iconbtn"
            :title="
              pinnedCount > 0
                ? t('sessions.pinned.titleCount', { n: pinnedCount })
                : t('sessions.pinned.title')
            "
            style="width: 28px; height: 28px; position: relative"
            :style="
              hasPinned || open === 'pin'
                ? { color: 'var(--accent)', borderColor: 'var(--accentBorder)' }
                : {}
            "
            @click="onPinOpen"
          >
            <Icon name="pin" style="width: 14px; height: 14px" />
            <!-- Count (files + notes + applied note-presets). .fbadge is absolute so it
                 floats at the corner without adding a second grid row (the bug that
                 stacked the number below the icon + broke the button height). -->
            <span v-if="pinnedCount > 0" class="fbadge">{{ pinnedCount }}</span>
          </button>
          <div
            v-if="open === 'pin'"
            class="pop pinpop"
            style="position: absolute; bottom: 130%; right: 0; z-index: 50"
            @click.stop
          >
            <div class="pinpop-h">{{ t('sessions.pinned.title') }}</div>
            <div class="pinpop-hint">{{ t('sessions.pinned.hint') }}</div>

            <!-- pinned files -->
            <div v-if="pinnedFiles.length" class="pinlist">
              <div v-for="f in pinnedFiles" :key="f" class="pinrow">
                <Icon name="file" style="width: 12px; height: 12px; flex: 0 0 auto" />
                <span class="pinpath" :title="f">{{ f }}</span>
                <span class="pinx" :title="t('sessions.pinned.remove')" @click="removePin(f)">
                  ×
                </span>
              </div>
            </div>

            <!-- applied reusable notes (toggled from the library below, like file pins) -->
            <div v-if="appliedNotes.length" class="pinlist">
              <div v-for="(n, i) in appliedNotes" :key="`an${i}`" class="pinrow" :title="n">
                <Icon name="pin" style="width: 12px; height: 12px; flex: 0 0 auto" />
                <span class="pinpath">{{ noteLabel(n) }}</span>
                <span class="pinx" :title="t('sessions.pinned.remove')" @click="toggleNote(n)">
                  ×
                </span>
              </div>
            </div>

            <!-- add a file (workspace file index, same source as @-mention) -->
            <input
              v-model="pinQuery"
              class="pininput"
              :placeholder="t('sessions.pinned.searchFiles')"
            />
            <div v-if="pinFileMatches.length" class="pinmatches">
              <div
                v-for="f in pinFileMatches"
                :key="f.path"
                class="pinmatch"
                :title="f.path"
                @click="addPin(f.path)"
              >
                <Icon name="plus" style="width: 11px; height: 11px; flex: 0 0 auto" />
                <span class="pinmname">{{ f.name }}</span>
                <span class="pinmpath">{{ f.path }}</span>
              </div>
            </div>

            <!-- notes (persisted on blur) -->
            <textarea
              v-model="notesDraft"
              class="pinnotes"
              :placeholder="t('sessions.pinned.notesPlaceholder')"
              rows="3"
              @blur="saveNotes"
            />

            <!-- reusable notes: save the current note as a preset, or apply a saved
                 preset / recent note — a cross-session library (see useSessionNotePresets). -->
            <div class="pinreuse-bar">
              <button
                v-if="!presetNaming"
                class="pinreuse-save"
                :disabled="!notesDraft.trim()"
                :title="t('sessions.pinned.savePresetTitle')"
                @click="startPreset"
              >
                <Icon name="pin" style="width: 11px; height: 11px" />
                {{ t('sessions.pinned.savePreset') }}
              </button>
              <template v-else>
                <input
                  ref="presetNameInput"
                  v-model="presetName"
                  class="pinreuse-name"
                  :placeholder="t('sessions.pinned.presetNamePlaceholder')"
                  @keydown.enter.prevent="confirmPreset"
                  @keydown.esc.prevent="cancelPreset"
                />
                <button
                  class="pinreuse-iconbtn"
                  :title="t('sessions.pinned.savePreset')"
                  @click="confirmPreset"
                >
                  <Icon name="check" style="width: 13px; height: 13px" />
                </button>
                <button
                  class="pinreuse-iconbtn"
                  :title="t('sessions.pinned.cancelPreset')"
                  @click="cancelPreset"
                >
                  <Icon name="x" style="width: 13px; height: 13px" />
                </button>
              </template>
            </div>

            <template v-if="notePresets.length">
              <div class="pinreuse-h">{{ t('sessions.pinned.presets') }}</div>
              <div class="pinreuse-list">
                <div
                  v-for="p in notePresets"
                  :key="p.id"
                  class="pinreuse-item"
                  :class="{ active: isNoteApplied(p.text) }"
                  :title="p.text"
                  @click="toggleNote(p.text)"
                >
                  <Icon name="pin" style="width: 11px; height: 11px; flex: 0 0 auto" />
                  <span class="pinreuse-label">{{ p.name }}</span>
                  <Icon
                    v-if="isNoteApplied(p.text)"
                    name="check"
                    :title="t('sessions.pinned.inUse')"
                    style="width: 12px; height: 12px; flex: 0 0 auto"
                  />
                  <span
                    class="pinx"
                    :title="t('sessions.pinned.deletePreset')"
                    @click.stop="deleteNotePreset(p.id)"
                  >
                    ×
                  </span>
                </div>
              </div>
            </template>

            <template v-if="noteHistory.length">
              <div class="pinreuse-h">
                {{ t('sessions.pinned.recentNotes') }}
                <span class="pinreuse-clear" @click="clearNoteHistory">
                  {{ t('sessions.pinned.clearRecent') }}
                </span>
              </div>
              <div class="pinreuse-list">
                <div
                  v-for="(h, i) in noteHistory"
                  :key="i"
                  class="pinreuse-item"
                  :class="{ active: isNoteApplied(h) }"
                  :title="h"
                  @click="toggleNote(h)"
                >
                  <Icon name="rules" style="width: 11px; height: 11px; flex: 0 0 auto" />
                  <span class="pinreuse-label">{{ noteLabel(h) }}</span>
                  <Icon
                    v-if="isNoteApplied(h)"
                    name="check"
                    :title="t('sessions.pinned.inUse')"
                    style="width: 12px; height: 12px; flex: 0 0 auto"
                  />
                  <span
                    class="pinx"
                    :title="t('sessions.pinned.deleteRecent')"
                    @click.stop="deleteNoteHistory(h)"
                  >
                    ×
                  </span>
                </div>
              </div>
            </template>
          </div>
        </span>
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
        <button
          class="iconbtn"
          :title="t('sessions.composer.attachFolder')"
          style="width: 28px; height: 28px"
          @click="emit('pick-folder')"
        >
          <Icon name="folder" style="width: 14px; height: 14px" />
        </button>
        <!-- Compacting → disabled processing button (Send locked until the RPC ends).
             Idle → Send. While a turn streams → Stop + a split steer/queue button
             (caret opens the alternate action). Mirrors the production composer. -->
        <span v-if="compacting">
          <button class="btn pri sm" disabled :title="t('sessions.composer.compacting')">
            <Icon name="refresh" class="cmdspin" />
            {{ t('sessions.composer.compacting') }}
          </button>
        </span>
        <span v-else-if="!busy">
          <button class="btn pri sm" :title="t('sessions.composer.send')" @click="sendNow">
            <Icon name="send" />
            {{ t('sessions.composer.send') }}
          </button>
        </span>
        <span v-else class="sendgrp">
          <button
            class="btn pri sm stop"
            :title="t('sessions.composer.stopTooltip')"
            @click="store.activeId != null && store.cancel(store.activeId)"
          >
            <Icon name="stop" />
            {{ t('sessions.composer.stop') }}
          </button>
          <span v-if="hasContent" class="splitsend">
            <button
              class="btn pri sm splitmain"
              :title="streamPrimaryTitle"
              @click="onStreamPrimary"
            >
              <Icon :name="streamPrimaryAction === 'steer' ? 'send' : 'clock'" />
            </button>
            <button
              class="btn pri sm splitcaret"
              :title="t('sessions.composer.queue')"
              @click.stop="sendMenuOpen = !sendMenuOpen"
            >
              <Icon name="chev" style="transform: rotate(180deg)" />
            </button>
            <div v-if="sendMenuOpen" class="smenu sendmenu" @click.stop>
              <div
                v-if="store.activeCanSteer"
                class="mi sty"
                :class="{ mdisabled: !canSteer }"
                @click="pickSteer"
              >
                <Icon name="send" class="styicon" />
                <div class="stytext">
                  <div class="nm2">{{ t('sessions.composer.steer') }}</div>
                  <div class="sd2">{{ t('sessions.composer.steerHint') }}</div>
                </div>
              </div>
              <div class="mi sty" @click="pickQueue">
                <Icon name="clock" class="styicon" />
                <div class="stytext">
                  <div class="nm2">{{ t('sessions.composer.queue') }}</div>
                  <div class="sd2">{{ t('sessions.composer.queueHint') }}</div>
                </div>
              </div>
            </div>
          </span>
        </span>
      </div>
    </div>
    <div v-if="open" style="position: fixed; inset: 0; z-index: 40" @click="open = null" />
    <div
      v-if="sendMenuOpen"
      style="position: fixed; inset: 0; z-index: 40"
      @click="sendMenuOpen = false"
    />
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
import type {
  QueuedMessage,
  SessionAttachment,
  SlashCommandRef,
} from '~/composables/useSessionsData'
import { useComposerData } from '~/composables/useComposerData'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import { pushActionToast } from '~/composables/useActionToasts'
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
  // `text` is the expanded body sent to the model; `command` (when set) is the
  // slash invocation displayed compactly in the user bubble.
  send: [text: string, command?: SlashCommandRef]
  pick: []
  // Attach one or more FOLDERS (read-only context) via the native directory picker.
  'pick-folder': []
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
const { CIRCLED } = useSessionsData()
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
    // No transient notice here — store.compacting drives a persistent "compacting…"
    // line + a locked Send button for the whole RPC (result surfaces as a toast).
    void store.compactSession(store.activeId).then((r) => {
      if (r === 'compacted') {
        pushActionToast(t('sessions.command.notice.compacted'), 'success')
      } else if (r === 'nothing') {
        pushActionToast(t('sessions.command.notice.nothingToCompact'), 'info')
      } else {
        pushActionToast(t('sessions.command.notice.compactFailed'), 'error')
      }
    })
  } else if (cmd.action.type === 'style') {
    // The style picker moved to the status bar; `/style` pops it there.
    useStatusConfig().open('style')
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
    store.setQuoteNote(store.activeId, i, (e.target as HTMLTextAreaElement).value)
}

// The per-turn Mode chip reads straight off the active session (store-driven);
// model / account / effort / style moved to the status-bar chips (StatusConfig).
const selectedMode = computed(() => store.active?.mode || 'Ask')

// Composer popovers: the Mode chip + the pinned-context popover.
type MenuKind = 'mode' | 'pin'
const open = ref<MenuKind | null>(null)
function toggle(kind: MenuKind) {
  open.value = open.value === kind ? null : kind
}

// ── Pinned context (session working-set) ─────────────────────────────────────
// Files + notes re-fed into every turn by the sidecar. Reads the active session;
// writes go through store actions (persist via upsert). The notes are edited via a
// local draft persisted on blur so we don't fire an upsert on every keystroke.
const pinnedFiles = computed<string[]>(() => store.active?.pinnedContext?.files ?? [])
// Reusable notes (preset / recent) applied to this session as toggled units — like
// attaching files. `appliedNotes` is the applied set; isNoteApplied flags which library
// items are on so they render active with a ✓. Multiple can be applied at once.
const appliedNotes = computed<string[]>(() => store.active?.pinnedContext?.notePresets ?? [])
const isNoteApplied = (text: string) => appliedNotes.value.includes(text.trim())
const hasPinned = computed(
  () =>
    pinnedFiles.value.length > 0 ||
    appliedNotes.value.length > 0 ||
    !!store.active?.pinnedContext?.notes?.trim(),
)
// Badge count on the pin button = files + applied notes + (1 if free-text notes set).
const pinnedCount = computed(
  () =>
    pinnedFiles.value.length +
    appliedNotes.value.length +
    (store.active?.pinnedContext?.notes?.trim() ? 1 : 0),
)
const notesDraft = ref('')
watch(
  () => [store.activeId, store.active?.pinnedContext?.notes] as const,
  () => {
    notesDraft.value = store.active?.pinnedContext?.notes ?? ''
  },
  { immediate: true },
)
// Cross-session reusable notes: saved presets + recent history (localStorage-backed).
const {
  presets: notePresets,
  history: noteHistory,
  savePreset,
  deletePreset: deleteNotePreset,
  recordHistory,
  deleteHistory: deleteNoteHistory,
  clearHistory: clearNoteHistory,
  deriveName: noteLabel,
} = useSessionNotePresets()
function saveNotes() {
  if (store.activeId != null) store.setPinnedNotes(store.activeId, notesDraft.value)
  // Capture the committed note so it's reusable in other sessions (no-op when empty).
  recordHistory(notesDraft.value)
}
// Keep the current note as a named preset. Clicking "Save as preset" reveals an inline
// name field (prefilled with the first line) so the user can label it — Enter saves,
// Esc cancels. An empty name falls back to the derived label (savePreset handles it).
const presetNaming = ref(false)
const presetName = ref('')
const presetNameInput = useTemplateRef<HTMLInputElement>('presetNameInput')
function startPreset() {
  if (!notesDraft.value.trim()) return
  presetName.value =
    notesDraft.value
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? ''
  presetNaming.value = true
  void nextTick(() => presetNameInput.value?.focus())
}
function confirmPreset() {
  if (notesDraft.value.trim()) savePreset(notesDraft.value, presetName.value)
  presetNaming.value = false
  presetName.value = ''
}
function cancelPreset() {
  presetNaming.value = false
  presetName.value = ''
}
// Closing the pin popover abandons an in-progress naming so it doesn't reappear stale.
watch(
  () => open.value,
  (v) => {
    if (v !== 'pin') cancelPreset()
  },
)
// Toggle a reusable note (preset / recent) as an applied unit for this session — like
// attaching a file: click to apply, click again to remove (mirrored by the ✓ marker).
// Distinct from the free-text notes box; multiple can be applied at once.
function toggleNote(text: string) {
  if (store.activeId != null) store.togglePinnedNotePreset(store.activeId, text)
}
function removePin(path: string) {
  if (store.activeId != null) store.removePinnedFile(store.activeId, path)
}
// File picker for pinning: reuse the workspace file index (same source as @-mention).
const pinQuery = ref('')
const pinFileMatches = computed(() => {
  const q = pinQuery.value.toLowerCase().trim()
  const pinnedSet = new Set(pinnedFiles.value)
  return data.files.value
    .filter((f) => !pinnedSet.has(f.path))
    .filter((f) => q === '' || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q))
    .slice(0, 12)
})
function addPin(path: string) {
  if (store.activeId != null) store.addPinnedFile(store.activeId, path)
  pinQuery.value = ''
}
function onPinOpen() {
  toggle('pin')
  if (open.value === 'pin') data.ensureFiles()
}

// ── Budget (cost cap) ─────────────────────────────────────────────────────────
// The cost/budget readout lives in the workspace panel's Cost tab; the composer
// only keeps the soft-limit OVER warning banner (a conditional safety alert).
const { fmtUsd, overSoft } = useSessionCost()
const budgetOver = computed(() => overSoft(store.active))
const budgetLabel = computed(() => {
  const cost = store.active?.usage?.cost
  const limit = store.active?.budget?.limitUsd
  return limit ? `${fmtUsd(cost ?? 0)} / ${fmtUsd(limit)}` : fmtUsd(cost)
})

// Mode chip selection → store action (persists + drives engineSettings next turn).
function selectMode(m: string) {
  if (store.activeId != null) store.setMode(store.activeId, m)
  open.value = null
}
const modeIcon = computed(
  () => MODES_UI.find((m) => m.id === selectedMode.value)?.icon ?? 'sessions',
)

// ── Queue (gửi sau) ──────────────────────────────────────────────────────────
// While the active turn is busy, Send enqueues instead of sending; the queued
// messages render as chips above the input (the store auto-drains them FIFO when
// the turn settles — we only enqueue / display / remove).
const busy = computed(
  () => store.active?.status === 'streaming' || store.active?.status === 'awaiting',
)
// True while a `/compact` RPC is in flight — the composer shows a persistent
// "compacting…" notice + a disabled processing button and refuses to send/queue.
const compacting = computed(() => store.active?.compacting === true)
const queued = computed(() => store.active?.queue ?? [])
function dequeue(i: number) {
  if (store.activeId != null) store.dequeue(store.activeId, i)
}
// Jump the queue: stop the current turn and run this queued message right now.
function sendQueuedNow(i: number) {
  if (store.activeId != null) void store.sendQueuedNow(store.activeId, i)
}
// A queued slash command previews as its compact invocation, not the expanded body.
// A quote-only queued message (empty draft) previews its note, else the quoted text.
function queuedLabel(q: QueuedMessage): string {
  if (q.command) return `/${q.command.name}${q.command.args ? ` ${q.command.args}` : ''}`
  if (q.text) return q.text
  const firstQuote = q.quotes?.[0]
  if (firstQuote) return firstQuote.note || firstQuote.excerpt
  return t('sessions.attachment.allTitle', { n: q.att?.length ?? 0 })
}

// Primary button state. Idle → Send. While a turn runs (busy): with something
// typed → Queue (gửi sau); with nothing typed → Stop (cancel the running turn).
const hasContent = computed(
  () => !!draft.value.trim() || props.attachments.length > 0 || followups.value.length > 0,
)
// Idle button shows Send. While a turn streams, the send area splits into a Stop
// button + a steer/queue split button (see template). `sendMenuOpen` toggles the
// caret dropdown that offers the alternate streaming action.
const sendMenuOpen = ref(false)

// A draft can be STEERED (injected into the running turn) only when it is text-only
// — attachments/quotes need a full turn, so those force Queue. Mirrors old UI.
const canSteerText = computed(
  () => !!draft.value.trim() && props.attachments.length === 0 && followups.value.length === 0,
)
// Steering also requires a runtime that consumes it: the Claude SDK path (anthropic)
// has no steering hook, so those sessions QUEUE instead (never silently drop the
// message). See store.activeCanSteer.
const canSteer = computed(() => canSteerText.value && store.activeCanSteer)
const streamPrimaryAction = computed<'steer' | 'queue'>(() => (canSteer.value ? 'steer' : 'queue'))
const streamPrimaryTitle = computed(() =>
  streamPrimaryAction.value === 'steer'
    ? t('sessions.composer.steerHint')
    : t('sessions.composer.queueHint'),
)

// Idle send → start a fresh turn. Slash command expands to its body (model gets the
// template) while `command` keeps the compact bubble label.
// Re-entry guard while the pre-send quota check awaits (the draft isn't cleared until
// after, so a fast double-Enter could otherwise fire two turns).
let sendChecking = false

async function sendNow() {
  if (compacting.value) return
  const { text: outgoing, command } = buildOutgoing(draft.value)
  const hasAtt = props.attachments.length > 0
  const hasQuotes = followups.value.length > 0
  if (!outgoing.trim() && !hasAtt && !hasQuotes) return
  // Usage-quota gate: await a fresh read, then refuse the turn while KEEPING the draft
  // so the user doesn't lose what they typed. The store enforces the same gate too.
  if (sendChecking) return
  if (store.activeId != null) {
    sendChecking = true
    try {
      if (await store.checkSendBlocked(store.activeId)) {
        showNotice(t('sessions.quota.blockedSendNotice'))
        return
      }
    } finally {
      sendChecking = false
    }
  }
  closeAutocomplete()
  emit('send', outgoing, command)
  draft.value = ''
  nextTick(grow)
}

// Queue → stash the full draft (text + attachments) to auto-send as a fresh turn
// once the current one settles. We snapshot attachments into the store, then clear
// the parent's pendingAtt (descending so indices don't shift). NOT emitting `send`
// here is deliberate: the parent's onSend has no busy-guard and would open a second
// concurrent turn instead of queueing.
async function onQueue() {
  const { text: outgoing, command } = buildOutgoing(draft.value)
  const hasAtt = props.attachments.length > 0
  const hasQuotes = followups.value.length > 0
  if (!outgoing.trim() && !hasAtt && !hasQuotes) return
  if (store.activeId == null) return
  // Usage-quota gate: queueing only defers a turn that would be blocked on drain —
  // await a fresh read, refuse up front and keep the draft.
  if (sendChecking) return
  sendChecking = true
  try {
    if (await store.checkSendBlocked(store.activeId)) {
      showNotice(t('sessions.quota.blockedSendNotice'))
      return
    }
  } finally {
    sendChecking = false
  }
  closeAutocomplete()
  store.enqueue(store.activeId, outgoing, props.attachments, command)
  for (let i = props.attachments.length - 1; i >= 0; i--) emit('remove-att', i)
  draft.value = ''
  nextTick(grow)
}

// Steer → inject the raw draft text into the in-flight turn (text only; matches the
// old UI, which does not expand commands when steering). Clears just the draft.
async function onSteer() {
  const text = draft.value
  if (!text.trim() || store.activeId == null) return
  draft.value = ''
  closeAutocomplete()
  await store.steer(store.activeId, text)
  showNotice(t('sessions.composer.steerDone'))
  nextTick(grow)
}

function onStreamPrimary() {
  if (streamPrimaryAction.value === 'steer') void onSteer()
  else void onQueue()
}
function pickSteer() {
  sendMenuOpen.value = false
  if (canSteer.value) void onSteer()
}
function pickQueue() {
  sendMenuOpen.value = false
  void onQueue()
}

// Enter / primary action router: idle → fresh turn; streaming → steer or queue.
function send() {
  // Locked while /compact runs — no fresh turn, no steer, no queue.
  if (compacting.value) return
  if (busy.value) {
    if (hasContent.value) onStreamPrimary()
    return
  }
  void sendNow()
}
function onEnter(e: KeyboardEvent) {
  // An open autocomplete steals plain Enter to accept the highlighted item (never
  // Shift+Enter — that chord is reserved for the send/newline logic below).
  if (autocomplete.value && !e.shiftKey) {
    e.preventDefault()
    acceptActive()
    return
  }
  // Which chord sends vs. inserts a newline follows the user's setting
  // (Settings → Defaults → composerSendKey):
  //   'enter'       → Enter sends, Shift+Enter = newline
  //   'shift-enter' → Shift+Enter sends, Enter = newline
  const sendOnShiftEnter = settings.appearance.composerSendKey === 'shift-enter'
  const isSendChord = sendOnShiftEnter ? e.shiftKey : !e.shiftKey
  if (!isSendChord) return // the other chord → let the textarea insert a newline
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
// are dispatched via the menu, never sent as text). Returns the expanded `text`
// for the model plus the `command` invocation for the compact bubble; a
// non-invocation (or unknown command) passes the raw text through with no command.
function buildOutgoing(raw: string): { text: string; command?: SlashCommandRef } {
  const inv = parseSlashInvocation(raw)
  if (!inv) return { text: raw }
  const cmd = findInvocableCommand(data.userCommands.value, inv.name, projectIdRef.value)
  if (!cmd) return { text: raw }
  return {
    text: expandCommandBody(cmd.body, inv.args),
    command: { name: inv.name, args: inv.args },
  }
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
/* Remove button as a floating badge at the chip's top-right corner instead of the
   prototype's bare inline `×` (a tiny, fiddly target crammed against the filename).
   A circular 16px badge sits over the corner, reveals on hover/focus, and turns
   danger-red on its own hover — an isolated, easy click that frees the chip's inner
   width for the filename. (Queued `.qatt` chips also carry `.att`, so this covers
   them too.) */
.att {
  position: relative;
}
.att .x {
  position: absolute;
  top: -7px;
  right: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bgActive);
  border: 1px solid var(--border);
  color: var(--textDim);
  font-size: 0.9231rem;
  line-height: 1;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.att:hover .x,
.att:focus-within .x {
  opacity: 1;
  transform: scale(1);
}
.att .x:hover {
  background: var(--del);
  border-color: var(--del);
  color: var(--bgPanel);
}
/* "Send now" on a queued chip: mirror the remove badge but on the opposite (top-left)
   corner with an accent (positive) hover — reveal on chip hover so it doesn't crowd
   the queued-message label. Only rendered inside `.qatt` chips. */
.att .qsend {
  position: absolute;
  top: -7px;
  left: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--bgActive);
  border: 1px solid var(--border);
  color: var(--textDim);
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.att:hover .qsend,
.att:focus-within .qsend {
  opacity: 1;
  transform: scale(1);
}
.att .qsend:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accentText);
}
@media (prefers-reduced-motion: reduce) {
  .att .x {
    transition: none;
  }
}
/* Composer box reacts to focus: the border + a soft accent ring light up while the
   textarea inside is focused (focus-within), instead of a static border. */
.cbox {
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.cbox:focus-within {
  border-color: var(--accentBorder);
  box-shadow: 0 0 0 3px var(--accentDim);
}
/* Tactile press: primary + icon action buttons dip slightly when pressed, and the
   primary's hover brightness now eases in instead of snapping. */
.btn,
.iconbtn {
  transition:
    transform 0.08s ease,
    filter 0.12s ease,
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
}
.btn:active,
.iconbtn:active {
  transform: scale(0.95);
}
@media (prefers-reduced-motion: reduce) {
  .cbox,
  .btn,
  .iconbtn {
    transition: none;
  }
  .btn:active,
  .iconbtn:active {
    transform: none;
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
/* Spinner glyph shared by the "compacting…" notice + the locked Send button. */
.cmdspin {
  animation: enhspin 0.9s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cmdspin {
    animation: none;
  }
}
.cmdnotice.compacting {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* Locked Send while /compact runs — reads as processing (dimmed, not clickable). */
.btn.pri.sm:disabled {
  cursor: default;
  opacity: 0.6;
  filter: none;
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

/* Streaming send area: Stop + a split steer/queue button (caret opens the
   alternate action in a small upward menu). */
.sendgrp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.splitsend {
  position: relative;
  display: inline-flex;
  align-items: stretch;
}
.splitmain {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.splitcaret {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding-left: 6px;
  padding-right: 6px;
  border-left: 1px solid color-mix(in srgb, var(--accentText) 25%, transparent);
}
/* Anchor the menu above the split button (the base .smenu is position:fixed). */
.sendmenu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 224px;
}

/* Soft-budget warning banner above the toolbar (no block — just a heads-up). */
.budgetwarn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 2px 0;
  padding: 5px 9px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--danger);
  background: var(--dangerBg);
  border: 1px solid var(--danger);
}

/* Pinned-context popover (toolbar pin button). Reuses the .pop chrome; adds a file
   list + add-file search + a notes textarea. */
.pinpop {
  width: 320px;
  max-width: 80vw;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pinpop-h {
  font-weight: 600;
  color: var(--text);
}
.pinpop-hint {
  font-size: 12px;
  color: var(--textDim);
  margin-top: -4px;
}
.pinlist {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pinrow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--bgActive);
  color: var(--text);
}
.pinpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--code);
  font-size: 12px;
}
.pinx {
  cursor: pointer;
  color: var(--textDim);
  padding: 0 2px;
}
.pinx:hover {
  color: var(--danger);
}
.pininput,
.pinnotes {
  width: 100%;
  background: var(--bgInput, var(--bgActive));
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 12px;
}
.pinnotes {
  resize: vertical;
  min-height: 3.5rem;
  font-family: inherit;
}
.pinmatches {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow: auto;
}
.pinmatch {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
}
.pinmatch:hover {
  background: var(--bgHover);
}
.pinmname {
  font-size: 12px;
  flex: 0 0 auto;
}
.pinmpath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--textDim);
  font-family: var(--code);
}
/* Reusable-notes section (save as preset + presets/recent lists). */
.pinreuse-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: -2px;
}
.pinreuse-name {
  flex: 1;
  min-width: 0;
  background: var(--bgInput, var(--bgActive));
  border: 1px solid var(--accentBorder, var(--border));
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--text);
  font-size: 12px;
}
.pinreuse-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.pinreuse-iconbtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.pinreuse-save {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.pinreuse-save:hover:not(:disabled) {
  background: var(--bgHover);
  border-color: var(--accentBorder);
  color: var(--accent);
}
.pinreuse-save:disabled {
  opacity: 0.5;
  cursor: default;
}
.pinreuse-h {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--textDim);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.pinreuse-clear {
  margin-left: auto;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  color: var(--textDim);
}
.pinreuse-clear:hover {
  color: var(--danger);
}
.pinreuse-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 150px;
  overflow: auto;
}
.pinreuse-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
}
.pinreuse-item:hover {
  background: var(--bgHover);
}
/* The library item matching the note currently in the box — the one actually in use.
   Inset ring (not a border) so the accent marker adds no layout shift. */
.pinreuse-item.active {
  color: var(--accent);
  background: var(--bgHover);
  box-shadow: inset 0 0 0 1px var(--accentBorder, var(--border));
}
.pinreuse-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
