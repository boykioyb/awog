import { useToast, type ToastProps } from '~/composables/useToast'
import { useI18n } from '~/composables/useI18n'

// "Sửa + lưu" của các BodyEditModal: chạy generate → apply → save tách khỏi
// vòng đời modal — caller chụp sẵn dữ liệu cần thiết rồi đóng modal ngay,
// promise đã khởi chạy không bị unmount giết. Xong/lỗi bắn toast singleton.
//
// Toast dùng một `id` cố định theo entity nên trạng thái morph trên cùng một
// row (đang chạy → xong/lỗi) thay vì chồng hai toast.
//
// Hàng "đang chạy" PHẢI duration 0: generate đi từ chục giây tới phút, nếu để
// duration mặc định (5s) toast tự tắt → row bị remove khỏi queue → bước báo
// kết quả update vào id không còn tồn tại = không hiện gì (bug đã gặp). Hai
// trạng thái kết thúc cũng duration 0 vì user bật task nền là để đi làm việc
// khác — toast tự mất sau vài giây thì quay lại không biết đã xong hay lỗi.
// duration 0 tự bật nút close (useToast) nên vẫn tắt tay được.
export function startAiEditSave(opts: {
  // Định danh entity để dedupe toast (vd `agent:<id>`).
  key: string
  // Tên hiển thị trong toast.
  name: string
  // Trả mô tả phụ tuỳ chọn gắn vào toast thành công (vd cảnh báo catalog bị
  // provider chặn) — undefined = chỉ title.
  task: () => Promise<string | undefined>
}): void {
  const toast = useToast()
  const { t } = useI18n()
  const id = `ai-edit-save-${opts.key}`
  toast.add({
    id,
    title: t('library.bgEdit.start', { name: opts.name }),
    color: 'info',
    duration: 0,
  })

  // Morph row đang hiển thị; nếu user đã tắt hàng "đang chạy" (hoặc nó đang
  // trong exit animation, open=false) thì kết quả là sự kiện mới — remove + add
  // để row mới mở lại thay vì update vào một hàng vô hình.
  const showResult = (props: ToastProps): void => {
    const row = toast.toasts.value.find((tt) => tt.id === id)
    if (row?.open) {
      toast.update(id, props)
      return
    }
    toast.remove(id)
    toast.add({ ...props, id })
  }

  void opts
    .task()
    .then((description) =>
      showResult({
        title: t('library.bgEdit.done', { name: opts.name }),
        ...(description ? { description } : {}),
        color: 'success',
        duration: 0,
      }),
    )
    .catch((err: unknown) =>
      showResult({
        title: t('library.bgEdit.failed', { name: opts.name }),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
        duration: 0,
      }),
    )
}
