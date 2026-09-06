<template>
  <Teleport to="body">
    <div v-if="active" class="tour-root" @click.self="noop">
      <!-- Spotlight: a transparent box over the target whose huge box-shadow dims
           everything else. Hidden until the target rect is known. -->
      <div v-if="rect" class="tour-spot" :style="spotStyle" />

      <div ref="popEl" class="tour-pop" :style="popStyle" role="dialog" aria-modal="true">
        <div class="tour-pop-title">{{ step ? t(step.titleKey) : '' }}</div>
        <div class="tour-pop-body">{{ step ? t(step.bodyKey) : '' }}</div>
        <div class="tour-pop-foot">
          <div class="tour-dots">
            <span
              v-for="(s, i) in steps"
              :key="s.id"
              class="tour-dot"
              :class="{ on: i === stepIndex }"
            />
          </div>
          <div class="tour-actions">
            <button class="tbtn" @click="end">{{ t('onboarding.tour.skip') }}</button>
            <button v-if="!isFirst" class="tbtn" @click="prev">
              {{ t('onboarding.tour.prev') }}
            </button>
            <button class="tbtn pri" @click="next">
              {{ isLast ? t('onboarding.tour.done') : t('onboarding.tour.next') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

// Spotlight tour view (§9 global). Owns the DOM work for useTour: finds the
// step's `data-tour` anchor (opening the compact nav drawer first when needed),
// dims the rest of the screen, and positions the coachmark with viewport-aware
// flipping — the same getBoundingClientRect + flip approach as AppSelect.
const { t } = useI18n()
const { active, steps, currentStep: step, stepIndex, isFirst, isLast, next, prev, end } = useTour()
const { compact, navOpen, toggleNav } = useResponsiveShell()

const PAD = 6 // spotlight padding around the target
const GAP = 12 // gap between target and coachmark
const MARGIN = 12 // min distance from the viewport edge
const FALLBACK_W = 300
const FALLBACK_H = 168

const rect = ref<{ top: number; left: number; width: number; height: number } | null>(null)
const popStyle = ref<Record<string, string>>({ top: '50%', left: '50%' })
const popEl = useTemplateRef<HTMLElement>('popEl')

let currentEl: Element | null = null
const noop = () => {}

// Resolve a selector to an on-screen element, polling a few frames so a freshly
// revealed drawer / route has time to paint. Resolves null when it never appears.
function waitForEl(selector: string, frames = 40): Promise<Element | null> {
  return new Promise((resolve) => {
    let left = frames
    const tick = () => {
      const el = document.querySelector(selector)
      if (el) return resolve(el)
      if (left-- <= 0) return resolve(null)
      requestAnimationFrame(tick)
    }
    tick()
  })
}

const spotStyle = ref<Record<string, string>>({})

// Read the live target rect + recompute both the spotlight box and the coachmark
// position. Cheap enough to run on every scroll/resize frame.
function reposition() {
  if (!currentEl) return
  const r = currentEl.getBoundingClientRect()
  rect.value = { top: r.top, left: r.left, width: r.width, height: r.height }
  spotStyle.value = {
    top: `${Math.round(r.top - PAD)}px`,
    left: `${Math.round(r.left - PAD)}px`,
    width: `${Math.round(r.width + PAD * 2)}px`,
    height: `${Math.round(r.height + PAD * 2)}px`,
  }

  const popRect = popEl.value?.getBoundingClientRect()
  const popW = popRect?.width || FALLBACK_W
  const popH = popRect?.height || FALLBACK_H
  const vw = window.innerWidth
  const vh = window.innerHeight

  let place = step.value?.placement ?? 'auto'
  if (place === 'auto') {
    if (r.right + GAP + popW + MARGIN <= vw) place = 'right'
    else if (r.bottom + GAP + popH + MARGIN <= vh) place = 'bottom'
    else if (r.left - GAP - popW - MARGIN >= 0) place = 'left'
    else place = 'top'
  }

  let top = 0
  let leftPx = 0
  if (place === 'right') {
    leftPx = r.right + GAP
    top = r.top + r.height / 2 - popH / 2
  } else if (place === 'left') {
    leftPx = r.left - GAP - popW
    top = r.top + r.height / 2 - popH / 2
  } else if (place === 'bottom') {
    top = r.bottom + GAP
    leftPx = r.left + r.width / 2 - popW / 2
  } else {
    top = r.top - GAP - popH
    leftPx = r.left + r.width / 2 - popW / 2
  }

  leftPx = Math.max(MARGIN, Math.min(leftPx, vw - popW - MARGIN))
  top = Math.max(MARGIN, Math.min(top, vh - popH - MARGIN))
  popStyle.value = { top: `${Math.round(top)}px`, left: `${Math.round(leftPx)}px` }
}

// Locate the current step's anchor (revealing the compact drawer first), then
// position. Auto-advances past an anchor that never renders so a missing target
// can't strand the tour.
async function locate() {
  const s = step.value
  if (!s) return
  currentEl = null
  rect.value = null
  if (compact.value && s.openNav && !navOpen.value) {
    toggleNav()
    await nextTick()
  }
  const el = await waitForEl(s.selector)
  if (!el) {
    console.warn('[tour] anchor not found, skipping', s.selector)
    if (!isLast.value) next()
    else end()
    return
  }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  await nextTick()
  currentEl = el
  reposition()
}

function onKeydown(e: KeyboardEvent) {
  if (!active.value) return
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault()
    next()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    prev()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    end()
  }
}

const onViewportChange = () => {
  requestAnimationFrame(reposition)
}

function bindListeners() {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
}
function unbindListeners() {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
}

watch(active, (on) => {
  if (on) {
    bindListeners()
    void locate()
  } else {
    unbindListeners()
    currentEl = null
    rect.value = null
  }
})
watch(stepIndex, () => {
  if (active.value) void locate()
})

onBeforeUnmount(unbindListeners)
</script>

<style scoped>
.tour-root {
  position: fixed;
  inset: 0;
  z-index: 250;
}
.tour-spot {
  position: fixed;
  border-radius: var(--r-btn);
  border: 2px solid var(--accent);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  transition:
    top 180ms ease,
    left 180ms ease,
    width 180ms ease,
    height 180ms ease;
}
.tour-pop {
  position: fixed;
  /* Fit content (so the nowrap footer never clips) but cap the body width for
     readability. The footer's nowrap buttons feed max-content, so the card is
     always at least as wide as the action row. */
  width: max-content;
  min-width: 260px;
  max-width: min(340px, calc(100vw - 24px));
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  padding: 14px 15px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  z-index: 251;
  transition:
    top 180ms ease,
    left 180ms ease;
}
.tour-pop-title {
  font-weight: 600;
  color: var(--text);
  margin-bottom: 5px;
}
.tour-pop-body {
  color: var(--textMuted);
  line-height: var(--lh-md);
  margin-bottom: 13px;
}
.tour-pop-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  /* Fallback only — on a viewport narrower than the action row, let the buttons
     drop below the dots instead of overflowing. */
  flex-wrap: wrap;
  row-gap: 8px;
}
.tour-dots {
  display: flex;
  gap: 6px;
}
.tour-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border);
}
.tour-dot.on {
  background: var(--accent);
}
.tour-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.tbtn {
  border: 0;
  border-radius: var(--r-xs);
  padding: 5px 11px;
  font-size: 1em;
  font-weight: 500;
  color: var(--textDim);
  background: transparent;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.tbtn:hover {
  color: var(--text);
  background: var(--bgHover);
}
.tbtn.pri {
  color: var(--accentText);
  background: var(--accent);
}
.tbtn.pri:hover {
  color: var(--accentText);
  filter: brightness(1.05);
}
@media (prefers-reduced-motion: reduce) {
  .tour-spot,
  .tour-pop {
    transition: none;
  }
}
</style>
