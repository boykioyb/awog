import { computed, ref } from 'vue'

// Spotlight tour engine (state only) — a module singleton like useCommandPalette.
// Holds which tour is active + the current step; the DOM work (locate target,
// open the compact nav drawer, position the coachmark) lives in TourHost.vue,
// which has a component setup context for useRoute/useResponsiveShell. v1 tours
// anchor shell-level elements via stable `data-tour="…"` selectors so they never
// need cross-route navigation (ADR-less; matches docs/features/onboarding-tour.md).

export type TourPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  id: string
  // Stable anchor selector — `[data-tour="…"]`. Constant (L3 trust), never user input.
  selector: string
  titleKey: string
  bodyKey: string
  placement: TourPlacement
  // When the target lives in the nav rail, the compact (≤1100px) drawer must be
  // opened before the element has an on-screen rect (OQ-3).
  openNav?: boolean
}

// The default "intro" tour — 6 shell-level anchors present on every route.
const INTRO_STEPS: readonly TourStep[] = [
  {
    id: 'nav-rail',
    selector: '[data-tour="nav-rail"]',
    titleKey: 'onboarding.tour.navRail.title',
    bodyKey: 'onboarding.tour.navRail.body',
    placement: 'right',
    openNav: true,
  },
  {
    id: 'nav-sessions',
    selector: '[data-tour="nav-sessions"]',
    titleKey: 'onboarding.tour.navSessions.title',
    bodyKey: 'onboarding.tour.navSessions.body',
    placement: 'right',
    openNav: true,
  },
  {
    id: 'new-btn',
    selector: '[data-tour="new-btn"]',
    titleKey: 'onboarding.tour.newBtn.title',
    bodyKey: 'onboarding.tour.newBtn.body',
    placement: 'bottom',
  },
  {
    id: 'cmdk-hint',
    selector: '[data-tour="cmdk-hint"]',
    titleKey: 'onboarding.tour.cmdk.title',
    bodyKey: 'onboarding.tour.cmdk.body',
    placement: 'bottom',
  },
  {
    id: 'settings-btn',
    selector: '[data-tour="settings-btn"]',
    titleKey: 'onboarding.tour.settings.title',
    bodyKey: 'onboarding.tour.settings.body',
    placement: 'right',
    openNav: true,
  },
  {
    id: 'whatsnew-btn',
    selector: '[data-tour="whatsnew-btn"]',
    titleKey: 'onboarding.tour.whatsNew.title',
    bodyKey: 'onboarding.tour.whatsNew.body',
    placement: 'right',
    openNav: true,
  },
]

const TOURS: Record<string, readonly TourStep[]> = {
  intro: INTRO_STEPS,
}

// "Seen" markers — JSON map { [tourId]: '1' }. One-life only: we never re-show a
// tour the user has already finished (OQ-6). What's New covers per-version intros.
const KEY_SEEN = 'awog:tour:seen'

const readSeen = (): Record<string, string> => {
  if (!import.meta.client) return {}
  try {
    const raw = window.localStorage.getItem(KEY_SEEN)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const writeSeen = (map: Record<string, string>) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(KEY_SEEN, JSON.stringify(map))
  } catch {
    // Non-fatal.
  }
}

// Singleton state.
const active = ref(false)
const tourId = ref<string>('intro')
const stepIndex = ref(0)

export function useTour() {
  const steps = computed<readonly TourStep[]>(() => TOURS[tourId.value] ?? [])
  const currentStep = computed<TourStep | null>(() => steps.value[stepIndex.value] ?? null)
  const isFirst = computed(() => stepIndex.value === 0)
  const isLast = computed(() => stepIndex.value >= steps.value.length - 1)

  const hasSeen = (id = 'intro'): boolean => !!readSeen()[id]
  const markSeen = (id: string) => {
    const map = readSeen()
    map[id] = '1'
    writeSeen(map)
  }

  const start = (id = 'intro') => {
    if (!TOURS[id]?.length) return
    tourId.value = id
    stepIndex.value = 0
    active.value = true
  }
  const end = () => {
    if (active.value) markSeen(tourId.value)
    active.value = false
  }
  const next = () => {
    if (isLast.value) {
      end()
      return
    }
    stepIndex.value += 1
  }
  const prev = () => {
    if (!isFirst.value) stepIndex.value -= 1
  }
  const goTo = (i: number) => {
    if (i >= 0 && i < steps.value.length) stepIndex.value = i
  }

  return {
    active,
    tourId,
    stepIndex,
    steps,
    currentStep,
    isFirst,
    isLast,
    hasSeen,
    start,
    end,
    next,
    prev,
    goTo,
  }
}
