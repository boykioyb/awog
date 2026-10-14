import { onBeforeUnmount, ref } from 'vue'
import { copyText } from '~/utils/clipboard'

const FEEDBACK_MS = 1500

/**
 * Phản hồi sau khi bấm nút copy: `copy(key, text)` ghi clipboard rồi giữ `copiedKey`
 * (hoặc `failedKey` khi clipboard từ chối + toast lỗi) trong ~1,5s. Mỗi nút so `key`
 * của mình để đổi icon copy → check/x; nhiều nút chia sẻ một state, chỉ một nút sáng.
 */
export function useCopyFeedback() {
  const { t } = useI18n()
  const copiedKey = ref<string | null>(null)
  const failedKey = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  async function copy(key: string, text: string): Promise<boolean> {
    const ok = await copyText(text)
    copiedKey.value = ok ? key : null
    failedKey.value = ok ? null : key
    if (!ok) useToast().add({ title: t('capture.toast.copyFailed'), color: 'error' })
    clearTimeout(timer)
    timer = setTimeout(() => {
      copiedKey.value = null
      failedKey.value = null
    }, FEEDBACK_MS)
    return ok
  }

  /** Tên icon cho nút `key`: copy → check (đã chép) / x (thất bại). */
  function iconFor(key: string): string {
    return copiedKey.value === key ? 'check' : failedKey.value === key ? 'x' : 'copy'
  }

  /** Title/aria-label của nút: đổi sang "Đã copy" khi vừa chép xong. */
  function labelFor(key: string, idle: string): string {
    return copiedKey.value === key ? t('capture.toast.copied') : idle
  }

  onBeforeUnmount(() => clearTimeout(timer))

  return { copiedKey, failedKey, copy, iconFor, labelFor }
}
