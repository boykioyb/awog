import { ref } from 'vue'

// Shared preview state for the proto — the same single-modal pattern as
// usePreview.ts (one PreviewModal mounted at page level reads this store; any
// chip deep in the transcript/composer/workspace can open the full viewer
// without prop-drilling).

export type ProtoAttachment = {
  name: string
  kind: 'image' | 'video' | 'markdown' | 'text' | 'file'
  src?: string
  text?: string
  lang?: string
  size?: string
  meta?: string
}

const current = ref<ProtoAttachment | null>(null)

export function useProtoPreview() {
  function open(item: ProtoAttachment) {
    current.value = item
  }
  function close() {
    current.value = null
  }
  return { current, open, close }
}
