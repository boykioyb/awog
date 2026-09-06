<template>
  <!-- "Load more" affordance for useLoadMore / useGroupLoadMore. A plain button by
       default (click to reveal the next page). Pass `auto` for single-window flat
       lists to also grow on scroll (infinite scroll); per-group sentinels stay
       button-only so scrolling never auto-expands every group at once. Render only
       while there's more (parent gates with v-if) so the observer tears down once
       the list is fully shown. -->
  <button ref="el" type="button" class="loadmore" @click="emit('load')">
    <Icon name="chev" class="lm-chev" />
    {{ t('common.loadMore', { n: remaining }) }}
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{ remaining: number; auto?: boolean }>()
const emit = defineEmits<{ (e: 'load'): void }>()

const { t } = useI18n()

const el = useTemplateRef<HTMLElement>('el')
let observer: IntersectionObserver | null = null

// Match the observer's root to the actual scroller (the list's `.lscroll`) rather
// than the viewport — an element clipped by an inner overflow container only
// intersects reliably when that container is the observation root.
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  let n = node?.parentElement ?? null
  while (n) {
    const oy = getComputedStyle(n).overflowY
    if (oy === 'auto' || oy === 'scroll') return n
    n = n.parentElement
  }
  return null
}

onMounted(() => {
  const target = el.value
  if (!props.auto || !target || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(
    (entries) => {
      // `rootMargin` pre-loads before the sentinel is fully on-screen; the parent
      // hides this row once the window is exhausted, which stops the cascade.
      if (entries.some((e) => e.isIntersecting)) emit('load')
    },
    { root: scrollParent(target), rootMargin: '320px 0px' },
  )
  observer.observe(target)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
/* Subtle inline affordance, not a CTA: a small left-aligned text link indented to
   sit under the group's rows. Borderless + faint so it never competes with the
   list items; the count stays mono (no width jitter). */
.loadmore {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 1px 0 4px 10px;
  padding: 2px 6px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textFaint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.loadmore:hover {
  color: var(--accent);
  background: var(--bgHover);
}
.loadmore:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.loadmore .lm-chev {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
</style>
