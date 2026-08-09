import { watch, type Ref } from 'vue'
import { attachCodeCopyButtons } from '~/utils/code-copy'
import { useI18n } from '~/composables/useI18n'

// Keep a copy button on every code block inside a `v-html` markdown container.
//
// Those surfaces let Vue own the rendered nodes, so the buttons must be (re)attached from
// the outside: whenever the markdown changes, v-html re-sets innerHTML wholesale and the
// previous buttons are gone. Watching the container ref as well covers a remount (the
// preview modal's render/raw toggle, a detail panel switching entities).
//
// `content` is any getter whose value changes when the rendered markdown does — typically
// the segment list. Attaching is idempotent, so a spurious run is cheap.
export function useCodeCopy(container: Ref<HTMLElement | null>, content: () => unknown): void {
  const { t } = useI18n()
  watch(
    [container, content],
    () => {
      const el = container.value
      if (!el) return
      attachCodeCopyButtons(el, { copy: t('common.copy'), copied: t('common.copied') })
    },
    { immediate: true, flush: 'post' },
  )
}
