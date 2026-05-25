type Breakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

const TAILWIND_MIN_WIDTH: Record<Breakpoint, number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
}

export const useBreakpoint = (bp: Breakpoint = 'md') => {
  const matches = ref(true)

  if (import.meta.client) {
    const mql = window.matchMedia(`(min-width: ${TAILWIND_MIN_WIDTH[bp]}px)`)
    matches.value = mql.matches
    const handler = (e: MediaQueryListEvent) => {
      matches.value = e.matches
    }
    mql.addEventListener('change', handler)
    onScopeDispose(() => mql.removeEventListener('change', handler))
  }

  return { matches: readonly(matches) }
}

export const useIsMobile = () => {
  const { matches } = useBreakpoint('md')
  return computed(() => !matches.value)
}
