// Danh sách đính kèm đang chờ của MỘT composer: nhận file (chọn tay / kéo-thả / dán),
// dựng `SessionAttachment` và giữ vòng đời object URL.
//
// Tách ra khỏi SessionDetail khi chế độ LƯỚI ra đời: mỗi ô lưới có composer riêng, nên
// có composer thứ hai cần đúng logic này. Chép tay sang đó là chép cả đoạn phân loại
// image/PDF/text và cái bẫy `blob:` bên dưới — hai bản sẽ trôi khỏi nhau một cách im
// lặng, mà cái trôi đi là "file có tới được model không".

import { ref, type Ref } from 'vue'
import { ATTACHMENT_TEXT_MAX } from '~/composables/useChatAttach'
import type { SessionAttachment } from '~/composables/useSessionsData'

// Ảnh dùng data URL; file dạng chữ thì đọc nội dung — cả hai đổ vào modal preview dùng
// chung. Còn lại hiện thành thẻ metadata.
const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonc|ya?ml|toml|csv|tsv|log|ts|tsx|js|jsx|mjs|cjs|vue|css|scss|less|html?|xml|svg|sh|bash|zsh|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sql|env|ini|conf|gitignore)$/i
const isTextLike = (f: File) => (f.type || '').startsWith('text/') || TEXT_EXT.test(f.name)

export interface ComposerAttachments {
  pending: Ref<SessionAttachment[]>
  addFiles: (files: FileList | File[]) => void
  removeAtt: (i: number) => void
  addAtt: (a: SessionAttachment) => void
  clear: () => void
}

export function useComposerAttachments(): ComposerAttachments {
  const pending = ref<SessionAttachment[]>([])

  function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      const mime = f.type || ''
      const img = mime.startsWith('image/')
      const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(f.name)
      // Đường dẫn tuyệt đối trên đĩa (Electron webUtils) để file nhị phân / tài liệu đi
      // tới model được dưới dạng một tham chiếu Read được. '' khi ở ngoài shell hoặc với
      // blob tổng hợp (clipboard) — khi đó file không-phải-chữ không có đường nào tới model.
      const path = window.awog?.getPathForFile?.(f) || ''
      const att: SessionAttachment = { name: f.name, img, size: f.size }
      if (mime) att.mime = mime
      if (path) att.path = path
      const idx = pending.value.push(att) - 1
      if (img || isPdf) {
        // Ảnh VÀ PDF đọc thành base64 `data:` URL: engine gửi ảnh thành image block và
        // PDF thành document block (nhánh Anthropic; Pi rơi về tham chiếu `path`). Một
        // `blob:` object URL bị bỏ trước khi gửi, nên model sẽ KHÔNG BAO GIỜ nhận được.
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          const a = pending.value[idx]
          if (a && dataUrl) {
            a.dataUrl = dataUrl
            a.src = dataUrl
          }
        }
        reader.readAsDataURL(f)
      } else if (isTextLike(f)) {
        void f.text().then((tx) => {
          const a = pending.value[idx]
          if (a) a.text = tx.slice(0, ATTACHMENT_TEXT_MAX)
        })
      }
      // còn lại: file nhị phân không có nội dung inline ⇒ đi bằng tham chiếu `path` ở trên.
    }
  }

  function removeAtt(i: number) {
    const a = pending.value[i]
    if (a?.src) URL.revokeObjectURL(a.src)
    pending.value.splice(i, 1)
  }

  // Ảnh dán từ clipboard (composer @paste → add-att): composer đã dựng sẵn attachment
  // (name/img/dataUrl/mime/size), ở đây chỉ việc nối vào.
  function addAtt(a: SessionAttachment) {
    pending.value.push(a)
  }

  function clear() {
    pending.value = []
  }

  return { pending, addFiles, removeAtt, addAtt, clear }
}
