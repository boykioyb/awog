// Relative-time helper kiểu "1 day ago" / "No activity" — cột Last active của
// các trang collection (Agents/Teams). Dùng chung key common.time.*; `never`
// (chưa từng chạy) map sang common.time.never.
import { useI18n } from '~/composables/useI18n'

export function useRelTime() {
  const { t } = useI18n()
  return (iso: string | undefined | null): string => {
    if (!iso) return t('common.time.never')
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 1) return t('common.time.justNow')
    if (m < 60) return t('common.time.minutesAgo', { n: m })
    const h = Math.floor(m / 60)
    if (h < 24) return t('common.time.hoursAgo', { n: h })
    const d = Math.floor(h / 24)
    if (d < 30) return t('common.time.daysAgo', { n: d })
    return new Date(iso).toLocaleDateString()
  }
}
