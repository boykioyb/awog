import { computed, useAttrs } from 'vue'

// Shared by the `components/ui/*` reka-ui wrappers. `compiler-sfc` cannot
// resolve the `interface X extends ImplY` chains inside reka-ui's generated
// .d.ts during production builds, so those wrappers declare no reka *Props
// type at all and forward plain attrs instead. Returns a tuple:
//
//   const [rest, attrs] = useForwardAttrs('class', 'inset')
//
// `rest` — everything EXCEPT the `omit` keys, safe to `v-bind` onto the reka
// component. `attrs` — the raw reactive `$attrs`, for reading the keys that
// were stripped out of `rest` (variant, size, inset, withHandle…). Reading
// them off `rest` always yields `undefined` (that is the strip's job).
export function useForwardAttrs(...omit: string[]) {
  const attrs = useAttrs()
  const rest = computed<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = { ...attrs }
    for (const k of omit) delete out[k]
    return out
  })
  return [rest, attrs] as const
}
