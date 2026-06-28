import { computed, ref } from 'vue'
import type { SessionAttachment } from '~/composables/useSessionsData'

// Decoupled channel for "Add file to chat" from the global PreviewModal. The modal
// is mounted app-wide and must NOT know about the sessions store (SoC): it just
// requests an attachment here. The open session view (SessionDetail) registers as
// a consumer and drains the queue into its composer's pending attachments.
//
// `available` is true only while a session view is mounted, so the modal can hide
// the action when there is no chat to attach to. Module-level state → one channel.

// Max characters kept for a text-file attachment's inline content. The sidecar
// schema documents this as the UI cap (~256k chars, well under its 2M hard limit)
// and the same text is what the preview modal renders — so the previous 20k cap
// silently truncated both the preview and what the model received for any longer
// doc. Single source of truth for the attach + add-to-chat paths.
export const ATTACHMENT_TEXT_MAX = 256 * 1024

const queue = ref<SessionAttachment[]>([])
const consumers = ref(0)

export function useChatAttach() {
  // Push an attachment for the active chat composer to pick up.
  function request(att: SessionAttachment): void {
    queue.value.push(att)
  }

  // Take everything queued (called by the consumer on change). Returns + clears.
  function drain(): SessionAttachment[] {
    if (!queue.value.length) return []
    const items = queue.value
    queue.value = []
    return items
  }

  // SessionDetail calls this onMounted; the returned fn unregisters onUnmounted.
  function registerConsumer(): () => void {
    consumers.value += 1
    return () => {
      consumers.value = Math.max(0, consumers.value - 1)
    }
  }

  return {
    available: computed(() => consumers.value > 0),
    queue,
    request,
    drain,
    registerConsumer,
  }
}
