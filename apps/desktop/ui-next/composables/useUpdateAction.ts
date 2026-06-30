import { computed } from 'vue'
import { useUpdateStore } from '~/stores/update'

// Label + icon for the update store's current primary action. Shared by the
// global UpdateBanner and Settings → About so the two never drift on wording or
// glyph. The decision (which action applies) lives in the store
// (`primaryActionKind`); this only maps it to presentation.
export function useUpdateAction() {
  const update = useUpdateStore()
  const { t } = useI18n()

  const action = computed<{ icon: string; label: string } | null>(() => {
    switch (update.primaryActionKind) {
      case 'download':
        return { icon: 'download', label: t('update.action.download') }
      case 'open-releases':
        return { icon: 'globe', label: t('update.action.openReleases') }
      case 'restart':
        return { icon: 'refresh', label: t('update.action.restart') }
      case 'retry':
        return { icon: 'refresh', label: t('update.action.retry') }
      default:
        return null
    }
  })

  return { action }
}
