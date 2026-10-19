<template>
  <Teleport to="body">
    <!-- data-tour-overlay: hook để người điều phối thêm vào OVERLAYS (useEmbeddedBrowser). -->
    <div v-if="active" data-tour-overlay class="fixed inset-0 z-250" @click.self="noop">
      <!-- Spotlight: a transparent box over the target whose huge box-shadow dims
           everything else. Hidden until the target rect is known. Vị trí/kích thước
           inline vì tính từ rect của phần tử đích lúc chạy. -->
      <div
        v-if="rect"
        class="pointer-events-none fixed rounded-lg border-2 border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] transition-[top,left,width,height] duration-180 ease-in-out motion-reduce:transition-none"
        :style="spotStyle"
      />

      <!-- Coachmark: rộng theo nội dung (footer nowrap không bị cắt) nhưng chặn bề rộng
           thân cho dễ đọc. -->
      <div
        ref="popEl"
        class="fixed z-251 w-max max-w-[min(340px,calc(100vw-24px))] min-w-65 rounded-lg border border-input bg-card px-4 py-3.5 shadow-lg transition-[top,left] duration-180 ease-in-out motion-reduce:transition-none"
        :style="popStyle"
        role="dialog"
        aria-modal="true"
      >
        <div class="mb-1 font-semibold text-foreground">{{ step ? t(step.titleKey) : '' }}</div>
        <div class="mb-3 text-muted-foreground">{{ step ? t(step.bodyKey) : '' }}</div>
        <!-- flex-wrap chỉ là dự phòng khi viewport hẹp hơn hàng nút. -->
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <div class="flex gap-1.5">
            <span
              v-for="(s, i) in steps"
              :key="s.id"
              class="size-2 rounded-full"
              :class="i === stepIndex ? 'bg-primary' : 'bg-border'"
            />
          </div>
          <div class="ml-auto flex shrink-0 gap-1.5">
            <Button variant="ghost" size="sm" class="text-dim" @click="end">
              {{ t('onboarding.tour.skip') }}
            </Button>
            <Button v-if="!isFirst" variant="ghost" size="sm" class="text-dim" @click="prev">
              {{ t('onboarding.tour.prev') }}
            </Button>
            <Button variant="default" size="sm" @click="next">
              {{ isLast ? t('onboarding.tour.done') : t('onboarding.tour.next') }}
            </Button>
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
