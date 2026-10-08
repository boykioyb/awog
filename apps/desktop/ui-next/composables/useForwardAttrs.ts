import { computed, useAttrs } from 'vue'

// Shared by the `components/ui/*` reka-ui wrappers. `compiler-sfc` cannot
// resolve the `interface X extends ImplY` chains inside reka-ui's generated
// .d.ts during production builds, so those wrappers declare no reka *Props
// type at all and forward plain attrs instead. This helper strips the
// wrapper-only keys (`class`, plus style flags like `inset`) before the rest
// is bound onto the reka component.
export function useForwardAttrs(...omit: string[]) {
  const attrs = useAttrs()
  return computed<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = { ...attrs }
    for (const k of omit) delete out[k]
    return out
  })
}
