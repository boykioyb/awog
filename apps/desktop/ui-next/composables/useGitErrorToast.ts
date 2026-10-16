// Toast lỗi git dùng chung — một cách hiện lỗi cho mọi nơi chạy thao tác git (trang
// /git, modal Git của phiên, view Source Control của workbench). Trước đây hàm này
// sống trong GitManager.vue, nên thao tác gọi từ chỗ khác (workbench) thất bại im.

// Lỗi git thường là vài dòng stderr — toast dài hơn và có nút đóng: toast 1 dòng
// 3.2s cũ cắt mất thông điệp đúng lúc người dùng cần đọc.
const GIT_ERROR_MS = 10_000

export function useGitErrorToast() {
  const { t } = useI18n()
  const toast = useToast()

  // gitCode của sidecar (DIRTY_TREE / AUTH_FAILED / …) → câu dễ hiểu; code chưa dịch
  // thì rơi về nguyên văn lỗi (đã sanitize phía sidecar).
  function gitErrorMessage(code: string | null, fallback: string): string {
    if (code) {
      const key = `git.error.${code}`
      const msg = t(key)
      if (msg !== key) return msg
    }
    return fallback || t('git.error.UNKNOWN')
  }

  // `git.error.<CODE>` làm tiêu đề, nguyên văn của git vào thân để không mất gì. Lỗi
  // không map được chỉ có nguyên văn — nó thành tiêu đề, không thân.
  function surfaceGitError(code: string | null, message: string): void {
    const resolved = gitErrorMessage(code, message)
    const [head, ...rest] = resolved.split('\n')
    const detail = [rest.join('\n').trim(), resolved === message ? '' : message.trim()]
      .filter(Boolean)
      .join('\n\n')
    toast.add({
      title: head ?? resolved,
      ...(detail ? { description: detail } : {}),
      color: 'error',
      duration: GIT_ERROR_MS,
      close: true,
    })
  }

  return { gitErrorMessage, surfaceGitError }
}
