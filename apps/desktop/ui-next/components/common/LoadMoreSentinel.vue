<template>
  <!-- "Load more" affordance for useLoadMore / useGroupLoadMore. A plain button by
       default (click to reveal the next page). Pass `auto` for single-window flat
       lists to also grow on scroll (infinite scroll); per-group sentinels stay
       button-only so scrolling never auto-expands every group at once. Render only
       while there's more (parent gates with v-if) so the observer tears down once
       the list is fully shown. -->
  <!-- Affordance nhẹ, không phải CTA: link chữ nhỏ thụt lề dưới các hàng của nhóm,
       không viền + chữ mờ để không tranh với item; số đếm tabular-nums (không giật). -->
  <Button
    ref="el"
    variant="ghost"
    size="xs"
    class="mt-px mb-1 ml-2.5 h-auto gap-1 px-1.5 py-0.5 font-normal text-muted-foreground tabular-nums [&_svg]:size-3"
    @click="emit('load')"
  >
    <Icon name="chev" />
    {{ t('common.loadMore', { n: remaining }) }}
  </Button>
</template>

<script setup lang="ts">
const props = defineProps<{ remaining: number; auto?: boolean }>()
const emit = defineEmits<{ (e: 'load'): void }>()

const { t } = useI18n()

// Button shadcn là component ⇒ template ref là instance, phần tử nằm ở `$el`.
const el = useTemplateRef<{ $el: HTMLElement }>('el')
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
  const target = el.value?.$el ?? null
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
