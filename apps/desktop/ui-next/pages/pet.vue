<template>
  <div class="pet-root" @mousemove="onMouseMove" @mouseleave="onMouseLeave">
    <!-- Design-size canvas: everything with TEXT in it (HUD, speech bubble, badge)
         stays at this size whatever the pet size setting says — only the sprite
         scales, below. Main still grows the window by the same factor, so the taller
         sprite always has room; both anchor bottom-right, so they stay in register. -->
    <!-- Whole draw region gone while dismissed: an empty canvas means the hit-test
         finds nothing, so the window falls back to fully click-through and no
         quip/trick/animation runs (the DOM isn't mounted). A new prompt in any session
         flips `dismissed` back off (usePetDismiss). -->
    <div v-if="!model.dismissed" class="pet-canvas">
      <div v-if="hudOpen" ref="hudRef" class="pet-hudwrap">
        <PetHud
          :model="model"
          :expanded="expanded"
          @open="onOpen"
          @activity="send({ kind: 'open', target: { kind: 'activity' } })"
          @decide="onDecide"
        />
      </div>

      <!-- Speech bubble. Lives OUTSIDE the HUD so the pet can pipe up during a long
           turn without the whole panel opening; hidden when the HUD takes that space. -->
      <div v-if="quip && !hudOpen" class="pet-quip">{{ quip }}</div>

      <div
        ref="petRef"
        class="pet-anchor"
        :style="{ '--pet-scale': model.scale }"
        :title="tooltip"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <!-- Temporary-dismiss X. Sits INSIDE the anchor rect so the existing hit-test
             already covers it. Stops its own pointer/click so it never triggers the
             anchor's pin/drag; sends `dismiss` (does NOT touch the enabled pref). -->
        <button
          v-if="hovering"
          type="button"
          class="pet-dismiss"
          :title="t('pet.dismiss')"
          @pointerdown.stop
          @pointerup.stop
          @click.stop="send({ kind: 'dismiss' })"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div class="pet-sprite">
          <PetSprite
            :state="model.state"
            :sprite="model.sprite"
            :facing="model.facing"
            :alt="altScene"
            :special="special"
          />
        </div>
        <span v-if="badge" class="pet-badge" :class="`is-${model.state}`">{{ badge }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { AwogPetCommand, AwogPetItem, AwogPetModel } from '~/types/awog-bridge'

// ── Desktop pet window (docs/features/desktop-pet.md) ────────────────────────
// Renders in its own transparent, always-on-top, click-through window
// (electron/src/pet-window.ts). PASSIVE: the main window computes the model and
// pushes it here (usePetStatus); this page draws it and sends commands back. It
// never talks to the sidecar, so it can't become a second driver of a live turn.
//
// Two shell mechanics live here because only the DOM knows them:
//   • hit-test — the window is click-through by default; while the cursor is over
//     the sprite or the open HUD we ask main to make it interactive, so the rest of
//     the 320×280 frame stays transparent to clicks.
//   • drag — a pointer drag on the sprite hands off to main, which follows the
//     cursor (the window moves under the pointer, so renderer deltas would fight it).

definePageMeta({ layout: false })

const IDLE_MODEL: AwogPetModel = {
  state: 'idle',
  counts: { running: 0, attention: 0, unread: 0 },
  items: [],
  permission: null,
  autoPeek: true,
  quips: true,
  tricks: true,
  quipLines: [],
  reminders: [],
  reminderMs: 0,
  sprite: 'girl',
  scale: 1,
  dismissed: false,
  facing: 'left',
}

// Auto-peek window when work starts needing attention / finishes.
const PEEK_MS = 6000
// Grace before the HUD closes, so crossing the gap from sprite to HUD doesn't flicker.
const CLOSE_DELAY_MS = 250
// Pointer travel that turns a click into a drag.
const DRAG_THRESHOLD_PX = 3

// Speech bubbles. The LINES arrive in the model already resolved (user edits from
// Settings → Pet, else the localised defaults) — this window never reads settings.
const QUIP_MS = 6500
// While a turn drags on, say something new now and then instead of going silent.
const QUIP_REPEAT_MS = 50_000

// Scene changes — how long each animation of a state plays before swapping to its
// alternative. Working alternates run/walk; idle mostly breathes and takes an
// occasional short stroll.
const WORK_SCENE_MS = 7000
const IDLE_SCENE_MS = 16_000
const IDLE_ALT_MS = 3500

// Skill (the sheet's `special` row). MUST match the animation duration in
// PetSprite.vue: the CSS plays it once, this is what puts the pet back on its state row.
const SPECIAL_MS = 1000
// How often the pet performs on its own while nothing is running. Rare on purpose — a
// trick every few seconds is a distraction, and this thing floats over every window.
const TRICK_IDLE_MS = 180_000

const { t } = useI18n()

const bridge = typeof window !== 'undefined' ? window.awog : undefined

const model = ref<AwogPetModel>(IDLE_MODEL)
const pinned = ref(false)
const hovering = ref(false)
const peeking = ref(false)
const dragging = ref(false)
const special = ref(false)

const petRef = useTemplateRef<HTMLElement>('petRef')
const hudRef = useTemplateRef<HTMLElement>('hudRef')

const hudOpen = computed(() => hovering.value || pinned.value || peeking.value)
// "Deliberately open" — an auto-peek must not expose the approve buttons.
const expanded = computed(() => hovering.value || pinned.value)

const badge = computed<string>(() => {
  const { attention, running, unread } = model.value.counts
  if (attention > 0) return String(attention)
  if (running > 0) return String(running)
  return unread > 0 ? String(unread) : ''
})

const tooltip = computed(() => {
  const { attention, running, unread } = model.value.counts
  if (model.value.state === 'offline') return 'AWOG'
  return running || attention || unread ? `AWOG · ${running}▶ ${attention}⏸ ${unread}●` : 'AWOG'
})

const send = (cmd: AwogPetCommand): void => bridge?.sendPetCommand?.(cmd)

function onOpen(item: AwogPetItem): void {
  send({
    kind: 'open',
    target:
      item.kind === 'session'
        ? { kind: 'session', engineId: item.id }
        : { kind: 'task', id: item.id },
  })
}

function onDecide(decision: 'allow' | 'deny'): void {
  const perm = model.value.permission
  if (!perm) return
  send({ kind: 'permission', requestId: perm.requestId, decision })
  // Optimistic: drop the card so the HUD doesn't invite a second click while the
  // main window resolves it (a stale requestId there is dropped, not re-answered).
  model.value = { ...model.value, permission: null }
}

// ── HUD open/close ──
let closeTimer: ReturnType<typeof setTimeout> | null = null
let peekTimer: ReturnType<typeof setTimeout> | null = null

function cancelClose(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}
function scheduleClose(): void {
  if (closeTimer) return
  closeTimer = setTimeout(() => {
    hovering.value = false
    closeTimer = null
  }, CLOSE_DELAY_MS)
}
function peek(): void {
  peeking.value = true
  if (peekTimer) clearTimeout(peekTimer)
  peekTimer = setTimeout(() => {
    peeking.value = false
    peekTimer = null
  }, PEEK_MS)
}

// ── Click-through hit-test ──
let interactiveNow = false
function setInteractive(on: boolean): void {
  if (on === interactiveNow) return
  interactiveNow = on
  bridge?.setPetInteractive?.(on)
}

function hit(el: HTMLElement | null, e: MouseEvent): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
}

function onMouseMove(e: MouseEvent): void {
  // Mid-drag the window is chasing the cursor — freezing the hit-test keeps the
  // window interactive so the pointerup that ends the drag still lands.
  if (dragging.value) return
  const over = hit(petRef.value, e) || (hudOpen.value && hit(hudRef.value, e))
  setInteractive(over)
  if (over) {
    cancelClose()
    hovering.value = true
  } else {
    scheduleClose()
  }
}

function onMouseLeave(): void {
  if (dragging.value) return
  setInteractive(false)
  scheduleClose()
}

// ── Drag / click ──
let downAt: { x: number; y: number } | null = null

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  downAt = { x: e.clientX, y: e.clientY }
  // Capture so the move/up still arrive once main starts moving the window.
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!downAt || dragging.value) return
  const travel = Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y)
  if (travel < DRAG_THRESHOLD_PX) return
  dragging.value = true
  bridge?.sendPetDrag?.('start')
}

function onPointerUp(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  if (dragging.value) {
    bridge?.sendPetDrag?.('end')
    dragging.value = false
    downAt = null
    return
  }
  downAt = null
  // A plain click pins/unpins the HUD — and pokes the pet, which is the one trigger
  // that is a direct answer to the user rather than to the work.
  pinned.value = !pinned.value
  if (pinned.value) peeking.value = false
  trick()
}

function onPointerCancel(): void {
  if (dragging.value) bridge?.sendPetDrag?.('end')
  dragging.value = false
  downAt = null
}

// ── Quips: the pet says something ──
const quip = ref('')
let quipHideTimer: ReturnType<typeof setTimeout> | null = null
let quipRepeatTimer: ReturnType<typeof setTimeout> | null = null

function clearQuipTimers(): void {
  if (quipHideTimer) clearTimeout(quipHideTimer)
  if (quipRepeatTimer) clearTimeout(quipRepeatTimer)
  quipHideTimer = null
  quipRepeatTimer = null
}

function show(lines: string[]): void {
  if (!model.value.quips || !lines.length) return
  quip.value = lines[Math.floor(Math.random() * lines.length)] ?? ''
  if (quipHideTimer) clearTimeout(quipHideTimer)
  quipHideTimer = setTimeout(() => {
    quip.value = ''
    quipHideTimer = null
  }, QUIP_MS)
}

function say(): void {
  clearQuipTimers()
  if (!model.value.quips) {
    quip.value = ''
    return
  }
  show(model.value.quipLines)
  // Only a state that can last (a running turn, an unanswered gate) gets a repeat —
  // a pet that keeps talking while idle is a pet you turn off.
  if (model.value.state === 'working' || model.value.state === 'awaiting') {
    quipRepeatTimer = setTimeout(say, QUIP_REPEAT_MS)
  }
}

// ── Periodic reminders (drink water / stretch / rest your eyes) ──
// On its own clock, not the state clock: the point is the passage of TIME, so it
// keeps its interval across state changes rather than restarting with each one.
let reminderTimer: ReturnType<typeof setInterval> | null = null

function stopReminders(): void {
  if (reminderTimer) clearInterval(reminderTimer)
  reminderTimer = null
}

function scheduleReminders(): void {
  stopReminders()
  const every = model.value.reminderMs
  if (!every || !model.value.quips) return
  reminderTimer = setInterval(() => {
    // Never nudge someone who isn't there: with the app window closed the pet is
    // asleep, and a reminder nobody sees just burns the interval.
    if (model.value.state === 'offline') return
    show(model.value.reminders)
  }, every)
}

// ── Skill: the pack's own one-shot animation ──
let specialTimer: ReturnType<typeof setTimeout> | null = null
let trickTimer: ReturnType<typeof setTimeout> | null = null

function stopTrick(): void {
  if (specialTimer) clearTimeout(specialTimer)
  if (trickTimer) clearTimeout(trickTimer)
  specialTimer = null
  trickTimer = null
  special.value = false
}

// One-shot, and a call while it is already playing is DROPPED rather than queued: a CSS
// animation cannot restart without dropping the class for a frame, and nobody asked for
// a backlog of tricks. Packs with no `special` row ignore the flag (PetSprite.vue), so
// this stays a pure "ask" — the sprite decides whether it can answer.
function trick(): void {
  if (!model.value.tricks || special.value) return
  // Offline the pet is asleep: performing would claim the app is alive when it is not.
  if (model.value.state === 'offline') return
  special.value = true
  if (specialTimer) clearTimeout(specialTimer)
  specialTimer = setTimeout(() => {
    special.value = false
    specialTimer = null
  }, SPECIAL_MS)
}

// Only while IDLE. During a turn the state rows are already moving and the HUD is what
// the user is watching; a trick there would fight both.
function scheduleTrick(): void {
  if (trickTimer) clearTimeout(trickTimer)
  trickTimer = null
  if (!model.value.tricks || model.value.state !== 'idle') return
  trickTimer = setTimeout(() => {
    trick()
    scheduleTrick()
  }, TRICK_IDLE_MS)
}

// ── Scene changes within a state ──
const altScene = ref(false)
let sceneTimer: ReturnType<typeof setTimeout> | null = null

function stopScene(): void {
  if (sceneTimer) clearTimeout(sceneTimer)
  sceneTimer = null
}

function scheduleScene(): void {
  stopScene()
  const state = model.value.state
  if (state === 'working') {
    sceneTimer = setTimeout(() => {
      altScene.value = !altScene.value
      scheduleScene()
    }, WORK_SCENE_MS)
    return
  }
  if (state === 'idle') {
    // Long breathe, short stroll — the break is the punctuation, not the norm.
    sceneTimer = setTimeout(
      () => {
        altScene.value = !altScene.value
        scheduleScene()
      },
      altScene.value ? IDLE_ALT_MS : IDLE_SCENE_MS,
    )
    return
  }
  altScene.value = false
}

// ── Model in ──
let offModel: (() => void) | undefined
// TEMP DIAGNOSTIC (remove with the one in usePetStatus): this renderer's errors now
// reach the app log (pet-window.ts), but Electron's console-message drops the stack —
// so surface it ourselves, with the call site.
function onUncaught(e: ErrorEvent): void {
  console.error('[pet] uncaught:', e.message, e.error instanceof Error ? e.error.stack : '')
}
watch(
  () => [model.value.reminderMs, model.value.quips] as const,
  () => scheduleReminders(),
  { immediate: true },
)

// Turning the skill off in Settings must stop the idle timer, not just the next frame.
watch(
  () => model.value.tricks,
  () => scheduleTrick(),
)

onMounted(() => {
  window.addEventListener('error', onUncaught)
  offModel = bridge?.onPetModel?.((next) => {
    model.value = next
  })
})

// Auto-peek on the transitions that mean "something changed for you": work parked
// on an approval, or work finished. Never on going busy — that is not news.
watch(
  () => model.value.state,
  (next, prev) => {
    if (next === prev) return
    // A new state is news: fresh line, fresh scene cycle.
    say()
    altScene.value = false
    scheduleScene()
    scheduleTrick()
    // Work just landed — perform. This is the trigger that earns the row: `done` is the
    // one state the user is glad to see, and it is otherwise the calmest animation.
    if (next === 'done') trick()
    if (!model.value.autoPeek) return
    if (next === 'awaiting' || next === 'done') peek()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('error', onUncaught)
  clearQuipTimers()
  stopReminders()
  stopScene()
  stopTrick()
  offModel?.()
  if (closeTimer) clearTimeout(closeTimer)
  if (peekTimer) clearTimeout(peekTimer)
})
</script>

<style>
/* The window is transparent; the app shell paints an opaque body by default, which
   would show up as a grey rectangle around the pet. Scoped styles can't reach these
   elements, so this block is intentionally global — this renderer only ever shows
   the pet route. */
html,
body,
#__nuxt {
  background: transparent !important;
  overflow: hidden;
}
</style>

<style scoped>
.pet-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  /* Nothing here is a document: no text selection, no drag-image, no caret. */
  user-select: none;
  -webkit-user-select: none;
}

/* Design-size canvas. 320x280 MUST match BASE_WIDTH/BASE_HEIGHT in
   electron/src/pet-window.ts — main sizes the window by `scale`, this canvas does
   NOT, and both anchor bottom-right so they stay in register. The window is
   therefore always at least as tall as the stack, which is what lets the sprite
   grow (below) without pushing the HUD out of the frame. */
.pet-canvas {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 320px;
  height: 280px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-end;
  gap: 6px;
  padding: 6px;
}

/* Speech bubble — pointer-events:none so it never eats a click meant for the desktop
   (the hit-test only ever makes the sprite and the HUD interactive). */
.pet-quip {
  align-self: flex-end;
  max-width: 100%;
  padding: 7px 10px;
  /* design-token-ok: near-square corner = the speech-bubble tail (see LibraryCreatorPanel). */
  border-radius: var(--r-btn) var(--r-btn) 3px var(--r-btn);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
  color: var(--text);
  line-height: var(--lh-sm);
  pointer-events: none;
}

.pet-hudwrap {
  width: 100%;
  min-width: 0;
}

/* THE ONLY THING THE SIZE SETTING SCALES. Text must not change size with it, so the
   scale lives here instead of on the canvas — the HUD, the speech bubble and the count
   badge all stay at design size. The box is sized to the scaled sprite (66x68 MUST
   match .sprite-wrap in components/pet/PetSprite.vue) so the drag + click-through
   hit-test rect keeps matching what is actually drawn. */
.pet-anchor {
  position: relative;
  width: calc(66px * var(--pet-scale, 1));
  height: calc(68px * var(--pet-scale, 1));
  cursor: grab;
}
.pet-sprite {
  position: absolute;
  right: 0;
  bottom: 0;
  transform: scale(var(--pet-scale, 1));
  transform-origin: bottom right;
}
.pet-anchor:active {
  cursor: grabbing;
}

/* Temporary-dismiss X — top-left corner, opposite the count badge (top-right). Only
   shown on hover (v-if), so it never covers the idle sprite. */
.pet-dismiss {
  position: absolute;
  top: -6px;
  left: -6px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  color: var(--textMuted);
  background: var(--bgEl);
  border: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.pet-dismiss:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.pet-dismiss svg {
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  fill: none;
}

.pet-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-family: var(--mono, ui-monospace, monospace);
  line-height: 12px;
  font-weight: 600;
  color: #0b0b0c;
  background: var(--textMuted);
}
.pet-badge.is-awaiting {
  background: var(--amber);
}
.pet-badge.is-working {
  background: var(--accent);
}
.pet-badge.is-done {
  background: var(--green);
}
</style>
