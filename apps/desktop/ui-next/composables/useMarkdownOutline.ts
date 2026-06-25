import { type Ref, computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

// Outline (table of contents) + reading-width for the rendered-markdown view of
// the preview modal (§7). Extracted from PreviewModal so the SFC stays thin
// (nuxt-vue page-controller rule). Builds the TOC from the DOM headings after each
// render (so it tracks the renderer without coupling to it); clicking scrolls,
// scrolling highlights the active section. The host component must bind
// `ref="mdScroll"` on the scroll container it returns.

export interface OutlineHeading {
  id: string
  text: string
  level: number
}

// Reading-column width presets (px; 0 = full width).
const MD_WIDTHS = [720, 880, 1100, 1400, 0]

const ID_BAD = /[^\p{L}\p{N}\s-]/gu
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(ID_BAD, '').replace(/\s+/g, '-') || 'section'
}

export function useMarkdownOutline(rebuildDep: Ref<unknown>) {
  const mdScroll = useTemplateRef<HTMLElement>('mdScroll')
  const headings = ref<OutlineHeading[]>([])
  const activeHeading = ref('')

  const widthIdx = ref(1)
  const widthValue = computed(() => MD_WIDTHS[widthIdx.value] ?? 880)
  const mdMaxWidth = computed(() => (widthValue.value === 0 ? '100%' : `${widthValue.value}px`))
  function stepWidth(d: number) {
    widthIdx.value = Math.min(MD_WIDTHS.length - 1, Math.max(0, widthIdx.value + d))
  }

  function collectHeadings() {
    const root = mdScroll.value
    if (!root) {
      headings.value = []
      return
    }
    const seen = new Set<string>()
    headings.value = Array.from(root.querySelectorAll('h1, h2, h3')).map((el) => {
      let id = slugify(el.textContent || '')
      while (seen.has(id)) id = `${id}-1`
      seen.add(id)
      el.id = id
      return { id, text: el.textContent || '', level: Number(el.tagName[1]) }
    })
    activeHeading.value = headings.value[0]?.id ?? ''
  }

  function goto(id: string) {
    const el = mdScroll.value?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    activeHeading.value = id
  }

  function onScroll() {
    const root = mdScroll.value
    if (!root) return
    const top = root.scrollTop + 16
    let cur = headings.value[0]?.id ?? ''
    for (const h of headings.value) {
      const el = root.querySelector(`#${CSS.escape(h.id)}`) as HTMLElement | null
      if (el && el.offsetTop <= top) cur = h.id
      else break
    }
    activeHeading.value = cur
  }

  // Rebuild after the rendered markdown lands in the DOM.
  watch(rebuildDep, () => nextTick(collectHeadings))
  onMounted(() => nextTick(collectHeadings))

  return { mdScroll, headings, activeHeading, goto, onScroll, mdMaxWidth, widthValue, stepWidth }
}
