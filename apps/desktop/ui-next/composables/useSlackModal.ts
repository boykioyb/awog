import { ref } from 'vue'

// Modal Slack threads trong cửa sổ chính (docs/features/slack-threads.md). Một instance
// SlackModal (mount ở AppGlobalHosts) đọc state cấp module này, nên NavRail, chip phiên
// hay route `/slack` đều mở được modal mà không truyền prop.
//
// `threadId` nhớ thread đang chọn: đóng rồi mở lại thì quay về đúng thread đó.
const isOpen = ref(false)
const threadId = ref<string | null>(null)

export function useSlackModal() {
  function open(id?: string | null): void {
    if (id) threadId.value = id
    isOpen.value = true
  }
  function close(): void {
    isOpen.value = false
  }
  return { isOpen, threadId, open, close }
}
