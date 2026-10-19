<template>
  <!-- Không gì ở đây là tài liệu: không bôi chọn chữ, không ảnh kéo, không caret. -->
  <div
    class="relative h-screen w-screen overflow-hidden select-none"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <!-- Design-size canvas: everything with TEXT in it (HUD, speech bubble, badge)
         stays at this size whatever the pet size setting says — only the sprite
         scales, below. Main still grows the window by the same factor, so the taller
         sprite always has room; both anchor bottom-right, so they stay in register. -->
    <!-- Whole draw region gone while dismissed: an empty canvas means the hit-test
         finds nothing, so the window falls back to fully click-through and no
         quip/trick/animation runs (the DOM isn't mounted). A new prompt in any session
         flips `dismissed` back off (usePetDismiss). -->
    <!-- Canvas cỡ thiết kế 320×280 (w-80 h-70) — PHẢI khớp BASE_WIDTH/BASE_HEIGHT trong
         electron/src/pet-window.ts. Main co giãn cửa sổ theo `scale`, canvas này thì
         KHÔNG; cả hai neo góc dưới-phải nên luôn khớp nhau. -->
    <div
      v-if="!isDismissed"
      class="absolute right-0 bottom-0 flex h-70 w-80 flex-col items-end justify-end gap-1.5 p-1.5"
    >
      <div v-if="hudOpen" ref="hudRef" class="w-full min-w-0">
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
      <!-- pointer-events-none: bong bóng không bao giờ nuốt click dành cho desktop.
           Góc dưới-phải gần vuông = đuôi bong bóng. -->
      <div
        v-if="quip && !hudOpen"
        class="pointer-events-none max-w-full self-end rounded-lg rounded-br-xs border bg-card px-2.5 py-2 text-foreground shadow-lg"
      >
        {{ quip }}
      </div>

      <!-- THỨ DUY NHẤT co giãn theo cỡ pet: hộp bằng sprite đã scale (66×68 PHẢI khớp
           .sprite-wrap trong components/pet/PetSprite.vue) để rect hit-test kéo/click-through
           khớp với hình đang vẽ. Chữ (HUD, bong bóng, badge) giữ cỡ thiết kế.
           px-ok: hình học sprite 66×68 nhân hệ số scale -->
      <div
        ref="petRef"
        class="relative h-[calc(68px*var(--pet-scale,1))] w-[calc(66px*var(--pet-scale,1))] cursor-grab active:cursor-grabbing"
        :style="{ '--pet-scale': model.scale }"
        :title="tooltip"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <!-- Temporary-dismiss X. Sits INSIDE the anchor rect so the existing hit-test
             already covers it. Stops its own pointer/click so it never triggers the
             anchor's pin/drag; hides the pet locally AND sends `dismiss` (does NOT
             touch the enabled pref). -->
        <!-- Nằm GỌN trong rect anchor (góc trên-trái): phần thò ra ngoài rơi vào vùng
             click-through nên click bị bỏ qua. -->
        <Button
          v-if="hovering"
          type="button"
          variant="outline"
          size="iconSm"
          class="absolute top-0 left-0 z-2 size-4.5 rounded-full bg-card p-0 text-muted-foreground shadow-md hover:border-destructive hover:text-destructive [&_svg]:size-3"
          :title="t('pet.dismiss')"
          :aria-label="t('pet.dismiss')"
          @pointerdown.stop
          @pointerup.stop
          @click.stop="onDismiss"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Button>
        <div class="absolute right-0 bottom-0 origin-bottom-right scale-(--pet-scale)">
          <PetSprite
            :state="model.state"
            :sprite="model.sprite"
            :facing="model.facing"
            :alt="altScene"
            :special="special"
          />
        </div>
        <!-- Mực chữ tối CỐ ĐỊNH: badge nằm trên cửa sổ trong suốt (nền là desktop, không
             phải theme) với nền chip sáng, nên màu chữ không đi theo theme sáng/tối. -->
        <span
          v-if="badge"
          class="absolute -top-0.5 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-sm px-1 text-sm leading-3 font-semibold text-neutral-950 tabular-nums"
          :class="BADGE_BG[model.state]"
        >
          {{ badge }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { AwogPetCommand, AwogPetItem, AwogPetModel, AwogPetState } from '~/types/awog-bridge'

// Nền badge đếm theo trạng thái pet.
const BADGE_BG: Record<AwogPetState, string> = {
  idle: 'bg-muted-foreground',
  offline: 'bg-muted-foreground',
  awaiting: 'bg-warning',
  working: 'bg-primary',
  done: 'bg-success',
}

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

// Ẩn pet CỤC BỘ ngay khi bấm X. Logic dismiss "thật" sống trong usePetStatus() của cửa
// sổ chính (nó tính lại model rồi push `dismissed:true` về đây); khi cửa sổ chính đã
// đóng thì không còn ai tính, nên `dismiss` gửi đi bị nuốt và pet không bao giờ ẩn —
// bấm X thành no-op. Local dismiss sửa dứt điểm việc đó bất kể cửa sổ chính còn hay
// không. VẪN gửi `dismiss` để cửa sổ chính (nếu còn) đồng bộ model. Cờ được reset khi
// một model mới về với `dismissed:false` (một prompt mới ở phiên bất kỳ — usePetDismiss).
const localDismissed = ref(false)
const isDismissed = computed(() => model.value.dismissed || localDismissed.value)

function onDismiss(): void {
  localDismissed.value = true
  send({ kind: 'dismiss' })
}

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
    // Một model mới báo `dismissed:false` = pet được đánh thức lại (prompt mới) → gỡ
    // cờ ẩn cục bộ để pet hiện lại.
    if (!next.dismissed) localDismissed.value = false
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
/* style-ok: html/body/#__nuxt nằm ngoài component — Tailwind trong template không chạm tới. */
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
