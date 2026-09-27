<script setup lang="ts">
import { computed, ref } from 'vue'
import { gateway } from './gateway'
import { navPop, rootRoute, route, toast } from './store'
import ConnectionBar from './components/ConnectionBar.vue'
import TabBar from './components/TabBar.vue'
import PairView from './views/PairView.vue'
import SessionListView from './views/SessionListView.vue'
import SessionView from './views/SessionView.vue'
import SshHostView from './views/SshHostView.vue'
import SshView from './views/SshView.vue'
import TasksView from './views/TasksView.vue'

// Pairing / re-pair takes over the whole screen; otherwise the normal app shows
// behind a thin connection bar.
const showPair = computed(
  () =>
    gateway.revoked.value ||
    gateway.phase.value === 'need-pair' ||
    gateway.phase.value === 'pairing',
)

// The pushed layer is the session OR an ssh-host detail — both slide over the
// tab layer and take the same edge-swipe-back.
const inSession = computed(() => route.value === 'session' || route.value === 'ssh-host')

// ─── Edge swipe-back ────────────────────────────────────────────────────────
// iOS-style interactive back: a drag starting within the left ~26px of the
// session view pulls the view right with the finger (the tab layer parallaxes
// underneath). Past ~35% width on release commits the pop; otherwise it snaps
// back. The view's transform is driven inline so the leave transition can take
// over seamlessly once navPop() fires.

const stage = ref<HTMLElement | null>(null)
const overEl = ref<HTMLElement | null>(null)
const underEl = ref<HTMLElement | null>(null)

interface Swipe {
  id: number
  x: number
  y: number
  dx: number
  engaged: boolean
}
let sw: Swipe | null = null

function findTouch(e: TouchEvent, id: number): Touch | null {
  for (const t of e.touches) if (t.identifier === id) return t
  return null
}

function applyDrag(dx: number): void {
  const w = stage.value?.clientWidth ?? 1
  if (overEl.value) overEl.value.style.transform = `translateX(${dx}px)`
  // Parallax the covered tab layer: it sits shifted -26% left under the session
  // (the `covered` class) and slides back as the session leaves.
  const under = underEl.value
  if (under) under.style.transform = `translateX(${-26 * (1 - dx / w)}%)`
}

function onTouchStart(e: TouchEvent): void {
  if (!inSession.value || !overEl.value) return
  const t = e.touches[0]
  if (t.clientX > 26) return
  sw = { id: t.identifier, x: t.clientX, y: t.clientY, dx: 0, engaged: false }
  // Inline transition would lag the finger — kill it while tracking.
  overEl.value.style.transition = 'none'
  if (underEl.value) underEl.value.style.transition = 'none'
}

function onTouchMove(e: TouchEvent): void {
  if (!sw) return
  const t = findTouch(e, sw.id)
  if (!t) return
  const dx = t.clientX - sw.x
  const dy = t.clientY - sw.y
  if (!sw.engaged) {
    if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return
    // A vertical or leftward first move is a scroll, not a back gesture.
    if (Math.abs(dy) > Math.abs(dx) || dx <= 0) {
      cancelDragStyles()
      sw = null
      return
    }
    sw.engaged = true
  }
  sw.dx = Math.max(0, dx)
  applyDrag(sw.dx)
  // Lock the transcript's vertical scroll only once the gesture has committed
  // to horizontal — element-level listeners are non-passive, so this is legal.
  if (e.cancelable) e.preventDefault()
}

function onTouchEnd(): void {
  if (!sw) return
  const { engaged, dx } = sw
  sw = null
  const el = overEl.value
  const w = stage.value?.clientWidth ?? 1
  if (!engaged || !el) {
    // A tap near the edge: touchstart already killed the transition — restore
    // it or the leave animation would be suppressed by the inline `none`.
    cancelDragStyles()
    return
  }
  const ease = 'transform .22s cubic-bezier(.32,.72,0,1)'
  if (underEl.value) underEl.value.style.transition = ease
  if (dx > w * 0.35) {
    // Commit: finish the slide inline (the leave transition would restart from
    // translateX(0) because an inline transform beats the class), THEN pop.
    el.style.transition = ease
    el.style.transform = 'translateX(100%)'
    if (underEl.value) underEl.value.style.transform = 'translateX(0)'
    window.setTimeout(() => {
      navPop()
      // Keep the departing layer's inline styles — they already match the
      // leave end-state and the node unmounts anyway. The covered layer's
      // inline transform must go or the next push can't parallax it to -26%.
      const under = underEl.value
      if (under) {
        under.style.transition = ''
        under.style.transform = ''
      }
    }, 220)
  } else {
    el.style.transition = 'transform .18s ease-out'
    el.style.transform = 'translateX(0)'
    if (underEl.value) underEl.value.style.transform = ''
    window.setTimeout(() => clearDragStyles(el), 200)
  }
}

function clearDragStyles(el: HTMLElement): void {
  if (!el.isConnected) return
  el.style.transition = ''
  el.style.transform = ''
  if (underEl.value) {
    underEl.value.style.transition = ''
    underEl.value.style.transform = ''
  }
}

function cancelDragStyles(): void {
  const el = overEl.value
  if (el) {
    el.style.transition = ''
    el.style.transform = ''
  }
  if (underEl.value) {
    underEl.value.style.transition = ''
    underEl.value.style.transform = ''
  }
}
</script>

<template>
  <div class="app">
    <PairView v-if="showPair" />
    <template v-else>
      <ConnectionBar />
      <div
        ref="stage"
        class="stage"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <div ref="underEl" class="under" :class="{ covered: inSession }">
          <SessionListView v-if="rootRoute === 'list'" />
          <SshView v-else-if="rootRoute === 'ssh'" />
          <TasksView v-else />
          <TabBar />
        </div>
        <Transition name="slide">
          <div v-if="inSession" ref="overEl" class="over">
            <SessionView v-if="route === 'session'" />
            <SshHostView v-else />
          </div>
        </Transition>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.under {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
/* The iOS push look: the previous screen doesn't just sit there, it recedes
   ~26% left while the new one slides over it. */
.under.covered {
  transform: translateX(-26%);
}
.over {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  /* The moving edge needs a shadow or the push reads as a wipe, not a layer. */
  box-shadow: -18px 0 44px rgba(0, 0, 0, 0.42);
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .under,
  .slide-enter-active,
  .slide-leave-active {
    transition-duration: 0.01s;
  }
}
.toast {
  position: fixed;
  left: 50%;
  bottom: calc(84px + var(--sab, env(safe-area-inset-bottom)) + var(--kb, 0px));
  transform: translateX(-50%);
  z-index: 300;
  max-width: min(90vw, 420px);
  padding: 10px 16px;
  border-radius: var(--r-card);
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
  box-shadow: var(--shadow-2);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
