import { watch, type Ref } from 'vue'
import { attachCodeBlockControls } from '~/utils/code-block-controls'
import { useI18n } from '~/composables/useI18n'
import { useAppearanceDom } from '~/composables/useAppearanceDom'
import { useSettingsStore } from '~/stores/settings'

// Binds the shared code-block controls (language chip · soft-wrap toggle · copy) to this
// app's i18n + settings: the wrap button flips `appearance.codeWrap`, which persists with
// the rest of the appearance slice and repaints every block on screen through the
// `body[data-code-wrap]` attribute. For surfaces that render markdown imperatively and
// re-attach after each innerHTML rebuild.
export function useCodeBlockAttacher(): (el: HTMLElement) => void {
  const { t } = useI18n()
  const store = useSettingsStore()
  const { applyCodeWrap } = useAppearanceDom()
  const onToggleWrap = () => {
    const next = !store.appearance.codeWrap
    store.updateAppearance({ codeWrap: next })
    applyCodeWrap(next)
  }
  return (el: HTMLElement) =>
    attachCodeBlockControls(el, {
      labels: { copy: t('common.copy'), copied: t('common.copied'), wrap: t('common.wrapLines') },
      onToggleWrap,
    })
}

// Keep the controls on every code block inside a `v-html` markdown container.
//
// Those surfaces let Vue own the rendered nodes, so the controls must be (re)attached from
// the outside: whenever the markdown changes, v-html re-sets innerHTML wholesale and the
// previous ones are gone. Watching the container ref as well covers a remount (the preview
// modal's render/raw toggle, a detail panel switching entities).
//
// `content` is any getter whose value changes when the rendered markdown does — typically
// the segment list. Attaching is idempotent, so a spurious run is cheap.
export function useCodeBlockControls(
  container: Ref<HTMLElement | null>,
  content: () => unknown,
): void {
  const attach = useCodeBlockAttacher()
  watch(
    [container, content],
    () => {
      const el = container.value
      if (!el) return
      attach(el)
    },
    { immediate: true, flush: 'post' },
  )
}
